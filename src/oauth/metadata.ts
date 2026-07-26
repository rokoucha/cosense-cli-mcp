import type { Env } from '../config/env.js'
import { mcpResourceAudience } from './jwe.js'
import { ALL_SCOPES } from './scopes.js'

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported: string[]
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

/** 401 challenge の `resource_metadata` が指す先。routerが実際に生やしているpathと対で使う。 */
export function protectedResourceMetadataUrl(env: Env): string {
  return new URL(PROTECTED_RESOURCE_METADATA_PATH, env.issuer).toString()
}

export function buildProtectedResourceMetadata(
  env: Env,
): ProtectedResourceMetadata {
  return {
    resource: mcpResourceAudience(env),
    authorization_servers: [env.issuer],
    // `/authorize` が空scopeを拒否する以上、クライアントが要求すべきscopeを
    // ここで公開しないと、discovery経由の認可が開始できない。
    scopes_supported: [...ALL_SCOPES],
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
    scopes_supported: [...ALL_SCOPES],
  }
}
