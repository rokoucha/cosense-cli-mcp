import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { NextFunction, Request, Response } from 'express'
import type { Env } from '../config/env.js'
import { JweVerificationError, verifyAccessToken } from './jwe.js'
import { protectedResourceMetadataUrl } from './metadata.js'
import { ALL_SCOPES } from './scopes.js'

export interface AuthedRequest extends Request {
  auth?: AuthInfo
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined
  }
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]
}

/**
 * MCPのAuthorization仕様は、401に `WWW-Authenticate` を付けてProtected Resource
 * Metadataの位置を示す事を求めている。クライアントはこのヘッダを起点にdiscoveryを
 * 始めるので、`resource_metadata` が無いと認可フロー自体が開始されない。
 *
 * `scope` も併せて返す。`/authorize` が空scopeを拒否するため、要求すべきscopeを
 * ここかPRMのどちらかで必ず伝える必要がある。
 */
function sendUnauthorized(
  env: Env,
  res: Response,
  error: string,
  description: string,
): void {
  const challenge = [
    'realm="mcp"',
    `error="${error}"`,
    `error_description="${description}"`,
    `scope="${ALL_SCOPES.join(' ')}"`,
    `resource_metadata="${protectedResourceMetadataUrl(env)}"`,
  ].join(', ')
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer ${challenge}`)
    .json({ error, error_description: description })
}

export function createBearerAuthMiddleware(env: Env) {
  return async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization)
    if (!token) {
      sendUnauthorized(env, res, 'invalid_request', 'missing bearer token')
      return
    }

    try {
      const claims = await verifyAccessToken(env, token)
      req.auth = {
        token,
        clientId: claims.client_id,
        scopes: claims.scope.split(' ').filter(Boolean),
        expiresAt: claims.exp,
        resource: new URL(claims.aud),
        extra: {
          pat: claims.pat,
          origin: claims.origin,
          sub: claims.sub,
          cosenseUserId: claims.cosense_user_id,
        },
      }
      next()
    } catch (error) {
      if (error instanceof JweVerificationError) {
        sendUnauthorized(
          env,
          res,
          'invalid_token',
          'access token is invalid or expired',
        )
        return
      }
      next(error)
    }
  }
}
