import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CliExecutor } from '../cli/executor.js'
import { createToolDefinitions } from '../cli/toolDefinitions.js'
import type { Env } from '../config/env.js'
import { registerTools } from './registerTools.js'

function readOwnPackageVersion(): string {
  const require = createRequire(import.meta.url)
  const packageJson = require('../../package.json') as { version: string }
  return packageJson.version
}

export function createMcpServer(env: Env, executor: CliExecutor): McpServer {
  const server = new McpServer({
    name: 'cosense-cli-mcp',
    version: readOwnPackageVersion(),
  })
  const definitions = createToolDefinitions(env)
  registerTools(server, definitions, executor, env)
  return server
}

export function createStatelessTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
}
