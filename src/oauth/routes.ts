import express, { Router } from 'express'
import type { Request, Response } from 'express'
import type { CliExecutor } from '../cli/executor.js'
import type { Env } from '../config/env.js'
import { logCliCommand } from '../http/logging.js'
import {
  AUTHORIZE_FORM_CSP,
  generateCsrfToken,
  renderAuthorizeForm,
} from './authorizeForm.js'
import {
  findClient,
  isRedirectUriAllowed,
  verifyClientSecret,
} from './clients.js'
import {
  JweVerificationError,
  issueAccessToken,
  issueAuthorizationCode,
  issueAuthorizeRequestToken,
  issueRefreshToken,
  mcpResourceAudience,
  verifyAuthorizationCode,
  verifyAuthorizeRequestToken,
  verifyRefreshToken,
} from './jwe.js'
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
} from './metadata.js'
import { computeS256Challenge } from './pkce.js'
import { ALL_SCOPES } from './scopes.js'

const CSRF_COOKIE_NAME = 'cosense_mcp_csrf'

function classifyCliFailure(
  stderr: string,
  timedOut: boolean,
): {
  failureKind:
    | 'timeout'
    | 'upstream_http_error'
    | 'dns_error'
    | 'tls_error'
    | 'connection_error'
    | 'cli_error'
  upstreamHttpStatus?: number
} {
  if (timedOut) {
    return { failureKind: 'timeout' }
  }

  const httpStatus = /^HTTP\s+(\d{3})\b/m.exec(stderr)?.[1]
  if (httpStatus !== undefined) {
    return {
      failureKind: 'upstream_http_error',
      upstreamHttpStatus: Number.parseInt(httpStatus, 10),
    }
  }
  if (/\b(?:ENOTFOUND|EAI_AGAIN|getaddrinfo)\b/i.test(stderr)) {
    return { failureKind: 'dns_error' }
  }
  if (
    /\b(?:CERT_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|TLS|SSL|certificate)\b/i.test(
      stderr,
    )
  ) {
    return { failureKind: 'tls_error' }
  }
  if (
    /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|fetch failed)\b/i.test(
      stderr,
    )
  ) {
    return { failureKind: 'connection_error' }
  }
  return { failureKind: 'cli_error' }
}

function parseScope(raw: string): string[] {
  return raw.split(' ').filter(Boolean)
}

function isValidScope(scopes: string[]): boolean {
  return (
    scopes.length > 0 &&
    scopes.every((scope) => (ALL_SCOPES as readonly string[]).includes(scope))
  )
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return undefined
}

function setCsrfCookie(
  res: Response,
  value: string,
  maxAgeSeconds: number,
): void {
  const secure = process.env.NODE_ENV === 'production'
  const attrs = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/authorize',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) {
    attrs.push('Secure')
  }
  res.setHeader('Set-Cookie', attrs.join('; '))
}

function clearCsrfCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production'
  const attrs = [
    `${CSRF_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/authorize',
    'SameSite=Strict',
    'Max-Age=0',
  ]
  if (secure) {
    attrs.push('Secure')
  }
  res.setHeader('Set-Cookie', attrs.join('; '))
}

function sendAuthorizeForm(
  res: Response,
  params: {
    requestToken: string
    csrfToken: string
    clientId: string
    scope: string
    errorMessage?: string
  },
): void {
  res
    .status(200)
    .set('Content-Security-Policy', AUTHORIZE_FORM_CSP)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(renderAuthorizeForm(params))
}

export function createOAuthRouter(env: Env, executor: CliExecutor): Router {
  const router = Router()

  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(buildProtectedResourceMetadata(env))
  })

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(buildAuthorizationServerMetadata(env))
  })

  router.get('/authorize', async (req, res, next) => {
    try {
      const query = req.query
      const responseType =
        typeof query.response_type === 'string'
          ? query.response_type
          : undefined
      const clientId =
        typeof query.client_id === 'string' ? query.client_id : undefined
      const redirectUri =
        typeof query.redirect_uri === 'string' ? query.redirect_uri : undefined
      const codeChallenge =
        typeof query.code_challenge === 'string'
          ? query.code_challenge
          : undefined
      const codeChallengeMethod =
        typeof query.code_challenge_method === 'string'
          ? query.code_challenge_method
          : undefined
      const scopeParam =
        typeof query.scope === 'string' ? query.scope : undefined
      const state = typeof query.state === 'string' ? query.state : undefined
      const resource =
        typeof query.resource === 'string'
          ? query.resource
          : mcpResourceAudience(env)

      if (!clientId) {
        res
          .status(400)
          .type('text/plain')
          .send('invalid_request: client_id is required')
        return
      }
      const client = findClient(env, clientId)
      if (!client) {
        res
          .status(400)
          .type('text/plain')
          .send('invalid_request: unknown client_id')
        return
      }
      if (!redirectUri || !isRedirectUriAllowed(client, redirectUri)) {
        res
          .status(400)
          .type('text/plain')
          .send(
            'invalid_request: redirect_uri is not registered for this client',
          )
        return
      }

      // redirect_uri検証済み以降のエラーはOAuth仕様どおりclientへredirectで返す
      const redirectWithError = (error: string, description: string) => {
        const url = new URL(redirectUri)
        url.searchParams.set('error', error)
        url.searchParams.set('error_description', description)
        if (state !== undefined) {
          url.searchParams.set('state', state)
        }
        res.redirect(url.toString())
      }

      if (responseType !== 'code') {
        redirectWithError(
          'unsupported_response_type',
          'only "code" is supported',
        )
        return
      }
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        redirectWithError(
          'invalid_request',
          'PKCE (S256) code_challenge is required',
        )
        return
      }
      if (resource !== mcpResourceAudience(env)) {
        redirectWithError('invalid_target', 'unsupported resource')
        return
      }
      const scopes = parseScope(scopeParam ?? '')
      if (!isValidScope(scopes)) {
        redirectWithError('invalid_scope', 'requested scope is invalid')
        return
      }

      const csrfToken = generateCsrfToken()
      const requestToken = await issueAuthorizeRequestToken(env, {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        scope: scopes.join(' '),
        origin: env.allowedOrigin,
        resource,
        csrf_token: csrfToken,
        ...(state !== undefined ? { state } : {}),
      })

      setCsrfCookie(res, csrfToken, env.oauth.ttlSeconds.authorizeRequest)
      sendAuthorizeForm(res, {
        requestToken,
        csrfToken,
        clientId,
        scope: scopes.join(' '),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/authorize',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const body = req.body as Record<string, unknown>
        const requestToken =
          typeof body['request_token'] === 'string'
            ? body['request_token']
            : undefined
        const csrfTokenField =
          typeof body['csrf_token'] === 'string'
            ? body['csrf_token']
            : undefined
        const pat = typeof body['pat'] === 'string' ? body['pat'] : undefined
        const csrfCookie = readCookie(req.headers.cookie, CSRF_COOKIE_NAME)

        if (
          !requestToken ||
          !csrfTokenField ||
          !csrfCookie ||
          csrfTokenField !== csrfCookie
        ) {
          res
            .status(400)
            .type('text/plain')
            .send(
              'invalid_request: authorization session expired, please retry',
            )
          return
        }

        let claims
        try {
          claims = await verifyAuthorizeRequestToken(env, requestToken)
        } catch (error) {
          if (error instanceof JweVerificationError) {
            res
              .status(400)
              .type('text/plain')
              .send(
                'invalid_request: authorization session expired, please retry',
              )
            return
          }
          throw error
        }

        if (claims.csrf_token !== csrfTokenField) {
          res
            .status(400)
            .type('text/plain')
            .send('invalid_request: csrf validation failed')
          return
        }

        if (!pat) {
          sendAuthorizeForm(res, {
            requestToken,
            csrfToken: csrfTokenField,
            clientId: claims.client_id,
            scope: claims.scope,
            errorMessage: 'Personal Access Tokenを入力してください',
          })
          return
        }

        const startedAt = process.hrtime.bigint()
        const whoamiResult = await executor.execute({
          command: 'whoami',
          args: [env.allowedOrigin],
          pat,
          timeoutMs: env.cli.timeoutMs,
          maxStdinBytes: env.cli.maxStdinBytes,
          maxStdoutBytes: env.cli.maxStdoutBytes,
          maxStderrBytes: env.cli.maxStderrBytes,
        })
        const durationMs = Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        )
        const requestId = (req as Request & { requestId?: string }).requestId
        const failed =
          whoamiResult.exitCode !== 0 || whoamiResult.timedOut
            ? classifyCliFailure(whoamiResult.stderr, whoamiResult.timedOut)
            : undefined
        logCliCommand({
          event: 'cli_command',
          requestId: requestId ?? 'unknown',
          toolName: 'oauth_authorize',
          commandName: 'whoami',
          durationMs,
          exitCode: whoamiResult.exitCode,
          timedOut: whoamiResult.timedOut,
          stdoutTruncated: whoamiResult.stdoutTruncated,
          stderrTruncated: whoamiResult.stderrTruncated,
          ...failed,
        })

        if (whoamiResult.exitCode !== 0 || whoamiResult.timedOut) {
          sendAuthorizeForm(res, {
            requestToken,
            csrfToken: csrfTokenField,
            clientId: claims.client_id,
            scope: claims.scope,
            errorMessage:
              '認証に失敗しました。Personal Access Tokenを確認してください',
          })
          return
        }

        let cosenseUserId: string
        try {
          const parsed = JSON.parse(whoamiResult.stdout) as { id?: unknown }
          if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
            throw new Error('missing id')
          }
          cosenseUserId = parsed.id
        } catch {
          res
            .status(502)
            .type('text/plain')
            .send('upstream_error: unexpected whoami response')
          return
        }

        const code = await issueAuthorizationCode(env, {
          client_id: claims.client_id,
          redirect_uri: claims.redirect_uri,
          code_challenge: claims.code_challenge,
          code_challenge_method: claims.code_challenge_method,
          scope: claims.scope,
          origin: claims.origin,
          resource: claims.resource,
          sub: `cosense:${cosenseUserId}`,
          cosense_user_id: cosenseUserId,
          pat,
        })

        clearCsrfCookie(res)

        const redirectUrl = new URL(claims.redirect_uri)
        redirectUrl.searchParams.set('code', code)
        if (claims.state !== undefined) {
          redirectUrl.searchParams.set('state', claims.state)
        }
        res.redirect(redirectUrl.toString())
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/token',
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache')
        const body = req.body as Record<string, unknown>
        const grantType =
          typeof body['grant_type'] === 'string'
            ? body['grant_type']
            : undefined
        const clientId =
          typeof body['client_id'] === 'string' ? body['client_id'] : undefined
        const clientSecret =
          typeof body['client_secret'] === 'string'
            ? body['client_secret']
            : undefined

        if (!clientId) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'client_id is required',
          })
          return
        }
        const client = findClient(env, clientId)
        if (!client || !verifyClientSecret(client, clientSecret)) {
          res.status(401).json({ error: 'invalid_client' })
          return
        }

        if (grantType === 'authorization_code') {
          const code =
            typeof body['code'] === 'string' ? body['code'] : undefined
          const redirectUri =
            typeof body['redirect_uri'] === 'string'
              ? body['redirect_uri']
              : undefined
          const codeVerifier =
            typeof body['code_verifier'] === 'string'
              ? body['code_verifier']
              : undefined
          const resource =
            typeof body['resource'] === 'string' ? body['resource'] : undefined

          if (!code || !redirectUri || !codeVerifier) {
            res.status(400).json({ error: 'invalid_request' })
            return
          }

          let claims
          try {
            claims = await verifyAuthorizationCode(env, code)
          } catch {
            res.status(400).json({ error: 'invalid_grant' })
            return
          }

          if (
            claims.client_id !== clientId ||
            claims.redirect_uri !== redirectUri ||
            (resource !== undefined && resource !== claims.resource)
          ) {
            res.status(400).json({ error: 'invalid_grant' })
            return
          }
          if (computeS256Challenge(codeVerifier) !== claims.code_challenge) {
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'PKCE verification failed',
            })
            return
          }

          const accessToken = await issueAccessToken(env, {
            client_id: claims.client_id,
            scope: claims.scope,
            origin: claims.origin,
            sub: claims.sub,
            cosense_user_id: claims.cosense_user_id,
            pat: claims.pat,
          })

          const scopes = parseScope(claims.scope)
          const refreshToken = scopes.includes('offline_access')
            ? await issueRefreshToken(env, {
                client_id: claims.client_id,
                scope: claims.scope,
                origin: claims.origin,
                sub: claims.sub,
                cosense_user_id: claims.cosense_user_id,
                pat: claims.pat,
              })
            : undefined

          res.status(200).json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: env.oauth.ttlSeconds.accessToken,
            scope: claims.scope,
            ...(refreshToken !== undefined
              ? { refresh_token: refreshToken }
              : {}),
          })
          return
        }

        if (grantType === 'refresh_token') {
          const refreshTokenParam =
            typeof body['refresh_token'] === 'string'
              ? body['refresh_token']
              : undefined
          const requestedScope =
            typeof body['scope'] === 'string' ? body['scope'] : undefined
          if (!refreshTokenParam) {
            res.status(400).json({ error: 'invalid_request' })
            return
          }

          let claims
          try {
            claims = await verifyRefreshToken(env, refreshTokenParam)
          } catch {
            res.status(400).json({ error: 'invalid_grant' })
            return
          }
          if (claims.client_id !== clientId) {
            res.status(400).json({ error: 'invalid_grant' })
            return
          }

          const originalScopes = parseScope(claims.scope)
          let finalScope = claims.scope
          if (requestedScope !== undefined) {
            const requested = parseScope(requestedScope)
            if (
              requested.length === 0 ||
              !requested.every((scope) => originalScopes.includes(scope))
            ) {
              res.status(400).json({ error: 'invalid_scope' })
              return
            }
            finalScope = requested.join(' ')
          }

          const accessToken = await issueAccessToken(env, {
            client_id: claims.client_id,
            scope: finalScope,
            origin: claims.origin,
            sub: claims.sub,
            cosense_user_id: claims.cosense_user_id,
            pat: claims.pat,
          })
          const newRefreshToken = await issueRefreshToken(env, {
            client_id: claims.client_id,
            scope: claims.scope,
            origin: claims.origin,
            sub: claims.sub,
            cosense_user_id: claims.cosense_user_id,
            pat: claims.pat,
          })

          res.status(200).json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: env.oauth.ttlSeconds.accessToken,
            scope: finalScope,
            refresh_token: newRefreshToken,
          })
          return
        }

        res.status(400).json({ error: 'unsupported_grant_type' })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
