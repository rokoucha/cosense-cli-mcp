import { describe, expect, it } from 'vitest'
import { buildTestEnv } from '../test/envFixture.js'
import { findClient, verifyClientSecret } from './clients.js'
import { registerClient, registrationSchema } from './registration.js'

const metadata = { redirect_uris: ['https://client.example/callback'] }

describe('dynamic client registration', () => {
  it.each(['none', 'client_secret_post'] as const)(
    'persists %s clients across instances',
    async (method) => {
      const env = buildTestEnv()
      const registered = await registerClient(
        env,
        registrationSchema.parse({
          ...metadata,
          token_endpoint_auth_method: method,
        }),
      )
      const client = await findClient(buildTestEnv(), registered.client_id)
      expect(client?.redirectUris).toEqual(metadata.redirect_uris)
      expect(verifyClientSecret(client!, registered.client_secret)).toBe(true)
      if (method !== 'none')
        expect(verifyClientSecret(client!, 'wrong')).toBe(false)
      expect(await findClient(env, registered.client_id + 'x')).toBeUndefined()
      expect(
        await findClient(
          buildTestEnv({ issuer: 'https://other.example' }),
          registered.client_id,
        ),
      ).toBeUndefined()
    },
  )

  it('supports static clients and unique registrations', async () => {
    const env = buildTestEnv()
    expect((await findClient(env, 'test-client'))?.id).toBe('test-client')
    const parsed = registrationSchema.parse(metadata)
    expect((await registerClient(env, parsed)).client_id).not.toBe(
      (await registerClient(env, parsed)).client_id,
    )
  })

  it.each([
    'http://example.com/cb',
    'https://example.com/#',
    'javascript:alert(1)',
    '/relative',
    'https://user:pass@example.com/',
  ])('rejects unsafe redirects: %s', (uri) => {
    expect(registrationSchema.safeParse({ redirect_uris: [uri] }).success).toBe(
      false,
    )
  })

  it.each([
    'http://127.0.0.1:1234/cb',
    'http://[::1]:1234/cb',
    'http://localhost:1234/cb',
  ])('allows loopback redirects: %s', (uri) => {
    expect(registrationSchema.safeParse({ redirect_uris: [uri] }).success).toBe(
      true,
    )
  })

  it.each([
    {},
    { redirect_uris: [] },
    { ...metadata, grant_types: ['client_credentials'] },
    { ...metadata, response_types: ['token'] },
    { ...metadata, token_endpoint_auth_method: 'client_secret_basic' },
  ])('rejects unsupported metadata %j', (value) => {
    expect(registrationSchema.safeParse(value).success).toBe(false)
  })
})
