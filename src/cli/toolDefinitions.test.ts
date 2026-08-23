import { describe, expect, it } from 'vitest'
import { buildTestEnv } from '../test/envFixture.js'
import { createToolDefinitions } from './toolDefinitions.js'

const env = buildTestEnv()
const definitions = createToolDefinitions(env)

function getDefinition(name: string) {
  const def = definitions.find((d) => d.name === name)
  if (!def) {
    throw new Error(`tool definition not found: ${name}`)
  }
  return def
}

describe('createToolDefinitions', () => {
  it('registers all 24 tools with unique names', () => {
    expect(definitions).toHaveLength(24)
    expect(new Set(definitions.map((d) => d.name)).size).toBe(24)
  })

  it('whoami builds argv from origin', () => {
    const def = getDefinition('whoami')
    const input = def.inputSchema.parse({ origin: 'https://scrapbox.io' })
    expect(def.build(input)).toEqual({
      command: 'whoami',
      args: ['https://scrapbox.io'],
    })
    expect(def.scope).toBe('cosense:read')
  })

  it('browsePageChanges includes --since only when provided', () => {
    const def = getDefinition('browsePageChanges')
    const pageId = 'a'.repeat(24)
    const commitId = 'b'.repeat(24)

    const withoutSince = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      pageId,
    })
    expect(def.build(withoutSince)).toEqual({
      command: 'browsePageChanges',
      args: ['https://scrapbox.io/shokai', pageId],
    })

    const withSince = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      pageId,
      since: commitId,
    })
    expect(def.build(withSince)).toEqual({
      command: 'browsePageChanges',
      args: ['https://scrapbox.io/shokai', pageId, '--since', commitId],
    })
  })

  it('listPages builds argv for all optional flags', () => {
    const def = getDefinition('listPages')
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      sort: 'views',
      limit: 50,
      skip: 10,
      filter: 'someuser',
    })
    expect(def.build(input)).toEqual({
      command: 'listPages',
      args: [
        'https://scrapbox.io/shokai',
        '--sort',
        'views',
        '--limit',
        '50',
        '--skip',
        '10',
        '--filter',
        'someuser',
      ],
    })
  })

  it('listPages rejects limit beyond configured max', () => {
    const def = getDefinition('listPages')
    const result = def.inputSchema.safeParse({
      projectUrl: 'https://scrapbox.io/shokai',
      limit: env.limits.listPagesMaxLimit + 1,
    })
    expect(result.success).toBe(false)
  })

  it('downloadFile writes to the given output path and defaults to --thumbnail', () => {
    const def = getDefinition('downloadFile')
    expect(def.fileOutput).toBe(true)

    const input = def.inputSchema.parse({
      fileUrl: 'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
    })
    expect(def.build(input, '/tmp/out/download')).toEqual({
      command: 'downloadFile',
      args: [
        'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
        '/tmp/out/download',
        '--thumbnail',
      ],
    })
  })

  it('downloadFile omits --thumbnail when the original is requested', () => {
    const def = getDefinition('downloadFile')
    const input = def.inputSchema.parse({
      fileUrl: 'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
      thumbnail: false,
      project: 'https://scrapbox.io/shokai',
    })
    expect(def.build(input, '/tmp/out/download')).toEqual({
      command: 'downloadFile',
      args: [
        'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
        '/tmp/out/download',
        '--project',
        'https://scrapbox.io/shokai',
      ],
    })
  })

  it('downloadFile refuses to build argv without an output path', () => {
    const def = getDefinition('downloadFile')
    const input = def.inputSchema.parse({
      fileUrl: 'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
    })
    expect(() => def.build(input)).toThrow()
  })

  it('builds page snapshot commands with validated IDs', () => {
    const pageId = 'a'.repeat(24)
    const snapshotId = 'b'.repeat(24)
    const list = getDefinition('listPageSnapshots')
    const read = getDefinition('readPageSnapshot')

    expect(
      list.build(
        list.inputSchema.parse({
          projectUrl: 'https://scrapbox.io/shokai',
          pageId,
        }),
      ),
    ).toEqual({
      command: 'listPageSnapshots',
      args: ['https://scrapbox.io/shokai', pageId],
    })
    expect(
      read.build(
        read.inputSchema.parse({
          projectUrl: 'https://scrapbox.io/shokai',
          pageId,
          snapshotId,
        }),
      ),
    ).toEqual({
      command: 'readPageSnapshot',
      args: ['https://scrapbox.io/shokai', pageId, snapshotId],
    })
  })

  it('uploadFile decodes input and passes its temporary path to the CLI', () => {
    const def = getDefinition('uploadFile')
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      fileName: 'hello.txt',
      data: Buffer.from('hello').toString('base64'),
      contentType: 'text/plain',
    })
    expect(def.fileInput?.(input)).toEqual({
      fileName: 'hello.txt',
      bytes: Buffer.from('hello'),
    })
    expect(def.build(input, '/tmp/upload/hello.txt')).toEqual({
      command: 'uploadFile',
      args: [
        'https://scrapbox.io/shokai',
        '/tmp/upload/hello.txt',
        '--content-type',
        'text/plain',
      ],
    })
    expect(def.scope).toBe('cosense:write')
    expect(def.destructive).toBe(false)
  })

  it('uploadFile rejects path-like file names and invalid base64', () => {
    const def = getDefinition('uploadFile')
    const base = {
      projectUrl: 'https://scrapbox.io/shokai',
      data: 'aGVsbG8=',
    }
    expect(
      def.inputSchema.safeParse({ ...base, fileName: '../secret' }).success,
    ).toBe(false)
    expect(
      def.inputSchema.safeParse({ ...base, fileName: 'file', data: '???' })
        .success,
    ).toBe(false)
  })

  it('deleteFile builds optional project argv and is destructive', () => {
    const def = getDefinition('deleteFile')
    const input = def.inputSchema.parse({
      fileUrl: 'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
      project: 'https://scrapbox.io/shokai',
    })
    expect(def.build(input)).toEqual({
      command: 'deleteFile',
      args: [
        'https://scrapbox.io/files/5f151efbacbb17001a58f120.png',
        '--project',
        'https://scrapbox.io/shokai',
      ],
    })
    expect(def.destructive).toBe(true)
  })

  it('searchFullText includes --or and --sort flags', () => {
    const def = getDefinition('searchFullText')
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      query: 'design UI',
      or: true,
      sort: 'updated',
    })
    expect(def.build(input)).toEqual({
      command: 'searchFullText',
      args: [
        'https://scrapbox.io/shokai',
        'design UI',
        '--or',
        '--sort',
        'updated',
      ],
    })
  })

  it('previewEdit (update mode) passes ops JSON via stdin without reinterpreting it', () => {
    const def = getDefinition('previewEdit')
    const pageId = 'a'.repeat(24)
    const lineId = 'b'.repeat(24)
    const input = def.inputSchema.parse({
      mode: 'update',
      projectUrl: 'https://scrapbox.io/shokai',
      pageId,
      ops: { ops: [{ replace: lineId, text: 'hello' }] },
    })
    expect(def.build(input)).toEqual({
      command: 'previewEdit',
      args: ['https://scrapbox.io/shokai', pageId],
      stdin: JSON.stringify({ ops: [{ replace: lineId, text: 'hello' }] }),
    })
    expect(def.scope).toBe('cosense:write')
    expect(def.destructive).toBe(false)
  })

  it('previewEdit (create mode) passes body as plain text stdin with --new', () => {
    const def = getDefinition('previewEdit')
    const input = def.inputSchema.parse({
      mode: 'create',
      projectUrl: 'https://scrapbox.io/shokai',
      body: 'Title\nbody line',
    })
    expect(def.build(input)).toEqual({
      command: 'previewEdit',
      args: ['--new', 'https://scrapbox.io/shokai'],
      stdin: 'Title\nbody line',
    })
  })

  it('previewEdit requires mode-specific fields', () => {
    const def = getDefinition('previewEdit')

    expect(
      def.inputSchema.safeParse({
        mode: 'create',
        projectUrl: 'https://scrapbox.io/shokai',
      }).success,
    ).toBe(false)
    expect(
      def.inputSchema.safeParse({
        mode: 'update',
        projectUrl: 'https://scrapbox.io/shokai',
      }).success,
    ).toBe(false)
  })

  it('previewEdit rejects an ops array beyond the configured max', () => {
    const def = getDefinition('previewEdit')
    const lineId = 'c'.repeat(24)
    const tooMany = Array.from(
      { length: env.limits.maxPreviewEditOps + 1 },
      () => ({
        delete: lineId,
      }),
    )
    const result = def.inputSchema.safeParse({
      mode: 'update',
      projectUrl: 'https://scrapbox.io/shokai',
      pageId: 'a'.repeat(24),
      ops: { ops: tooMany },
    })
    expect(result.success).toBe(false)
  })

  it('submitEdit is scoped as destructive write', () => {
    const def = getDefinition('submitEdit')
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      previewId: 'preview-abc123',
    })
    expect(def.build(input)).toEqual({
      command: 'submitEdit',
      args: ['https://scrapbox.io/shokai', 'preview-abc123'],
    })
    expect(def.scope).toBe('cosense:write')
    expect(def.destructive).toBe(true)
  })

  it('previewDelete builds argv without being destructive itself', () => {
    const def = getDefinition('previewDelete')
    const pageId = 'a'.repeat(24)
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      pageId,
    })
    expect(def.build(input)).toEqual({
      command: 'previewDelete',
      args: ['https://scrapbox.io/shokai', pageId],
    })
    expect(def.scope).toBe('cosense:write')
    expect(def.destructive).toBe(false)
  })

  it('rejects URLs outside the allowed origin at the tool boundary', () => {
    const def = getDefinition('readPage')
    const result = def.inputSchema.safeParse({
      pageUrl: 'https://evil.example.com/shokai/foo',
    })
    expect(result.success).toBe(false)
  })

  it('replaceLinks builds argv and is scoped as destructive write', () => {
    const def = getDefinition('replaceLinks')
    const input = def.inputSchema.parse({
      projectUrl: 'https://scrapbox.io/shokai',
      oldTitle: 'Old title',
      newTitle: 'New title',
    })
    expect(def.build(input)).toEqual({
      command: 'replaceLinks',
      args: ['https://scrapbox.io/shokai', 'Old title', 'New title'],
    })
    expect(def.scope).toBe('cosense:write')
    expect(def.destructive).toBe(true)
  })
})
