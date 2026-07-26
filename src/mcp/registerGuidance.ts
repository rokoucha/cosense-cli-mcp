import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ALLOWED_COMMANDS } from '../cli/executor.js'
import { GUIDE_TOPIC_NAMES, guideTopic, helpText } from '../guidance/index.js'

/**
 * スキルとhelpを配るtool/resource。
 *
 * CLIを起動せず生成済みテキストを返すだけなので、scopeもPATも要求しない
 * (/mcp自体はbearer必須なので、未認証で読めるという意味ではない)。
 * PATが失効している時でも login.md を引けるようにしておくのが狙い。
 */
export function registerGuidance(server: McpServer): void {
  server.registerTool(
    'guide',
    {
      description:
        'Cosenseを読み書きするためのスキルを読む。tool呼び出しの前に、対応するスキルを読む',
      inputSchema: z.object({
        topic: z
          .enum(GUIDE_TOPIC_NAMES)
          .describe(
            'スキルの名前。スキル中のリンク (例: [read-page.md](read-page.md)) と同じ文字列を渡す',
          ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    ({ topic }): CallToolResult => {
      const content = guideTopic(topic)
      if (content === undefined) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `unknown topic "${topic}". available: ${GUIDE_TOPIC_NAMES.join(', ')}`,
            },
          ],
        }
      }
      return { content: [{ type: 'text', text: content }] }
    },
  )

  server.registerTool(
    'help',
    {
      description:
        'toolの引数・戻り値の形式・HTTPエラーの意味を読む。スキルが --help を読めと指示している箇所で使う',
      inputSchema: z.object({
        command: z.enum(ALLOWED_COMMANDS).describe('対象のtool名'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    ({ command }): CallToolResult => {
      const content = helpText(command)
      if (content === undefined) {
        return {
          isError: true,
          content: [{ type: 'text', text: `no help for "${command}"` }],
        }
      }
      return { content: [{ type: 'text', text: content }] }
    },
  )

  for (const topic of GUIDE_TOPIC_NAMES) {
    server.registerResource(
      `guide-${topic}`,
      `cosense://guide/${topic}`,
      { description: `スキル: ${topic}`, mimeType: 'text/markdown' },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: guideTopic(topic) as string,
          },
        ],
      }),
    )
  }

  for (const command of ALLOWED_COMMANDS) {
    server.registerResource(
      `help-${command}`,
      `cosense://help/${command}`,
      {
        description: `${command} の引数・戻り値・エラー`,
        mimeType: 'text/plain',
      },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: helpText(command) as string,
          },
        ],
      }),
    )
  }
}
