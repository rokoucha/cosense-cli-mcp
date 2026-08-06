import { createHmac, randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Env } from '../config/env.js'
import type { AuthedRequest } from '../oauth/context.js'

export interface RequestLogEvent {
  event: 'http_request'
  requestId: string
  method: string
  path: string
  httpStatus: number
  durationMs: number
  clientId?: string
  subjectHash?: string
  rpcMethod?: string
  rpcToolName?: string
}

/** JSON-RPC本文から、内容を漏らさずルーティング情報だけを取り出す。 */
export function extractRpcLogFields(body: unknown): {
  rpcMethod?: string
  rpcToolName?: string
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {}
  }
  const record = body as Record<string, unknown>
  const rpcMethod =
    typeof record['method'] === 'string' ? record['method'] : undefined
  const params = record['params']
  const rpcToolName =
    rpcMethod === 'tools/call' &&
    typeof params === 'object' &&
    params !== null &&
    !Array.isArray(params) &&
    typeof (params as Record<string, unknown>)['name'] === 'string'
      ? ((params as Record<string, unknown>)['name'] as string)
      : undefined
  return {
    ...(rpcMethod !== undefined ? { rpcMethod } : {}),
    ...(rpcToolName !== undefined ? { rpcToolName } : {}),
  }
}

/**
 * subjectを不可逆hashする。ログにCosenseユーザーの生IDを残さないため。
 */
export function hashSubject(env: Env, subject: string): string {
  return createHmac('sha256', env.logging.hashSecret)
    .update(subject)
    .digest('hex')
}

function log(event: object): void {
  // Authorization header, JWE, PAT, stdin, ページ本文を含むstdout等は呼び出し側で含めないこと。
  console.log(JSON.stringify(event))
}

export function requestLoggingMiddleware(env: Env) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const requestId = randomUUID()
    const startedAt = process.hrtime.bigint()
    ;(req as Request & { requestId?: string }).requestId = requestId
    res.setHeader('X-Request-Id', requestId)

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      const auth = req.auth
      const subject = auth?.extra?.['sub']
      const rpc = extractRpcLogFields(req.body)
      log({
        event: 'http_request',
        requestId,
        method: req.method,
        path: req.path,
        httpStatus: res.statusCode,
        durationMs: Math.round(durationMs),
        ...rpc,
        ...(auth?.clientId !== undefined ? { clientId: auth.clientId } : {}),
        ...(typeof subject === 'string'
          ? { subjectHash: hashSubject(env, subject) }
          : {}),
      } satisfies RequestLogEvent)
    })

    next()
  }
}

export interface CliCommandLogEvent {
  event: 'cli_command'
  requestId: string
  toolName: string
  commandName: string
  durationMs: number
  exitCode: number | null
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutBytes?: number
  stderrBytes?: number
  abortRequested?: boolean
  failureKind?:
    | 'timeout'
    | 'upstream_http_error'
    | 'dns_error'
    | 'tls_error'
    | 'connection_error'
    | 'cli_error'
  upstreamHttpStatus?: number
}

export interface CliCommandStartedLogEvent {
  event: 'cli_command_started'
  requestId: string
  toolName: string
  commandName: string
  stdinBytes: number
  abortRequested: boolean
}

export function logCliCommandStarted(fields: CliCommandStartedLogEvent): void {
  log(fields)
}

export function logCliCommand(fields: CliCommandLogEvent): void {
  log(fields)
}
