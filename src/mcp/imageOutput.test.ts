import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readImageOutput,
  sniffImageMimeType,
  summarizeDownloadStdout,
} from './imageOutput.js'

const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('rest of the png'),
])
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('rest of the jpeg'),
])
const GIF = Buffer.from('GIF89a and the rest')
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
])
const PDF = Buffer.from('%PDF-1.7\nnot an image')

describe('sniffImageMimeType', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP],
  ])('detects %s', (mimeType, bytes) => {
    expect(sniffImageMimeType(bytes)).toBe(mimeType)
  })

  it('returns undefined for non-image bytes', () => {
    expect(sniffImageMimeType(PDF)).toBeUndefined()
  })

  it('returns undefined for a file shorter than any signature', () => {
    expect(sniffImageMimeType(Buffer.from([0xff]))).toBeUndefined()
  })

  it('does not trust a WEBP tag outside the RIFF container', () => {
    expect(sniffImageMimeType(Buffer.from('NOPEnnnnWEBP'))).toBeUndefined()
  })
})

describe('readImageOutput', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'imageOutput-test-'))
    path = join(dir, 'download')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns base64 and the sniffed mimeType', async () => {
    await writeFile(path, PNG)
    const result = await readImageOutput(path, 1024)
    expect(result).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      base64: PNG.toString('base64'),
      bytes: PNG.length,
    })
  })

  it('rejects a file above the byte limit', async () => {
    await writeFile(path, PNG)
    const result = await readImageOutput(path, PNG.length - 1)
    expect(result.kind).toBe('rejected')
    expect(result.kind === 'rejected' && result.reason).toContain('thumbnail')
  })

  it('rejects a file whose bytes are not a supported image', async () => {
    await writeFile(path, PDF)
    const result = await readImageOutput(path, 1024)
    expect(result.kind).toBe('rejected')
    expect(result.kind === 'rejected' && result.reason).toContain(
      'readFileInfo',
    )
  })

  it('rejects when the CLI wrote nothing', async () => {
    const result = await readImageOutput(path, 1024)
    expect(result.kind).toBe('rejected')
  })

  it('ignores the file extension when sniffing', async () => {
    const pngNamedAsJpeg = join(dir, 'download.jpg')
    await writeFile(pngNamedAsJpeg, PNG)
    const result = await readImageOutput(pngNamedAsJpeg, 1024)
    expect(result.kind === 'image' && result.mimeType).toBe('image/png')
  })
})

describe('summarizeDownloadStdout', () => {
  it('keeps contentType and size but drops the local path', () => {
    const stdout = JSON.stringify({
      path: '/tmp/cosense-mcp-abc/download',
      contentType: 'image/png',
      size: 1234,
    })
    const lines = summarizeDownloadStdout(stdout)
    expect(lines.join('\n')).toContain('image/png')
    expect(lines.join('\n')).toContain('1234')
    expect(lines.join('\n')).not.toContain('/tmp/')
  })

  it('returns nothing for output it cannot parse', () => {
    expect(summarizeDownloadStdout('not json')).toEqual([])
    expect(summarizeDownloadStdout('null')).toEqual([])
  })

  it('skips fields with unexpected types', () => {
    const stdout = JSON.stringify({ contentType: 42, size: 'big' })
    expect(summarizeDownloadStdout(stdout)).toEqual([])
  })
})
