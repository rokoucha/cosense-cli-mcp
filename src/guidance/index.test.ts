import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { ALLOWED_COMMANDS } from '../cli/executor.js'
import { CLI_VERSION, SKILL_REF } from '../generated/contract.js'
import {
  GUIDE_TOPIC_NAMES,
  buildInstructions,
  guideTopic,
  helpText,
} from './index.js'

const require = createRequire(import.meta.url)
const installedCliVersion = (
  require('@helpfeel/cosense-cli/package.json') as { version: string }
).version

describe('baked upstream texts', () => {
  it('tracks the installed CLI version', () => {
    expect(CLI_VERSION).toBe(installedCliVersion)
    expect(SKILL_REF).toBe(`v${installedCliVersion}`)
  })
})

describe('guide topics', () => {
  /**
   * 上流スキルは他のスキルを `[read-page.md](read-page.md)` という相対リンクで参照する。
   * topic名をそのファイル名に揃えてあるので、AIはスキルで見た名前をそのまま渡せる。
   * リンク先が引けなくなるとスキルの導線が切れるため、実際に登場するリンクを全て検証する。
   */
  it('resolves every relative link that appears in the upstream skill docs', () => {
    const linked = new Set<string>()
    for (const topic of GUIDE_TOPIC_NAMES) {
      const content = guideTopic(topic) as string
      for (const match of content.matchAll(/\]\((?!https?:)([^)]+\.md)\)/g)) {
        linked.add(match[1] as string)
      }
    }

    expect(linked.size).toBeGreaterThan(0)
    for (const name of linked) {
      expect(guideTopic(name)).toBeTypeOf('string')
    }
  })

  it('replaces the upstream login procedure with the OAuth one', () => {
    const login = guideTopic('login.md') as string
    expect(login).toContain('OAuth')
    expect(login).toContain('再認可')
    // CLIのloginを実行させる手順が残っていない事(言及はするが指示はしない)
    expect(login).not.toMatch(/cosense login --help/)
    expect(login).not.toMatch(/別のターミナル/)
  })

  it('prefixes the skill entry point with the MCP overlay', () => {
    const skill = guideTopic('SKILL.md') as string
    expect(skill).toContain('cosense-cli-mcp')
    expect(skill).toContain('help({ command })')
    expect(skill).toContain('guide({ topic:')
    // 上流本文が続いている事
    expect(skill).toContain('Cosense Skill 手順書')
  })

  it('serves the skill entry point as server instructions', () => {
    expect(buildInstructions()).toBe(guideTopic('SKILL.md'))
  })
})

describe('help texts', () => {
  it.each(ALLOWED_COMMANDS)('has usage for "%s"', (command) => {
    expect(helpText(command)).toContain('Usage:')
  })

  it('returns undefined for commands this server does not expose', () => {
    expect(helpText('login')).toBeUndefined()
    expect(helpText('downloadFile')).toBeUndefined()
  })
})
