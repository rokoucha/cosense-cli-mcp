import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { ALLOWED_COMMANDS } from './executor.js'
import { resolveCosenseBin } from './resolveBin.js'

/**
 * `@helpfeel/cosense-cli` はexact versionのdependencyとして固定している。
 * このテストはインストール済みのCLIが設計どおりのversion/command面を
 * 提供し続けていることを、実バイナリを起動して契約テストする。
 * private Cosense projectや実PATには依存しない(--help/--versionのみ使用)。
 */

const require = createRequire(import.meta.url)
const cosenseCliVersion = (
  require('@helpfeel/cosense-cli/package.json') as { version: string }
).version

function runCli(args: string[]): { stdout: string; status: number | null } {
  try {
    const stdout = execFileSync(resolveCosenseBin(), args, {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 10_000,
    })
    return { stdout, status: 0 }
  } catch (error) {
    const execError = error as { stdout?: string; status?: number | null }
    return { stdout: execError.stdout ?? '', status: execError.status ?? null }
  }
}

describe('cosense-cli contract', () => {
  it('reports the exact pinned version', () => {
    const { stdout, status } = runCli(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe(`cosense v${cosenseCliVersion}`)
  })

  it('lists every allowed command in the top-level --help output', () => {
    const { stdout, status } = runCli(['--help'])
    expect(status).toBe(0)
    for (const command of ALLOWED_COMMANDS) {
      expect(stdout).toContain(command)
    }
  })

  it.each(ALLOWED_COMMANDS)('exposes --help for command "%s"', (command) => {
    const { stdout, status } = runCli([command, '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Usage:')
  })

  it('whoami/listProjects usage requires a single <origin> argument', () => {
    for (const command of ['whoami', 'listProjects']) {
      const { stdout } = runCli([command, '--help'])
      expect(stdout).toMatch(new RegExp(`cosense ${command} <origin>`))
    }
  })

  it('listPages usage documents --sort/--limit/--skip/--filter', () => {
    const { stdout } = runCli(['listPages', '--help'])
    expect(stdout).toContain('--sort')
    expect(stdout).toContain('--limit')
    expect(stdout).toContain('--skip')
    expect(stdout).toContain('--filter')
  })

  it('previewEdit usage documents --new and stdin-based ops', () => {
    const { stdout } = runCli(['previewEdit', '--help'])
    expect(stdout).toContain('--new')
    expect(stdout).toContain('previewId')
  })

  it('submitEdit usage takes <projectUrl> <previewId>', () => {
    const { stdout } = runCli(['submitEdit', '--help'])
    expect(stdout).toMatch(/cosense submitEdit <projectUrl> <previewId>/)
  })
})
