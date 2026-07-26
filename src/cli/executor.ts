import { spawn } from 'node:child_process'
import { resolveCosenseBin } from './resolveBin.js'

export const ALLOWED_COMMANDS = [
  'whoami',
  'listProjects',
  'browsePage',
  'browsePageChanges',
  'browseRelatedPages',
  'readPage',
  'readFileInfo',
  'readProjectMembers',
  'listPages',
  'list1hopLinks',
  'list2hopLinks',
  'searchVector',
  'searchFullText',
  'search1hopLinks',
  'search2hopLinks',
  'previewEdit',
  'submitEdit',
] as const

export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number]

export interface CliRequest {
  command: AllowedCommand
  args: string[]
  stdin?: string
  pat: string
  timeoutMs: number
  maxStdinBytes: number
  maxStdoutBytes: number
  maxStderrBytes: number
  signal?: AbortSignal
}

/** stdinが上限を超えた。CLIを起動する前に弾く。 */
export class CliStdinTooLargeError extends Error {
  constructor(bytes: number, maxBytes: number) {
    super(`stdin is ${bytes} bytes, which exceeds the limit of ${maxBytes}`)
    this.name = 'CliStdinTooLargeError'
  }
}

/** CLIを起動する前にrequestが中断されていた。 */
export class CliAbortedError extends Error {
  constructor() {
    super('request was aborted before the command started')
    this.name = 'CliAbortedError'
  }
}

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
  timedOut: boolean
}

class Semaphore {
  private available: number
  private readonly queue: Array<() => void> = []

  constructor(concurrency: number) {
    this.available = concurrency
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1
      return () => this.release()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.available -= 1
        resolve(() => this.release())
      })
    })
  }

  private release(): void {
    this.available += 1
    const next = this.queue.shift()
    if (next) {
      next()
    }
  }
}

function collectStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): { get: () => { text: string; truncated: boolean } } {
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false

  stream.on('data', (chunk: Buffer) => {
    if (truncated) {
      return
    }
    total += chunk.length
    if (total > maxBytes) {
      const remaining = maxBytes - (total - chunk.length)
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining))
      }
      truncated = true
      return
    }
    chunks.push(chunk)
  })

  return {
    get: () => ({ text: Buffer.concat(chunks).toString('utf8'), truncated }),
  }
}

export class CliExecutor {
  private readonly semaphore: Semaphore

  constructor(maxConcurrency: number) {
    this.semaphore = new Semaphore(maxConcurrency)
  }

  async execute(request: CliRequest): Promise<CliResult> {
    if (request.stdin !== undefined) {
      const bytes = Buffer.byteLength(request.stdin, 'utf8')
      if (bytes > request.maxStdinBytes) {
        throw new CliStdinTooLargeError(bytes, request.maxStdinBytes)
      }
    }

    const release = await this.semaphore.acquire()
    try {
      // AbortSignalはlistener登録より後のabortしか通知しない。キュー待ちの間に
      // 切断されたrequestや、渡された時点で既にabort済みのrequestが、ここまで来て
      // CLIをspawnしてしまうため、spawn直前に現在の状態を直接見る。
      if (request.signal?.aborted) {
        throw new CliAbortedError()
      }
      return await this.run(request)
    } finally {
      release()
    }
  }

  private run(request: CliRequest): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      const bin = resolveCosenseBin()
      const controller = new AbortController()
      let timedOut = false

      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, request.timeoutMs)

      const onExternalAbort = () => controller.abort()
      request.signal?.addEventListener('abort', onExternalAbort)

      const child = spawn(bin, [request.command, ...request.args], {
        shell: false,
        signal: controller.signal,
        env: {
          COSENSE_PAT: request.pat,
          PATH: process.env.PATH ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const stdoutCollector = collectStream(
        child.stdout,
        request.maxStdoutBytes,
      )
      const stderrCollector = collectStream(
        child.stderr,
        request.maxStderrBytes,
      )

      child.on('error', (error) => {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onExternalAbort)
        // spawnにsignalを渡してabortすると、closeより先にAbortErrorがerrorイベントとして
        // 発生する。これは異常終了ではなく意図した中断なので、rejectせずtimedOut結果を返す。
        if (controller.signal.aborted) {
          const stdout = stdoutCollector.get()
          const stderr = stderrCollector.get()
          resolve({
            stdout: stdout.text,
            stderr: stderr.text,
            exitCode: null,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            timedOut,
          })
          return
        }
        reject(error)
      })

      child.on('close', (exitCode) => {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onExternalAbort)
        const stdout = stdoutCollector.get()
        const stderr = stderrCollector.get()
        resolve({
          stdout: stdout.text,
          stderr: stderr.text,
          exitCode,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          timedOut,
        })
      })

      if (request.stdin !== undefined) {
        child.stdin.end(request.stdin, 'utf8')
      } else {
        child.stdin.end()
      }
    })
  }
}
