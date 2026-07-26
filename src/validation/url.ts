import { z } from 'zod'

function parseHttpsUrl(value: string): URL | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') {
    return undefined
  }
  if (url.username !== '' || url.password !== '') {
    return undefined
  }
  return url
}

function matchesAllowedOrigin(url: URL, allowedOrigin: string): boolean {
  const allowed = parseHttpsUrl(allowedOrigin)
  return allowed !== undefined && url.origin === allowed.origin
}

/**
 * `<allowedOrigin>` そのもの(path/query/hash無し)のみ許可する。
 * 例: cosense whoami <origin>
 */
export function originSchema(allowedOrigin: string) {
  return z
    .string()
    .max(2048)
    .transform((value, ctx) => {
      const url = parseHttpsUrl(value)
      if (!url || !matchesAllowedOrigin(url, allowedOrigin)) {
        ctx.addIssue({
          code: 'custom',
          message: `origin must be exactly ${allowedOrigin}`,
        })
        return z.NEVER
      }
      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        ctx.addIssue({
          code: 'custom',
          message: 'origin must not contain path/query/hash',
        })
        return z.NEVER
      }
      return url.origin
    })
    .describe(
      `Cosenseのorigin。このサーバーが許可するのは ${allowedOrigin} のみ (path/query/hash不可)`,
    )
}

/**
 * `<allowedOrigin>/<projectName>` (末尾スラッシュ許容、それ以外のpath無し)。
 */
export function projectUrlSchema(allowedOrigin: string) {
  return z
    .string()
    .max(2048)
    .transform((value, ctx) => {
      const url = parseHttpsUrl(value)
      if (!url || !matchesAllowedOrigin(url, allowedOrigin)) {
        ctx.addIssue({
          code: 'custom',
          message: `projectUrl must be under ${allowedOrigin}`,
        })
        return z.NEVER
      }
      if (url.search !== '' || url.hash !== '') {
        ctx.addIssue({
          code: 'custom',
          message: 'projectUrl must not contain query/hash',
        })
        return z.NEVER
      }
      if (!/^\/[^/]+\/?$/.test(url.pathname)) {
        ctx.addIssue({
          code: 'custom',
          message: 'projectUrl must be <origin>/<projectName>',
        })
        return z.NEVER
      }
      return `${url.origin}${url.pathname}`
    })
    .describe(
      `projectのURL。形式は ${allowedOrigin}/<projectName> (query/hash不可)`,
    )
}

/**
 * `<allowedOrigin>/<projectName>/<pageTitle>` (+ 任意の `#<fragment>`)。
 */
export function pageUrlSchema(allowedOrigin: string) {
  return z
    .string()
    .max(2048)
    .transform((value, ctx) => {
      const url = parseHttpsUrl(value)
      if (!url || !matchesAllowedOrigin(url, allowedOrigin)) {
        ctx.addIssue({
          code: 'custom',
          message: `pageUrl must be under ${allowedOrigin}`,
        })
        return z.NEVER
      }
      if (url.search !== '') {
        ctx.addIssue({
          code: 'custom',
          message: 'pageUrl must not contain query',
        })
        return z.NEVER
      }
      if (!/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
        ctx.addIssue({
          code: 'custom',
          message: 'pageUrl must be <origin>/<projectName>/<pageTitle>',
        })
        return z.NEVER
      }
      if (url.hash !== '' && !/^#[0-9a-zA-Z._-]{1,64}$/.test(url.hash)) {
        ctx.addIssue({
          code: 'custom',
          message: 'pageUrl fragment (lineId) is malformed',
        })
        return z.NEVER
      }
      return `${url.origin}${url.pathname}${url.hash}`
    })
    .describe(
      `ページのURL。形式は ${allowedOrigin}/<projectName>/<pageTitle> (末尾に #<lineId> を付けてもよい。query不可)`,
    )
}

/**
 * `<allowedOrigin>/files/<fileId>[.<ext>]` (query/hash無し)。
 */
export function fileUrlSchema(allowedOrigin: string) {
  return z
    .string()
    .max(2048)
    .transform((value, ctx) => {
      const url = parseHttpsUrl(value)
      if (!url || !matchesAllowedOrigin(url, allowedOrigin)) {
        ctx.addIssue({
          code: 'custom',
          message: `fileUrl must be under ${allowedOrigin}`,
        })
        return z.NEVER
      }
      if (url.search !== '' || url.hash !== '') {
        ctx.addIssue({
          code: 'custom',
          message: 'fileUrl must not contain query/hash',
        })
        return z.NEVER
      }
      if (!/^\/files\/[A-Za-z0-9]+(\.[A-Za-z0-9]+)?$/.test(url.pathname)) {
        ctx.addIssue({
          code: 'custom',
          message: 'fileUrl must be <origin>/files/<fileId>[.<ext>]',
        })
        return z.NEVER
      }
      return `${url.origin}${url.pathname}`
    })
    .describe(
      `ファイルのURL。形式は ${allowedOrigin}/files/<fileId>[.<ext>] (query/hash不可)`,
    )
}
