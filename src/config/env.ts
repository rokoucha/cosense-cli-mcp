import { randomBytes } from 'node:crypto'

export interface JweKeyEntry {
  kid: string
  key: Uint8Array
}

export interface JweKeySet {
  /** first entry, used to encrypt newly issued tokens */
  active: JweKeyEntry
  /** all entries, used to decrypt/verify tokens (enables rotation) */
  all: JweKeyEntry[]
}

export interface OAuthClientConfig {
  id: string
  secret?: string
  redirectUris: string[]
}

export interface Env {
  port: number
  issuer: string
  allowedOrigin: string
  cli: {
    timeoutMs: number
    maxConcurrency: number
    maxStdinBytes: number
    maxStdoutBytes: number
    maxStderrBytes: number
  }
  limits: {
    maxRequestBodyBytes: number
    maxPreviewEditOps: number
    listPagesMaxLimit: number
  }
  logging: {
    /** subjectを不可逆hashするためのHMAC鍵。ログに生のsubjectを残さないために使う。 */
    hashSecret: Uint8Array
  }
  oauth: {
    clients: OAuthClientConfig[]
    ttlSeconds: {
      authorizeRequest: number
      authorizationCode: number
      accessToken: number
      refreshToken: number
    }
    keys: {
      authorizeRequest: JweKeySet
      authorizationCode: JweKeySet
      accessToken: JweKeySet
      refreshToken: JweKeySet
    }
  }
}

function readIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`環境変数 ${name} は正の整数である必要があります: ${raw}`)
  }
  return value
}

function readStringEnv(name: string, defaultValue: string): string {
  const raw = process.env[name]
  return raw === undefined || raw === '' ? defaultValue : raw
}

function requireStringEnv(name: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    throw new Error(`環境変数 ${name} が設定されていません`)
  }
  return raw
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function parseKeySet(name: string): JweKeySet {
  const raw = process.env[name]
  const isProduction = process.env.NODE_ENV === 'production'

  if (raw === undefined || raw === '') {
    if (isProduction) {
      throw new Error(`環境変数 ${name} が設定されていません`)
    }
    // 開発/テスト用に使い捨て鍵を生成する。本番では必ず環境変数で指定する。
    const key = randomBytes(32)
    console.warn(
      `[config] ${name} が未設定のため開発用の一時鍵を生成しました。本番環境では必ず設定してください。`,
    )
    const entry: JweKeyEntry = { kid: 'dev-generated', key }
    return { active: entry, all: [entry] }
  }

  const entries = raw.split(',').map((item) => {
    const [kid, encodedKey] = item.split(':')
    if (!kid || !encodedKey) {
      throw new Error(
        `環境変数 ${name} の形式が不正です。 <kid>:<base64url key> のカンマ区切りで指定してください`,
      )
    }
    const key = base64UrlToBytes(encodedKey)
    if (key.length !== 32) {
      throw new Error(
        `環境変数 ${name} の鍵 (kid=${kid}) は256bit(32byte)である必要があります`,
      )
    }
    return { kid, key }
  })

  const [active] = entries
  if (!active) {
    throw new Error(`環境変数 ${name} に鍵が1つも指定されていません`)
  }
  return { active, all: entries }
}

function parseSingleKey(name: string): Uint8Array {
  const raw = process.env[name]
  const isProduction = process.env.NODE_ENV === 'production'

  if (raw === undefined || raw === '') {
    if (isProduction) {
      throw new Error(`環境変数 ${name} が設定されていません`)
    }
    console.warn(
      `[config] ${name} が未設定のため開発用の一時鍵を生成しました。本番環境では必ず設定してください。`,
    )
    return randomBytes(32)
  }

  const key = base64UrlToBytes(raw)
  if (key.length !== 32) {
    throw new Error(
      `環境変数 ${name} は256bit(32byte)のbase64url文字列である必要があります`,
    )
  }
  return key
}

function parseClients(): OAuthClientConfig[] {
  const raw = process.env.OAUTH_CLIENTS_JSON
  if (raw === undefined || raw === '') {
    return []
  }
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(
      '環境変数 OAUTH_CLIENTS_JSON はJSON配列である必要があります',
    )
  }
  return parsed.map((entry, index) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== 'string' ||
      !Array.isArray((entry as { redirectUris?: unknown }).redirectUris)
    ) {
      throw new Error(`環境変数 OAUTH_CLIENTS_JSON の要素[${index}]が不正です`)
    }
    const record = entry as {
      id: string
      secret?: unknown
      redirectUris: unknown[]
    }
    const redirectUris = record.redirectUris.map((uri) => {
      if (typeof uri !== 'string') {
        throw new Error(
          `環境変数 OAUTH_CLIENTS_JSON の要素[${index}].redirectUrisは文字列配列である必要があります`,
        )
      }
      return uri
    })
    const client: OAuthClientConfig = {
      id: record.id,
      redirectUris,
      ...(typeof record.secret === 'string' ? { secret: record.secret } : {}),
    }
    return client
  })
}

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  if (cachedEnv) {
    return cachedEnv
  }

  const env: Env = {
    port: readIntEnv('PORT', 3000),
    issuer: requireStringEnv('ISSUER'),
    allowedOrigin: readStringEnv('ALLOWED_ORIGIN', 'https://scrapbox.io'),
    cli: {
      timeoutMs: readIntEnv('CLI_TIMEOUT_MS', 60_000),
      maxConcurrency: readIntEnv('CLI_MAX_CONCURRENCY', 4),
      maxStdinBytes: readIntEnv('CLI_MAX_STDIN_BYTES', 1 * 1024 * 1024),
      maxStdoutBytes: readIntEnv('CLI_MAX_STDOUT_BYTES', 10 * 1024 * 1024),
      maxStderrBytes: readIntEnv('CLI_MAX_STDERR_BYTES', 1 * 1024 * 1024),
    },
    limits: {
      maxRequestBodyBytes: readIntEnv(
        'MAX_REQUEST_BODY_BYTES',
        1 * 1024 * 1024,
      ),
      maxPreviewEditOps: readIntEnv('MAX_PREVIEW_EDIT_OPS', 1000),
      listPagesMaxLimit: readIntEnv('LIST_PAGES_MAX_LIMIT', 1000),
    },
    logging: {
      hashSecret: parseSingleKey('LOG_HASH_SECRET'),
    },
    oauth: {
      clients: parseClients(),
      ttlSeconds: {
        authorizeRequest: readIntEnv('AUTHORIZE_REQUEST_TTL_SECONDS', 600),
        authorizationCode: readIntEnv('AUTHORIZATION_CODE_TTL_SECONDS', 60),
        accessToken: readIntEnv('ACCESS_TOKEN_TTL_SECONDS', 900),
        refreshToken: readIntEnv('REFRESH_TOKEN_TTL_SECONDS', 2_592_000),
      },
      keys: {
        authorizeRequest: parseKeySet('JWE_KEYS_AUTHORIZE_REQUEST'),
        authorizationCode: parseKeySet('JWE_KEYS_AUTHORIZATION_CODE'),
        accessToken: parseKeySet('JWE_KEYS_ACCESS_TOKEN'),
        refreshToken: parseKeySet('JWE_KEYS_REFRESH_TOKEN'),
      },
    },
  }

  cachedEnv = env
  return env
}

/** テスト専用: loadEnvのキャッシュを破棄する */
export function resetEnvCacheForTests(): void {
  cachedEnv = undefined
}
