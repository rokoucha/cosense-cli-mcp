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

/** MCPでは公開しないが、上流CLIに存在することを意図しているコマンド。 */
const CLI_ONLY_COMMANDS = ['login'] as const

function topLevelCommands(help: string): string[] {
  const commandsSection = help.split(/^Commands:\s*$/m)[1]
  if (commandsSection === undefined) {
    throw new Error('top-level help has no Commands section')
  }
  return [...commandsSection.matchAll(/^  (\S+)\s{2,}/gm)].map(
    (match) => match[1] as string,
  )
}

function usageSection(help: string): string {
  const afterHeading = help.split(/^Usage:\s*$/m)[1]
  if (afterHeading === undefined) {
    throw new Error('command help has no Usage section')
  }
  return (afterHeading.split(/\n(?=\S)/)[0] as string).trim()
}

describe('cosense-cli contract', () => {
  it('reports the exact pinned version', () => {
    const { stdout, status } = runCli(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe(`cosense v${cosenseCliVersion}`)
  })

  it('keeps the complete upstream command inventory accounted for', () => {
    const { stdout, status } = runCli(['--help'])
    expect(status).toBe(0)
    expect(topLevelCommands(stdout).sort()).toEqual(
      [...ALLOWED_COMMANDS, ...CLI_ONLY_COMMANDS].sort(),
    )
  })

  /**
   * 上流CLIの引数・option変更をRenovate PRのCIで検出する。
   * 意図した更新時は以下でsnapshotを更新し、差分をレビューする:
   * pnpm run contract && pnpm exec vitest run src/cli/contract.test.ts -u
   */
  it('matches the reviewed usage signatures for every upstream command', () => {
    const signatures = Object.fromEntries(
      topLevelCommands(runCli(['--help']).stdout).map((command) => [
        command,
        usageSection(runCli([command, '--help']).stdout),
      ]),
    )
    expect(signatures).toMatchSnapshot()
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

  it('downloadFile usage takes <fileUrl> <outputPath> and documents --thumbnail', () => {
    const { stdout } = runCli(['downloadFile', '--help'])
    expect(stdout).toMatch(/cosense downloadFile <fileUrl> <outputPath>/)
    expect(stdout).toContain('--thumbnail')
    // registerToolsは一時directoryを自分で作る。CLIが親を作らない前提が変わっていないか見る。
    expect(stdout).toContain('親ディレクトリは自動作成しない')
  })

  it('uploadFile usage takes project URL and file path', () => {
    const { stdout } = runCli(['uploadFile', '--help'])
    expect(stdout).toMatch(/cosense uploadFile <projectUrl> <filePath>/)
    expect(stdout).toContain('--content-type')
  })

  it('page snapshot commands document their IDs', () => {
    expect(runCli(['listPageSnapshots', '--help']).stdout).toMatch(
      /cosense listPageSnapshots <projectUrl> <pageId>/,
    )
    expect(runCli(['readPageSnapshot', '--help']).stdout).toMatch(
      /cosense readPageSnapshot <projectUrl> <pageId> <snapshotId>/,
    )
  })

  it('delete commands document their targets', () => {
    expect(runCli(['deleteFile', '--help']).stdout).toMatch(
      /cosense deleteFile <fileUrl>/,
    )
    expect(runCli(['previewDelete', '--help']).stdout).toMatch(
      /cosense previewDelete <projectUrl> <pageId>/,
    )
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

  it('replaceLinks usage takes project URL and old/new titles', () => {
    const { stdout } = runCli(['replaceLinks', '--help'])
    expect(stdout).toMatch(
      /cosense replaceLinks <projectUrl> <oldTitle> <newTitle>/,
    )
  })
})
