import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { PassThrough, Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computeS256Challenge } from '../oauth/pkce.js'
import { buildTestEnv } from '../test/envFixture.js'

interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  stdin: Writable
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
  })
  return child
}

const VALID_PAT = 'valid-pat'
const INVALID_PAT = 'invalid-pat'

vi.mock('node:child_process', () => ({
  spawn: (
    bin: string,
    args: string[],
    options: { env?: Record<string, string> },
  ) => {
    const child = createFakeChild()
    const command = args[0]
    setImmediate(() => {
      if (command === 'whoami') {
        if (options.env?.['COSENSE_PAT'] === VALID_PAT) {
          child.stdout.end('{"id":"user123"}')
          child.stderr.end('')
          child.emit('close', 0)
        } else {
          child.stdout.end('')
          child.stderr.end('HTTP 401 unauthorized')
          child.emit('close', 1)
        }
        return
      }
      if (command === 'listProjects') {
        // 上流CLIが401時に実際に出す文面(末尾のlogin誘導を含む)
        child.stdout.end('')
        child.stderr.end(
          'HTTP 401 Unauthorized\nhttps://scrapbox.io/api/projects\n\n\nRun `cosense login https://scrapbox.io` to authenticate.',
        )
        child.emit('close', 1)
        return
      }
      if (command === 'browsePage') {
        child.stdout.end('# Test Page\n\n## 本文\nhello world')
        child.stderr.end('')
        child.emit('close', 0)
        return
      }
      child.stdout.end('')
      child.stderr.end(`unexpected command: ${command}`)
      child.emit('close', 1)
    })
    return child
  },
}))

const { createApp } = await import('./app.js')

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address && typeof address === 'object') {
        const { port } = address
        probe.close(() => resolve(port))
      } else {
        probe.close(() => reject(new Error('failed to allocate a free port')))
      }
    })
  })
}

function extractHiddenInput(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)
  if (!match?.[1]) {
    throw new Error(`hidden input "${name}" not found`)
  }
  return match[1]
}

function extractCsrfCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('Set-Cookie header missing')
  }
  const match = /cosense_mcp_csrf=([^;]+)/.exec(setCookieHeader)
  if (!match?.[1]) {
    throw new Error('csrf cookie not found')
  }
  return match[0]
}

