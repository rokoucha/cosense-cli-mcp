import type { Env } from '../config/env.js'
import { mcpResourceAudience } from './jwe.js'

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  response_types_supported: string[]
  grant_types_supported: string[]
  code_challenge_methods_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  scopes_supported: string[]
}

export function buildProtectedResourceMetadata(
  env: Env,
): ProtectedResourceMetadata {
  return {
    resource: mcpResourceAudience(env),
    authorization_servers: [env.issuer],
  }
}

export function buildAuthorizationServerMetadata(
  env: Env,
): AuthorizationServerMetadata {
  return {
    issuer: env.issuer,
    authorization_endpoint: new URL('/authorize', env.issuer).toString(),
    token_endpoint: new URL('/token', env.issuer).toString(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['cosense:read', 'cosense:write', 'offline_access'],
  }
}
