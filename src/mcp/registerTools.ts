import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AnyToolDefinition } from '../cli/toolDefinitions.js'
import { rewriteCliGuidance } from '../cli/cliMessage.js'
import { CliStdinTooLargeError, type CliExecutor } from '../cli/executor.js'
import type { Env } from '../config/env.js'
import { logCliCommand } from '../http/logging.js'

function redact(text: string, secrets: string[]): string {
  let result = text
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join('[REDACTED]')
    }
  }
  return result
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

export function registerTools(
  server: McpServer,
  definitions: AnyToolDefinition[],
  executor: CliExecutor,
  env: Env,
): void {
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: definition.scope === 'cosense:read',
          destructiveHint: definition.destructive,
        },
      },
      async (args, extra): Promise<CallToolResult> => {
        const authInfo = extra.authInfo
        if (!authInfo) {
          return errorResult('unauthorized: missing access token')
        }
        if (!authInfo.scopes.includes(definition.scope)) {
          return errorResult(
            `forbidden: scope "${definition.scope}" is required`,
          )
        }
        const pat = authInfo.extra?.['pat']
        if (typeof pat !== 'string' || pat.length === 0) {
          return errorResult('unauthorized: missing credential')
        }

        const invocation = definition.build(args)
        const requestId = randomUUID()
        const startedAt = process.hrtime.bigint()
        let result
        try {
          result = await executor.execute({
            command: invocation.command,
            args: invocation.args,
            ...(invocation.stdin !== undefined
              ? { stdin: invocation.stdin }
              : {}),
            pat,
            timeoutMs: env.cli.timeoutMs,
            maxStdinBytes: env.cli.maxStdinBytes,
            maxStdoutBytes: env.cli.maxStdoutBytes,
            maxStderrBytes: env.cli.maxStderrBytes,
            signal: extra.signal,
          })
        } catch (error) {
          if (error instanceof CliStdinTooLargeError) {
            return errorResult(
              `command "${definition.name}" was not run: ${error.message}`,
            )
          }
          throw error
        }
        const durationMs = Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        )
        logCliCommand({
          event: 'cli_command',
          requestId,
          toolName: definition.name,
          commandName: invocation.command,
          durationMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated,
        })

        if (result.exitCode !== 0 || result.timedOut) {
          const reason = result.timedOut
            ? 'timeout'
            : `exit code ${result.exitCode ?? 'unknown'}`
          return errorResult(
            `command "${definition.name}" failed (${reason})\n${rewriteCliGuidance(redact(result.stderr, [pat]))}`,
          )
        }

        const notes: string[] = []
        if (result.stdoutTruncated) {
          notes.push('[stdout truncated: output exceeded size limit]')
        }
        const text =
          notes.length > 0
            ? `${result.stdout}\n${notes.join('\n')}`
            : result.stdout

        return { content: [{ type: 'text', text }] }
      },
    )
  }
}
