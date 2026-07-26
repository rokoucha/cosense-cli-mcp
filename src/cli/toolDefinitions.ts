import { z } from 'zod'
import type { Env } from '../config/env.js'
import {
  editTextSchema,
  filterNameSchema,
  fullTextSearchSortSchema,
  insertBeforeAnchorSchema,
  limitSchema,
  lineIdSchema,
  listPagesSortSchema,
  pageIdSchema,
  previewIdSchema,
  searchQuerySchema,
  skipSchema,
} from '../validation/limits.js'
import {
  fileUrlSchema,
  originSchema,
  pageUrlSchema,
  projectUrlSchema,
} from '../validation/url.js'
import type { AllowedCommand } from './executor.js'

export interface CliInvocation {
  command: AllowedCommand
  args: string[]
  stdin?: string
}

export interface ToolDefinition<TInput = unknown> {
  name: string
  description: string
  scope: 'cosense:read' | 'cosense:write'
  destructive: boolean
  inputSchema: z.ZodType<TInput>
  build: (input: TInput) => CliInvocation
}

/** 異種のTInputを持つToolDefinitionを1つの配列にまとめるための型消去エイリアス。 */
export type AnyToolDefinition = ToolDefinition<any>

/** 個々のtool定義ではinputSchemaからTInputを推論させ、配列化のために型を消去するヘルパー。 */
function defineTool<TInput>(
  definition: ToolDefinition<TInput>,
): AnyToolDefinition {
  return definition
}

const OP_TEXT_MAX_LENGTH = 20_000
const CREATE_BODY_MAX_LENGTH = 1_000_000

function opsSchema(maxOps: number) {
  const insertOp = z
    .object({
      insertBefore: insertBeforeAnchorSchema,
      text: editTextSchema(OP_TEXT_MAX_LENGTH),
    })
    .strict()
  const replaceOp = z
    .object({
      replace: lineIdSchema,
      text: editTextSchema(OP_TEXT_MAX_LENGTH),
    })
    .strict()
  const deleteOp = z
    .object({
      delete: lineIdSchema,
    })
    .strict()

  return z.object({
    ops: z
      .array(z.union([insertOp, replaceOp, deleteOp]))
      .min(1)
      .max(maxOps),
  })
}

