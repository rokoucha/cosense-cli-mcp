import type { Env, JweKeySet } from '../config/env.js'

function testKeySet(seed: string): JweKeySet {
  const key = new Uint8Array(32).fill(seed.charCodeAt(0))
  return { active: { kid: `${seed}-1`, key }, all: [{ kid: `${seed}-1`, key }] }
}

export function buildTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    port: 3000,
    shutdownTimeoutMs: 10_000,
    issuer: 'https://cosense-mcp.example.com',
    allowedOrigin: 'https://scrapbox.io',
    cli: {
      timeoutMs: 60_000,
      maxConcurrency: 4,
      maxStdinBytes: 1024 * 1024,
      maxStdoutBytes: 10 * 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
    },
    limits: {
      maxRequestBodyBytes: 1024 * 1024,
      maxPreviewEditOps: 1000,
      listPagesMaxLimit: 1000,
      maxImageBytes: 3 * 1024 * 1024,
    },
    logging: {
      hashSecret: new Uint8Array(32).fill(7),
    },
    oauth: {
      clients: [
        {
          id: 'test-client',
          redirectUris: ['https://client.example.com/callback'],
        },
      ],
      ttlSeconds: {
        authorizeRequest: 600,
        authorizationCode: 60,
        accessToken: 900,
        refreshToken: 2_592_000,
      },
      keys: {
        authorizeRequest: testKeySet('a'),
        authorizationCode: testKeySet('b'),
        accessToken: testKeySet('c'),
        refreshToken: testKeySet('d'),
      },
    },
    ...overrides,
  }
}