describe('OAuth + MCP integration', () => {
  let server: Server
  let baseUrl: string
  const redirectUri = 'https://client.example.com/callback'

  beforeAll(async () => {
    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`
    const env = buildTestEnv({ issuer: baseUrl })
    const app = createApp(env)
    server = app.listen(port, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('exposes protected resource and authorization server metadata', async () => {
    const prm = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)
    expect(prm.status).toBe(200)
    const prmBody = (await prm.json()) as {
      resource: string
      authorization_servers: string[]
    }
    expect(prmBody.resource).toBe(`${baseUrl}/mcp`)
    expect(prmBody.authorization_servers).toEqual([baseUrl])

    const asm = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
    expect(asm.status).toBe(200)
    const asmBody = (await asm.json()) as {
      issuer: string
      code_challenge_methods_supported: string[]
    }
    expect(asmBody.issuer).toBe(baseUrl)
    expect(asmBody.code_challenge_methods_supported).toEqual(['S256'])
  })

  async function startAuthorize(
    scope: string,
    state: string,
    codeChallenge: string,
  ) {
    const url = new URL(`${baseUrl}/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', 'test-client')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('scope', scope)
    url.searchParams.set('state', state)

    const res = await fetch(url, { redirect: 'manual' })
    expect(res.status).toBe(200)
    const html = await res.text()
    return {
      requestToken: extractHiddenInput(html, 'request_token'),
      csrfToken: extractHiddenInput(html, 'csrf_token'),
      cookie: extractCsrfCookie(res.headers.get('set-cookie')),
    }
  }

  it('rejects an invalid PAT during the authorize step (re-renders the form, no code issued)', async () => {
    const { requestToken, csrfToken, cookie } = await startAuthorize(
      'cosense:read',
      'state-1',
      'irrelevant',
    )

    const res = await fetch(`${baseUrl}/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: new URLSearchParams({
        request_token: requestToken,
        csrf_token: csrfToken,
        pat: INVALID_PAT,
      }),
    })

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('認証に失敗しました')
  })

  async function completeAuthorizationCodeFlow(
    scope: string,
    codeVerifier: string,
  ) {
    const codeChallenge = computeS256Challenge(codeVerifier)
    const { requestToken, csrfToken, cookie } = await startAuthorize(
      scope,
      'state-ok',
      codeChallenge,
    )

    const res = await fetch(`${baseUrl}/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: new URLSearchParams({
        request_token: requestToken,
        csrf_token: csrfToken,
        pat: VALID_PAT,
      }),
    })

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('state')).toBe('state-ok')
    const code = location.searchParams.get('code')
    expect(code).toBeTruthy()
    return code!
  }

  it('exchanges an authorization code for an access token (PKCE match)', async () => {
    const codeVerifier = 'a'.repeat(64)
    const code = await completeAuthorizationCodeFlow(
      'cosense:read cosense:write',
      codeVerifier,
    )

    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: 'test-client',
        code_verifier: codeVerifier,
      }),
    })
    expect(tokenRes.status).toBe(200)
    const body = (await tokenRes.json()) as {
      access_token: string
      token_type: string
      scope: string
    }
    expect(body.token_type).toBe('Bearer')
    expect(body.scope).toBe('cosense:read cosense:write')
    expect(body.access_token).toBeTruthy()
  })

  it('rejects a token exchange with a mismatched PKCE verifier', async () => {
    const code = await completeAuthorizationCodeFlow(
      'cosense:read',
      'b'.repeat(64),
    )

    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: 'test-client',
        code_verifier: 'wrong-verifier',
      }),
    })
    expect(tokenRes.status).toBe(400)
    const body = (await tokenRes.json()) as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('issues a refresh token only when offline_access was requested, and refresh grant works', async () => {
    const codeVerifier = 'c'.repeat(64)
    const code = await completeAuthorizationCodeFlow(
      'cosense:read offline_access',
      codeVerifier,
    )

    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: 'test-client',
        code_verifier: codeVerifier,
      }),
    })
    const body = (await tokenRes.json()) as { refresh_token?: string }
    expect(body.refresh_token).toBeTruthy()

    const refreshRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: body.refresh_token!,
        client_id: 'test-client',
      }),
    })
    expect(refreshRes.status).toBe(200)
    const refreshBody = (await refreshRes.json()) as { access_token: string }
    expect(refreshBody.access_token).toBeTruthy()
  })

  async function getAccessToken(scope: string): Promise<string> {
    const codeVerifier = `verifier-${Math.random()}`
    const code = await completeAuthorizationCodeFlow(scope, codeVerifier)
    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: 'test-client',
        code_verifier: codeVerifier,
      }),
    })
    const body = (await tokenRes.json()) as { access_token: string }
    return body.access_token
  }

  async function callMcp(
    accessToken: string,
    body: unknown,
  ): Promise<{ status: number; json: any }> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
    const json = res.status === 204 ? undefined : await res.json()
    return { status: res.status, json }
  }

  it('lists and calls tools over Streamable HTTP with a valid access token', async () => {
    const accessToken = await getAccessToken('cosense:read')

    const init = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.0' },
      },
    })
    expect(init.status).toBe(200)

    const list = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(list.status).toBe(200)
    const toolNames = list.json.result.tools.map(
      (tool: { name: string }) => tool.name,
    )
    expect(toolNames).toContain('browsePage')
    expect(toolNames).toContain('previewEdit')

    const call = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'browsePage',
        arguments: { pageUrl: 'https://scrapbox.io/shokai/foo' },
      },
    })
    expect(call.status).toBe(200)
    expect(call.json.result.isError).toBeFalsy()
    expect(call.json.result.content[0].text).toContain('Test Page')
  })

  it('rejects tools/call for a write tool when only cosense:read was granted', async () => {
    const accessToken = await getAccessToken('cosense:read')

    await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.0' },
      },
    })

    const call = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'submitEdit',
        arguments: {
          projectUrl: 'https://scrapbox.io/shokai',
          previewId: 'preview-1',
        },
      },
    })
    expect(call.status).toBe(200)
    expect(call.json.result.isError).toBe(true)
    expect(call.json.result.content[0].text).toContain('forbidden')
  })

  it('serves the skill entry point as initialize instructions', async () => {
    const accessToken = await getAccessToken('cosense:read')

    const init = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.0' },
      },
    })
    expect(init.status).toBe(200)
    expect(init.json.result.instructions).toContain('cosense-cli-mcp')
    expect(init.json.result.instructions).toContain('Cosense Skill 手順書')
  })

  /**
   * スキルとhelpはCLIを起動せず生成済みテキストを返すので、scopeもPATも要らない。
   * 認証情報が壊れている時に login.md を読めないと、復旧の導線が無くなる。
   */
  it('serves guide and help without a cosense:write scope', async () => {
    const accessToken = await getAccessToken('cosense:read')

    await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.0' },
      },
    })

    const list = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    const toolNames = list.json.result.tools.map(
      (tool: { name: string }) => tool.name,
    )
    expect(toolNames).toContain('guide')
    expect(toolNames).toContain('help')

    const guide = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'guide', arguments: { topic: 'login.md' } },
    })
    expect(guide.json.result.isError).toBeFalsy()
    expect(guide.json.result.content[0].text).toContain('OAuth')

    const help = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'help', arguments: { command: 'previewEdit' } },
    })
    expect(help.json.result.isError).toBeFalsy()
    expect(help.json.result.content[0].text).toContain('Usage:')
  })

  it('rewrites the CLI login instruction in tool errors', async () => {
    const accessToken = await getAccessToken('cosense:read')

    await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '0.0.0' },
      },
    })

    const call = await callMcp(accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'listProjects',
        arguments: { origin: 'https://scrapbox.io' },
      },
    })
    expect(call.json.result.isError).toBe(true)
    const text = call.json.result.content[0].text as string
    expect(text).toContain('HTTP 401 Unauthorized')
    expect(text).not.toContain('Run `cosense login')
    expect(text).toContain('再認可')
  })

  it('rejects /mcp requests without a bearer token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects an expired access token', async () => {
    const expiredEnv = buildTestEnv({
      issuer: baseUrl,
      oauth: {
        ...buildTestEnv().oauth,
        ttlSeconds: { ...buildTestEnv().oauth.ttlSeconds, accessToken: -10 },
      },
    })
    // 期限切れtokenは別portのappで発行し、同じissuer/鍵を共有する本番serverへ投げる
    const { issueAccessToken } = await import('../oauth/jwe.js')
    const expiredToken = await issueAccessToken(expiredEnv, {
      client_id: 'test-client',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      sub: 'cosense:user123',
      cosense_user_id: 'user123',
      pat: VALID_PAT,
    })

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${expiredToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(401)
  })
})
