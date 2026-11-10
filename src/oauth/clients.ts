import { timingSafeEqual } from 'node:crypto'
import type { Env, OAuthClientConfig } from '../config/env.js'
import { findRegisteredClient } from './registration.js'

export async function findClient(
  env: Env,
  clientId: string,
): Promise<OAuthClientConfig | undefined> {
  return (
    env.oauth.clients.find((client) => client.id === clientId) ??
    findRegisteredClient(env, clientId)
  )
}

export function isRedirectUriAllowed(
  client: OAuthClientConfig,
  redirectUri: string,
): boolean {
  return client.redirectUris.includes(redirectUri)
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

/** clientにsecretが設定されていない場合はpublic client(PKCE必須)として許可する。 */
export function verifyClientSecret(
  client: OAuthClientConfig,
  providedSecret: string | undefined,
): boolean {
  if (client.secret === undefined) {
    return true
  }
  return (
    providedSecret !== undefined &&
    timingSafeEqualString(client.secret, providedSecret)
  )
}
