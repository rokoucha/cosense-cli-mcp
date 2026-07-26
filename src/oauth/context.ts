import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { NextFunction, Request, Response } from 'express'
import type { Env } from '../config/env.js'
import { JweVerificationError, verifyAccessToken } from './jwe.js'

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

function sendUnauthorized(
  res: Response,
  error: string,
  description: string,
): void {
  res
    .status(401)
    .set(
      'WWW-Authenticate',
      `Bearer realm="mcp", error="${error}", error_description="${description}"`,
    )
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
      sendUnauthorized(res, 'invalid_request', 'missing bearer token')
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
