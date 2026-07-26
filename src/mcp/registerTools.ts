import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AnyToolDefinition } from '../cli/toolDefinitions.js'
import { rewriteCliGuidance } from '../cli/cliMessage.js'
import { CliStdinTooLargeError, type CliExecutor } from '../cli/executor.js'
import type { Env } from '../config/env.js'
import { logCliCommand } from '../http/logging.js'
import { readImageOutput, summarizeDownloadStdout } from './imageOutput.js'

const textOutputSchema = z.object({
  text: z.string().describe('toolの実行結果'),
})

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

/**
 * CLIが一時ファイルに書き出した結果を、tool resultのcontentに載せる。
 *
 * 画像にできなかった場合(上限超過・画像以外)はisErrorで返す。CLI自体は成功しているが、
 * AIから見ると「取り直すか別のtoolを使う」以外に続ける道が無いため。
 */
async function fileOutputResult(
  outputPath: string,
  stdout: string,
  maxImageBytes: number,
): Promise<CallToolResult> {
  const summary = summarizeDownloadStdout(stdout)
  const image = await readImageOutput(outputPath, maxImageBytes)
  if (image.kind === 'rejected') {
    return errorResult([...summary, image.reason].join('\n'))
  }
  const text = [
    ...summary,
    `画像を添付しました (${image.mimeType}, ${image.bytes} bytes)`,
  ].join('\n')
  return {
    structuredContent: { text },
    content: [
      {
        type: 'text',
        text,
      },
      { type: 'image', data: image.base64, mimeType: image.mimeType },
    ],
  }
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
        outputSchema: textOutputSchema,
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

        // 結果をファイルに書くtoolには、requestごとの使い捨てdirectoryを渡す。
        // CLIは書き出し先の親directoryを作らないので、ここで用意して必ず消す。
        const tempDir = definition.fileOutput
          ? await mkdtemp(join(tmpdir(), 'cosense-mcp-'))
          : undefined
        const outputPath =
          tempDir === undefined ? undefined : join(tempDir, 'download')

        try {
          const invocation = definition.build(args, outputPath)
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

          // 一時ファイルのパスはサーバーの内部構造でしかないので、PATと同じく伏せる。
          const secrets = outputPath === undefined ? [pat] : [pat, outputPath]

          if (result.exitCode !== 0 || result.timedOut) {
            const reason = result.timedOut
              ? 'timeout'
              : `exit code ${result.exitCode ?? 'unknown'}`
            return errorResult(
              `command "${definition.name}" failed (${reason})\n${rewriteCliGuidance(redact(result.stderr, secrets))}`,
            )
          }

          if (outputPath !== undefined) {
            return await fileOutputResult(
              outputPath,
              result.stdout,
              env.limits.maxImageBytes,
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

          return {
            structuredContent: { text },
            content: [{ type: 'text', text }],
          }
        } finally {
          if (tempDir !== undefined) {
            await rm(tempDir, { recursive: true, force: true })
          }
        }
      },
    )
  }
}
