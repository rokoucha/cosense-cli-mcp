import { readFile, stat } from 'node:fs/promises'

/**
 * tool resultの `image` contentとして返せるmimeType。
 * ここに無い形式は、クライアントが表示できてもモデルが読めない事が多いので画像にしない。
 */
const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number]

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * 中身のmagic byteからmimeTypeを判定する。
 *
 * CLIが報告するContent-Typeやfile URLの拡張子は、サーバー側が付けた自己申告でしかない。
 * `image` contentのmimeTypeはクライアントがそのまま信じるので、実際のbyte列から決める。
 */
export function sniffImageMimeType(
  bytes: Buffer,
): SupportedMimeType | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString('latin1') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('latin1') === 'GIF89a')
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return undefined
}

export type ImageOutput =
  | { kind: 'image'; mimeType: string; base64: string; bytes: number }
  /** 画像として返せなかった。理由はそのままtool resultのtextに載せる。 */
  | { kind: 'rejected'; reason: string }

/**
 * CLIが書き出した一時ファイルを、`image` contentに載せられる形で読む。
 *
 * 上限判定はreadより前にstatで行う。base64化した画像はcontextにそのまま載るので、
 * 読んでから捨てるのでは遅い(メモリを踏む)。
 */
export async function readImageOutput(
  path: string,
  maxBytes: number,
): Promise<ImageOutput> {
  let size: number
  try {
    const stats = await stat(path)
    if (!stats.isFile()) {
      return {
        kind: 'rejected',
        reason: 'CLIが通常ファイルを書き出しませんでした',
      }
    }
    size = stats.size
  } catch {
    return {
      kind: 'rejected',
      reason: 'CLIがファイルを書き出しませんでした',
    }
  }

  if (size > maxBytes) {
    return {
      kind: 'rejected',
      reason: `ファイルが ${size} bytes あり、このサーバーが画像として返せる上限 ${maxBytes} bytes を超えています。thumbnail: true で取り直すか、readFileInfo で抽出済みテキストを読んでください`,
    }
  }

  const bytes = await readFile(path)
  const mimeType = sniffImageMimeType(bytes)
  if (mimeType === undefined) {
    return {
      kind: 'rejected',
      reason: `画像として返せる形式 (${SUPPORTED_MIME_TYPES.join(', ')}) ではありませんでした。readFileInfo で抽出済みテキストを読んでください`,
    }
  }

  return {
    kind: 'image',
    mimeType,
    base64: bytes.toString('base64'),
    bytes: bytes.length,
  }
}

/**
 * downloadFileの標準出力(JSON)から、クライアントに見せてよい情報だけを抜き出す。
 *
 * `path` はこのサーバーの一時ファイルの絶対パスで、クライアントからは触れないし、
 * サーバーの内部構造を漏らすだけなので落とす。
 */
export function summarizeDownloadStdout(stdout: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return []
  }
  const record = parsed as { contentType?: unknown; size?: unknown }
  const lines: string[] = []
  if (typeof record.contentType === 'string') {
    lines.push(`Cosenseが申告したcontentType: ${record.contentType}`)
  }
  if (typeof record.size === 'number') {
    lines.push(`size: ${record.size} bytes`)
  }
  return lines
}
