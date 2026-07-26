import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from 'jose'
import type { Env } from '../config/env.js'
import { findKeyByKid, getKeySet, type TokenType } from './keys.js'

const ALG = 'dir'
const ENC = 'A256GCM'
const CLOCK_SKEW_TOLERANCE_SECONDS = 5

interface BaseClaims {
  typ: TokenType
  iss: string
  aud: string
  client_id: string
  scope: string
  origin: string
  iat: number
  exp: number
}

export interface AuthorizeRequestClaims extends BaseClaims {
  typ: 'authorizeRequest'
  redirect_uri: string
  code_challenge: string
  code_challenge_method: 'S256'
  resource: string
  state?: string
  csrf_token: string
}

export interface AuthorizationCodeClaims extends BaseClaims {
  typ: 'authorizationCode'
  redirect_uri: string
  code_challenge: string
  code_challenge_method: 'S256'
  resource: string
  sub: string
  cosense_user_id: string
  pat: string
}

export interface AccessTokenClaims extends BaseClaims {
  typ: 'accessToken'
  sub: string
  cosense_user_id: string
  pat: string
}

export interface RefreshTokenClaims extends BaseClaims {
  typ: 'refreshToken'
  sub: string
  cosense_user_id: string
  pat: string
}

export class JweVerificationError extends Error {}

async function issue<T extends BaseClaims>(
  env: Env,
  type: TokenType,
  ttlSeconds: number,
  claims: Omit<T, 'typ' | 'iss' | 'iat' | 'exp'>,
): Promise<string> {
  const keySet = getKeySet(env, type)
  const now = Math.floor(Date.now() / 1000)
  const payload: BaseClaims = {
    ...claims,
    typ: type,
    iss: env.issuer,
    iat: now,
    exp: now + ttlSeconds,
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  return new CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: ALG,
      enc: ENC,
      kid: keySet.active.kid,
      typ: type,
    })
    .encrypt(keySet.active.key)
}

async function verify<T extends BaseClaims>(
  env: Env,
  type: TokenType,
  token: string,
  expectedAud: string,
): Promise<T> {
  let header: { alg?: string; enc?: string; kid?: string }
  try {
    header = decodeProtectedHeader(token)
  } catch {
    throw new JweVerificationError('malformed token')
  }
  if (header.alg !== ALG || header.enc !== ENC) {
    throw new JweVerificationError('unsupported alg/enc')
  }
  if (!header.kid) {
    throw new JweVerificationError('missing kid')
  }

  const keySet = getKeySet(env, type)
  const keyEntry = findKeyByKid(keySet, header.kid)
  if (!keyEntry) {
    throw new JweVerificationError('unknown kid')
  }

  let plaintext: Uint8Array
  try {
    ;({ plaintext } = await compactDecrypt(token, keyEntry.key))
  } catch {
    throw new JweVerificationError('decryption failed')
  }

  let claims: T
  try {
    claims = JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new JweVerificationError('malformed payload')
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims.typ !== type) {
    throw new JweVerificationError('typ mismatch')
  }
  if (claims.iss !== env.issuer) {
    throw new JweVerificationError('iss mismatch')
  }
  if (claims.aud !== expectedAud) {
    throw new JweVerificationError('aud mismatch')
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new JweVerificationError('token expired')
  }
  if (
    typeof claims.iat !== 'number' ||
    claims.iat > now + CLOCK_SKEW_TOLERANCE_SECONDS
  ) {
    throw new JweVerificationError('token issued in the future')
  }

  return claims
}

export function issueAuthorizeRequestToken(
  env: Env,
  claims: Omit<AuthorizeRequestClaims, 'typ' | 'iss' | 'iat' | 'exp' | 'aud'>,
): Promise<string> {
  return issue<AuthorizeRequestClaims>(
    env,
    'authorizeRequest',
    env.oauth.ttlSeconds.authorizeRequest,
    {
      ...claims,
      aud: env.issuer,
    },
  )
}

export function verifyAuthorizeRequestToken(
  env: Env,
  token: string,
): Promise<AuthorizeRequestClaims> {
  return verify<AuthorizeRequestClaims>(
    env,
    'authorizeRequest',
    token,
    env.issuer,
  )
}

export function issueAuthorizationCode(
  env: Env,
  claims: Omit<AuthorizationCodeClaims, 'typ' | 'iss' | 'iat' | 'exp' | 'aud'>,
): Promise<string> {
  return issue<AuthorizationCodeClaims>(
    env,
    'authorizationCode',
    env.oauth.ttlSeconds.authorizationCode,
    {
      ...claims,
      aud: env.issuer,
    },
  )
}

export function verifyAuthorizationCode(
  env: Env,
  token: string,
): Promise<AuthorizationCodeClaims> {
  return verify<AuthorizationCodeClaims>(
    env,
    'authorizationCode',
    token,
    env.issuer,
  )
}

export function mcpResourceAudience(env: Env): string {
  return new URL('/mcp', env.issuer).toString()
}

export function issueAccessToken(
  env: Env,
  claims: Omit<AccessTokenClaims, 'typ' | 'iss' | 'iat' | 'exp' | 'aud'>,
): Promise<string> {
  return issue<AccessTokenClaims>(
    env,
    'accessToken',
    env.oauth.ttlSeconds.accessToken,
    {
      ...claims,
      aud: mcpResourceAudience(env),
    },
  )
}

export function verifyAccessToken(
  env: Env,
  token: string,
): Promise<AccessTokenClaims> {
  return verify<AccessTokenClaims>(
    env,
    'accessToken',
    token,
    mcpResourceAudience(env),
  )
}

export function issueRefreshToken(
  env: Env,
  claims: Omit<RefreshTokenClaims, 'typ' | 'iss' | 'iat' | 'exp' | 'aud'>,
): Promise<string> {
  return issue<RefreshTokenClaims>(
    env,
    'refreshToken',
    env.oauth.ttlSeconds.refreshToken,
    {
      ...claims,
      aud: env.issuer,
    },
  )
}

export function verifyRefreshToken(
  env: Env,
  token: string,
): Promise<RefreshTokenClaims> {
  return verify<RefreshTokenClaims>(env, 'refreshToken', token, env.issuer)
}
