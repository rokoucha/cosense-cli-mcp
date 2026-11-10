import { createHmac, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify, decodeProtectedHeader } from 'jose'
import { z } from 'zod'
import type { Env, OAuthClientConfig } from '../config/env.js'

const redirectUri = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        !url.hash &&
        !value.includes('#') &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      )
    } catch {
      return false
    }
  })

export const registrationSchema = z.object({
  redirect_uris: z.array(redirectUri).min(1).max(10),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_post'])
    .default('client_secret_post'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .min(1)
    .refine((values) => values.includes('authorization_code'))
    .default(['authorization_code']),
  response_types: z.array(z.literal('code')).length(1).default(['code']),
})

type Registration = z.infer<typeof registrationSchema>

function registrationKey(key: Uint8Array): Buffer {
  return createHmac('sha256', key)
    .update('cosense-mcp:client-registration')
    .digest()
}

function clientSecret(env: Env, id: string, kid: string): string {
  const entry = env.oauth.keys.refreshToken.all.find((key) => key.kid === kid)!
  return createHmac('sha256', registrationKey(entry.key))
    .update(`client-secret:${id}`)
    .digest('base64url')
}

export async function registerClient(env: Env, metadata: Registration) {
  const { kid, key } = env.oauth.keys.refreshToken.active
  const issuedAt = Math.floor(Date.now() / 1000)
  const id = await new SignJWT(metadata)
    .setProtectedHeader({ alg: 'HS256', typ: 'oauth-client', kid })
    .setIssuer(env.issuer)
    .setAudience('client-registration')
    .setIssuedAt(issuedAt)
    .setJti(randomUUID())
    .sign(registrationKey(key))
  return {
    ...metadata,
    client_id: id,
    client_id_issued_at: issuedAt,
    ...(metadata.token_endpoint_auth_method === 'client_secret_post'
      ? {
          client_secret: clientSecret(env, id, kid),
          client_secret_expires_at: 0,
        }
      : {}),
  }
}

export async function findRegisteredClient(
  env: Env,
  id: string,
): Promise<OAuthClientConfig | undefined> {
  if (id.length > 32768) return undefined
  try {
    const header = decodeProtectedHeader(id)
    const entry = env.oauth.keys.refreshToken.all.find(
      (key) => key.kid === header.kid,
    )
    if (!entry) return undefined
    const { payload } = await jwtVerify(id, registrationKey(entry.key), {
      algorithms: ['HS256'],
      typ: 'oauth-client',
      issuer: env.issuer,
      audience: 'client-registration',
    })
    const metadata = registrationSchema.parse(payload)
    return {
      id,
      redirectUris: metadata.redirect_uris,
      grantTypes: metadata.grant_types,
      ...(metadata.token_endpoint_auth_method === 'client_secret_post'
        ? { secret: clientSecret(env, id, entry.kid) }
        : {}),
    }
  } catch {
    return undefined
  }
}
