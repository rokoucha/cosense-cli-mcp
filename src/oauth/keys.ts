import type { Env, JweKeyEntry, JweKeySet } from '../config/env.js'

export const TOKEN_TYPES = [
  'authorizeRequest',
  'authorizationCode',
  'accessToken',
  'refreshToken',
] as const

export type TokenType = (typeof TOKEN_TYPES)[number]

export function getKeySet(env: Env, type: TokenType): JweKeySet {
  return env.oauth.keys[type]
}

export function findKeyByKid(
  keySet: JweKeySet,
  kid: string,
): JweKeyEntry | undefined {
  return keySet.all.find((entry) => entry.kid === kid)
}