export function createToolDefinitions(env: Env): AnyToolDefinition[] {
  const origin = originSchema(env.allowedOrigin)
  const projectUrl = projectUrlSchema(env.allowedOrigin)
  const pageUrl = pageUrlSchema(env.allowedOrigin)
  const fileUrl = fileUrlSchema(env.allowedOrigin)

  const readOnlyTools: AnyToolDefinition[] = [
    defineTool({
      name: 'whoami',
      description: '現在の認証ユーザーの情報を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ origin }),
      build: (input) => ({ command: 'whoami', args: [input.origin] }),
    }),
    defineTool({
      name: 'listProjects',
      description: '自分が参加しているprojectの一覧を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ origin }),
      build: (input) => ({ command: 'listProjects', args: [input.origin] }),
    }),
    defineTool({
      name: 'browsePage',
      description:
        '単一ページを読む。メタデータ+アイコン記法+テロメア+Infobox+本文をAIが読みやすい形式で出力する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ pageUrl }),
      build: (input) => ({ command: 'browsePage', args: [input.pageUrl] }),
    }),
    defineTool({
      name: 'browsePageChanges',
      description:
        'ページの編集履歴(commit)をpageId起点で取得し、変更を自然言語で説明する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({
        projectUrl,
        pageId: pageIdSchema,
        since: lineIdSchema.optional(),
      }),
      build: (input) => ({
        command: 'browsePageChanges',
        args: [
          input.projectUrl,
          input.pageId,
          ...(input.since ? ['--since', input.since] : []),
        ],
      }),
    }),
    defineTool({
      name: 'browseRelatedPages',
      description:
        '1-hop+2-hopの関連ページタイトル一覧をAIが読みやすい形式で出力する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ pageUrl }),
      build: (input) => ({
        command: 'browseRelatedPages',
        args: [input.pageUrl],
      }),
    }),
    defineTool({
      name: 'readPage',
      description: '単一ページを読む',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ pageUrl }),
      build: (input) => ({ command: 'readPage', args: [input.pageUrl] }),
    }),
    defineTool({
      name: 'readFileInfo',
      description: 'ファイルのメタデータと抽出済みテキストを取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ fileUrl, project: projectUrl.optional() }),
      build: (input) => ({
        command: 'readFileInfo',
        args: [
          input.fileUrl,
          ...(input.project ? ['--project', input.project] : []),
        ],
      }),
    }),
    defineTool({
      name: 'readProjectMembers',
      description: 'プロジェクトのメンバー一覧を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ projectUrl }),
      build: (input) => ({
        command: 'readProjectMembers',
        args: [input.projectUrl],
      }),
    }),
    defineTool({
      name: 'listPages',
      description: 'プロジェクトのページ一覧を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({
        projectUrl,
        sort: listPagesSortSchema.optional(),
        limit: limitSchema(env.limits.listPagesMaxLimit).optional(),
        skip: skipSchema.optional(),
        filter: filterNameSchema.optional(),
      }),
      build: (input) => ({
        command: 'listPages',
        args: [
          input.projectUrl,
          ...(input.sort ? ['--sort', input.sort] : []),
          ...(input.limit !== undefined
            ? ['--limit', String(input.limit)]
            : []),
          ...(input.skip !== undefined ? ['--skip', String(input.skip)] : []),
          ...(input.filter ? ['--filter', input.filter] : []),
        ],
      }),
    }),
    defineTool({
      name: 'list1hopLinks',
      description: '1-hop近傍を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ pageUrl }),
      build: (input) => ({ command: 'list1hopLinks', args: [input.pageUrl] }),
    }),
    defineTool({
      name: 'list2hopLinks',
      description: '2-hop近傍を取得する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ pageUrl }),
      build: (input) => ({ command: 'list2hopLinks', args: [input.pageUrl] }),
    }),
    defineTool({
      name: 'searchVector',
      description:
        'ベクトル検索でページを探す（タイトル+本文中リンク記法のみ対象）',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({ projectUrl, query: searchQuerySchema }),
      build: (input) => ({
        command: 'searchVector',
        args: [input.projectUrl, input.query],
      }),
    }),
    defineTool({
      name: 'searchFullText',
      description: '本文全文を対象に検索する',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({
        projectUrl,
        query: searchQuerySchema,
        or: z.boolean().optional(),
        sort: fullTextSearchSortSchema.optional(),
      }),
      build: (input) => ({
        command: 'searchFullText',
        args: [
          input.projectUrl,
          input.query,
          ...(input.or ? ['--or'] : []),
          ...(input.sort ? ['--sort', input.sort] : []),
        ],
      }),
    }),
    defineTool({
      name: 'search1hopLinks',
      description: '1-hop近傍を全文検索でフィルタする',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({
        pageUrl,
        query: searchQuerySchema,
        or: z.boolean().optional(),
      }),
      build: (input) => ({
        command: 'search1hopLinks',
        args: [input.pageUrl, input.query, ...(input.or ? ['--or'] : [])],
      }),
    }),
    defineTool({
      name: 'search2hopLinks',
      description: '2-hop近傍を全文検索でフィルタする',
      scope: 'cosense:read',
      destructive: false,
      inputSchema: z.object({
        pageUrl,
        query: searchQuerySchema,
        or: z.boolean().optional(),
      }),
      build: (input) => ({
        command: 'search2hopLinks',
        args: [input.pageUrl, input.query, ...(input.or ? ['--or'] : [])],
      }),
    }),
  ]

  const previewEditInputSchema = z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('update'),
      projectUrl,
      pageId: pageIdSchema,
      ops: opsSchema(env.limits.maxPreviewEditOps),
    }),
    z.object({
      mode: z.literal('create'),
      projectUrl,
      body: z.string().min(1).max(CREATE_BODY_MAX_LENGTH),
    }),
  ])
  type PreviewEditInput = z.infer<typeof previewEditInputSchema>

  const previewEdit = defineTool<PreviewEditInput>({
    name: 'previewEdit',
    description:
      'ページ編集opsをdry-runしてpreviewIdを取得する(既存ページ編集/新規ページ作成)',
    scope: 'cosense:write',
    destructive: false,
    inputSchema: previewEditInputSchema,
    build: (input) => {
      if (input.mode === 'update') {
        return {
          command: 'previewEdit',
          args: [input.projectUrl, input.pageId],
          stdin: JSON.stringify({ ops: input.ops.ops }),
        }
      }
      return {
        command: 'previewEdit',
        args: ['--new', input.projectUrl],
        stdin: input.body,
      }
    },
  })

  const submitEdit = defineTool({
    name: 'submitEdit',
    description: 'previewEditで取得したpreviewIdを使ってページ編集を確定する',
    scope: 'cosense:write',
    destructive: true,
    inputSchema: z.object({ projectUrl, previewId: previewIdSchema }),
    build: (input) => ({
      command: 'submitEdit',
      args: [input.projectUrl, input.previewId],
    }),
  })

  return [...readOnlyTools, previewEdit, submitEdit]
}
