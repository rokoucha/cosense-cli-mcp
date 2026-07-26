import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import { CliExecutor } from '../cli/executor.js'
import type { Env } from '../config/env.js'
import { createMcpServer, createStatelessTransport } from '../mcp/server.js'
import {
  createBearerAuthMiddleware,
  type AuthedRequest,
} from '../oauth/context.js'
import { createOAuthRouter } from '../oauth/routes.js'
import { requestLoggingMiddleware } from './logging.js'

function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains',
  )
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

export function createApp(env: Env): Express {
  const executor = new CliExecutor(env.cli.maxConcurrency)
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(securityHeaders)
  app.use(requestLoggingMiddleware(env))

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' })
  })

  app.use(createOAuthRouter(env, executor))

  const bearerAuth = createBearerAuthMiddleware(env)

  // Streamable HTTPはstateless (sessionIdGenerator: undefined) で運用するため、
  // McpServer/Transportともにrequestごとに新規生成する(公式ドキュメント記載のstatelessパターン)。
  async function handleMcpRequest(
    req: AuthedRequest,
    res: Response,
    parsedBody?: unknown,
  ): Promise<void> {
    const server = createMcpServer(env, executor)
    const transport = createStatelessTransport()
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, parsedBody)
  }

  app.post(
    '/mcp',
    express.json({ limit: env.limits.maxRequestBodyBytes }),
    bearerAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        await handleMcpRequest(req, res, req.body)
      } catch (error) {
        next(error)
      }
    },
  )

  app.get(
    '/mcp',
    bearerAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        await handleMcpRequest(req, res)
      } catch (error) {
        next(error)
      }
    },
  )

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(
      JSON.stringify({
        event: 'unhandled_error',
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' })
    }
  })

  return app
}
