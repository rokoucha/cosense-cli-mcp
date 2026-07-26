import { describe, expect, it } from 'vitest'
import type { Env, JweKeySet } from '../config/env.js'
import { buildTestEnv } from '../test/envFixture.js'
import {
  JweVerificationError,
  issueAccessToken,
  issueAuthorizationCode,
  issueAuthorizeRequestToken,
  issueRefreshToken,
  mcpResourceAudience,
  verifyAccessToken,
  verifyAuthorizationCode,
  verifyAuthorizeRequestToken,
  verifyRefreshToken,
} from './jwe.js'

function keySet(fill: number, kid: string): JweKeySet {
  const entry = { kid, key: new Uint8Array(32).fill(fill) }
  return { active: entry, all: [entry] }
}

describe('accessToken issue/verify', () => {
  const env = buildTestEnv()

  it('round-trips claims', async () => {
    const token = await issueAccessToken(env, {
      client_id: 'test-client',
      scope: 'cosense:read cosense:write',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    const claims = await verifyAccessToken(env, token)
    expect(claims.sub).toBe('cosense:abc123')
    expect(claims.pat).toBe('secret-pat')
    expect(claims.aud).toBe(mcpResourceAudience(env))
    expect(claims.typ).toBe('accessToken')
  })

  it('rejects an expired token', async () => {
    const shortLivedEnv: Env = {
      ...env,
      oauth: {
        ...env.oauth,
        ttlSeconds: { ...env.oauth.ttlSeconds, accessToken: -10 },
      },
    }
    const token = await issueAccessToken(shortLivedEnv, {
      client_id: 'test-client',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    await expect(verifyAccessToken(shortLivedEnv, token)).rejects.toThrow(
      JweVerificationError,
    )
  })

  it('rejects a token issued by a different issuer', async () => {
    const token = await issueAccessToken(env, {
      client_id: 'test-client',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    const otherIssuerEnv: Env = { ...env, issuer: 'https://other.example.com' }
    await expect(verifyAccessToken(otherIssuerEnv, token)).rejects.toThrow(
      JweVerificationError,
    )
  })

  it('rejects mixing token types: a refreshToken cannot be verified as an accessToken', async () => {
    const refreshToken = await issueRefreshToken(env, {
      client_id: 'test-client',
      scope: 'cosense:read offline_access',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    await expect(verifyAccessToken(env, refreshToken)).rejects.toThrow(
      JweVerificationError,
    )
  })

  it('supports key rotation: an old kid remains verifiable after the active key changes', async () => {
    const oldEntry = { kid: 'access-old', key: new Uint8Array(32).fill(1) }
    const newEntry = { kid: 'access-new', key: new Uint8Array(32).fill(2) }
    const envWithOldKey: Env = {
      ...env,
      oauth: {
        ...env.oauth,
        keys: {
          ...env.oauth.keys,
          accessToken: { active: oldEntry, all: [oldEntry] },
        },
      },
    }
    const token = await issueAccessToken(envWithOldKey, {
      client_id: 'test-client',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })

    const envAfterRotation: Env = {
      ...env,
      oauth: {
        ...env.oauth,
        keys: {
          ...env.oauth.keys,
          accessToken: { active: newEntry, all: [newEntry, oldEntry] },
        },
      },
    }
    const claims = await verifyAccessToken(envAfterRotation, token)
    expect(claims.sub).toBe('cosense:abc123')
  })

  it('rejects an unknown kid', async () => {
    const token = await issueAccessToken(env, {
      client_id: 'test-client',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    const envWithDifferentKey: Env = {
      ...env,
      oauth: {
        ...env.oauth,
        keys: { ...env.oauth.keys, accessToken: keySet(9, 'unrelated-kid') },
      },
    }
    await expect(verifyAccessToken(envWithDifferentKey, token)).rejects.toThrow(
      JweVerificationError,
    )
  })
})

describe('authorizeRequest / authorizationCode / refreshToken round-trips', () => {
  const env = buildTestEnv()

  it('authorizeRequestToken round-trips PKCE and client fields', async () => {
    const token = await issueAuthorizeRequestToken(env, {
      client_id: 'test-client',
      redirect_uri: 'https://client.example.com/callback',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
      scope: 'cosense:read',
      origin: 'https://scrapbox.io',
      resource: mcpResourceAudience(env),
      csrf_token: 'csrf-abc',
      state: 'state-xyz',
    })
    const claims = await verifyAuthorizeRequestToken(env, token)
    expect(claims.code_challenge).toBe('challenge-value')
    expect(claims.state).toBe('state-xyz')
  })

  it('authorizationCode round-trips the PAT and subject', async () => {
    const token = await issueAuthorizationCode(env, {
      client_id: 'test-client',
      redirect_uri: 'https://client.example.com/callback',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
      scope: 'cosense:read cosense:write',
      origin: 'https://scrapbox.io',
      resource: mcpResourceAudience(env),
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    const claims = await verifyAuthorizationCode(env, token)
    expect(claims.pat).toBe('secret-pat')
    expect(claims.redirect_uri).toBe('https://client.example.com/callback')
  })

  it('refreshToken round-trips', async () => {
    const token = await issueRefreshToken(env, {
      client_id: 'test-client',
      scope: 'cosense:read offline_access',
      origin: 'https://scrapbox.io',
      sub: 'cosense:abc123',
      cosense_user_id: 'abc123',
      pat: 'secret-pat',
    })
    const claims = await verifyRefreshToken(env, token)
    expect(claims.typ).toBe('refreshToken')
  })
})
