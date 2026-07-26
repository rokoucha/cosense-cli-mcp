import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

vi.mock('./resolveBin.js', () => ({
  resolveCosenseBin: () => '/fake/bin/cosense',
}))

interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  stdin: Writable
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  const written: Buffer[] = []
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      written.push(Buffer.from(chunk))
      cb()
    },
  })
  return child
}

const { CliExecutor } = await import('./executor.js')

describe('CliExecutor', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with stdout/stderr and exit code on success', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'whoami',
      args: ['https://scrapbox.io'],
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })

    await nextTick()
    child.stdout.end('{"id":"abc"}')
    child.stderr.end('')
    child.emit('close', 0)

    const result = await resultPromise
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"id":"abc"}')
    expect(result.timedOut).toBe(false)
    expect(result.stdoutTruncated).toBe(false)

    expect(spawnMock).toHaveBeenCalledWith(
      '/fake/bin/cosense',
      ['whoami', 'https://scrapbox.io'],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({ COSENSE_PAT: 'fake-pat' }),
      }),
    )
  })

  it('propagates a non-zero exit code with stderr', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'readPage',
      args: ['https://scrapbox.io/shokai/foo'],
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })

    await nextTick()
    child.stdout.end('')
    child.stderr.end('HTTP 404')
    child.emit('close', 1)

    const result = await resultPromise
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('HTTP 404')
  })

  it('truncates stdout beyond the configured byte limit', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'listPages',
      args: ['https://scrapbox.io/shokai'],
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 5,
      maxStderrBytes: 1024,
    })

    await nextTick()
    child.stdout.end('0123456789')
    child.stderr.end('')
    child.emit('close', 0)

    const result = await resultPromise
    expect(result.stdout).toBe('01234')
    expect(result.stdoutTruncated).toBe(true)
  })

  it('writes stdin and closes it', async () => {
    const child = createFakeChild()
    const writeSpy = vi.spyOn(child.stdin, 'end')
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'previewEdit',
      args: ['https://scrapbox.io/shokai', 'a'.repeat(24)],
      stdin: '{"ops":[]}',
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })

    await nextTick()
    child.stdout.end('')
    child.stderr.end('')
    child.emit('close', 0)
    await resultPromise

    expect(writeSpy).toHaveBeenCalledWith('{"ops":[]}', 'utf8')
  })

  it('resolves with timedOut:true instead of rejecting when the timeout aborts the process', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'readPage',
      args: ['https://scrapbox.io/shokai/foo'],
      pat: 'fake-pat',
      timeoutMs: 20,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })

    // spawnにsignalを渡してabortすると、Node.jsはcloseより先にerrorイベントで
    // AbortErrorを発生させる。ここではそれを再現する。
    await new Promise((resolve) => setTimeout(resolve, 30))
    child.emit('error', new Error('This operation was aborted'))

    const result = await resultPromise
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('propagates a genuine spawn error (not caused by our own abort)', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child)

    const executor = new CliExecutor(4)
    const resultPromise = executor.execute({
      command: 'readPage',
      args: ['https://scrapbox.io/shokai/foo'],
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })

    await nextTick()
    child.emit('error', new Error('ENOENT: no such file or directory'))

    await expect(resultPromise).rejects.toThrow('ENOENT')
  })

  it('runs at most maxConcurrency executions at a time', async () => {
    const children = [createFakeChild(), createFakeChild(), createFakeChild()]
    let callIndex = 0
    spawnMock.mockImplementation(() => children[callIndex++]!)

    const executor = new CliExecutor(2)
    const request = {
      command: 'whoami' as const,
      args: ['https://scrapbox.io'],
      pat: 'fake-pat',
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    }

    const p1 = executor.execute(request)
    const p2 = executor.execute(request)
    const p3 = executor.execute(request)

    // 2 concurrency分だけ即座にspawnされ、3件目は最初の完了待ち
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(spawnMock).toHaveBeenCalledTimes(2)

    children[0]!.stdout.end('')
    children[0]!.stderr.end('')
    children[0]!.emit('close', 0)
    await p1

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(spawnMock).toHaveBeenCalledTimes(3)

    children[1]!.stdout.end('')
    children[1]!.stderr.end('')
    children[1]!.emit('close', 0)
    children[2]!.stdout.end('')
    children[2]!.stderr.end('')
    children[2]!.emit('close', 0)
    await Promise.all([p2, p3])
  })
})
