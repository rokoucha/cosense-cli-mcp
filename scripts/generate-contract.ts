/**
 * 上流(@helpfeel/cosense-cli)の「AIに見せるテキスト」をビルド時に固めるスクリプト。
 *
 * 生成物は2種類:
 *   - skill: GitHubのタグ(CLIのexact versionから導出)から取得したAgent Skill
 *   - help : インストール済みCLIバイナリから生成した `<command> --help` の出力
 *
 * どちらもpinned versionの決定的な関数なので、実行時ではなくビルド時に固める。
 * CLIのversionが変われば取得し直す。上流がスキルを消したり改名したりすれば取得が404で
 * 落ちるので、静かに壊れる事はない。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_COMMANDS } from '../src/cli/executor.js'
import { resolveCosenseBin } from '../src/cli/resolveBin.js'

const UPSTREAM_REPO = 'helpfeel/cosense-cli'

/**
 * 生成物のフォーマット/取得対象を変えたら上げる。
 *
 * 再生成の要否をCLIのversionだけで判定すると、SKILL_DOC_PATHSやrenderModuleを
 * 変えてもCLIが据え置きの間は古い生成物が使い回され、変更が効いていないのに
 * ビルドが通ってしまう。
 */
const GENERATOR_VERSION = 3

/** 取得するスキル。上流の `skills/cosense/` 配下のパスをdoc名にマップする。 */
const SKILL_DOC_PATHS: Record<string, string> = {
  'SKILL.md': 'skills/cosense/SKILL.md',
  'read-page.md': 'skills/cosense/read-page.md',
  'edit-page.md': 'skills/cosense/edit-page.md',
  'upload-file.md': 'skills/cosense/upload-file.md',
}

/**
 * 上流リポジトリにLICENSEファイルは無く、package.jsonの `license` フィールドだけが
 * ライセンスを宣言している。スキルをそのまま同梱して配る以上、出所とライセンスは
 * 表示する必要があるので、宣言値をここから取る(ハードコードすると上流が変えた時に
 * 嘘を表示し続けるため)。
 */
const UPSTREAM_PACKAGE_JSON_PATH = 'package.json'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(repoRoot, 'src', 'generated', 'contract.ts')

interface Artifacts {
  cliVersion: string
  skillRef: string
  skillDocs: Record<string, string>
  licenseId: string
  helpTexts: Record<string, string>
}

function readCliVersion(): string {
  const require = createRequire(import.meta.url)
  return (require('@helpfeel/cosense-cli/package.json') as { version: string })
    .version
}

async function fetchUpstreamFile(ref: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${ref}/${path}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `上流ファイルの取得に失敗しました: ${url} (HTTP ${response.status})`,
    )
  }
  return await response.text()
}

function generateHelpText(command: string): string {
  return execFileSync(resolveCosenseBin(), [command, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 30_000,
  })
}

async function collectArtifacts(cliVersion: string): Promise<Artifacts> {
  const skillRef = `v${cliVersion}`

  const skillDocs: Record<string, string> = {}
  for (const [name, path] of Object.entries(SKILL_DOC_PATHS)) {
    skillDocs[name] = await fetchUpstreamFile(skillRef, path)
  }

  const upstreamPackageJson = JSON.parse(
    await fetchUpstreamFile(skillRef, UPSTREAM_PACKAGE_JSON_PATH),
  ) as { license?: string }
  const licenseId = upstreamPackageJson.license ?? ''
  if (licenseId === '') {
    throw new Error(
      `上流の ${UPSTREAM_PACKAGE_JSON_PATH} が license を宣言していません (${skillRef})`,
    )
  }

  const helpTexts: Record<string, string> = {}
  for (const command of ALLOWED_COMMANDS) {
    helpTexts[command] = generateHelpText(command)
  }

  return { cliVersion, skillRef, skillDocs, licenseId, helpTexts }
}

/**
 * 生成済みファイルが現在installされているCLIと現在の生成ロジックから作られたものなら
 * 再生成しない。2回目以降のローカル開発をオフラインで回せるようにするための短絡。
 */
function isUpToDate(cliVersion: string): boolean {
  if (!existsSync(outputPath)) {
    return false
  }
  const generated = readFileSync(outputPath, 'utf8')
  const versionMatch = /export const CLI_VERSION = "([^"]*)"/.exec(generated)
  const generatorMatch = /export const GENERATOR_VERSION = (\d+)/.exec(
    generated,
  )
  return (
    versionMatch?.[1] === cliVersion &&
    generatorMatch?.[1] === String(GENERATOR_VERSION)
  )
}

function renderRecord(record: Record<string, string>): string {
  const keys = Object.keys(record).sort()
  const lines = keys.map(
    (key) => `  ${JSON.stringify(key)}: ${JSON.stringify(record[key])},`,
  )
  return `{\n${lines.join('\n')}\n}`
}

function renderModule(artifacts: Artifacts): string {
  return `// このファイルは scripts/generate-contract.ts が生成する。手で編集しない。

/** 生成時にインストールされていた @helpfeel/cosense-cli のversion。 */
export const CLI_VERSION = ${JSON.stringify(artifacts.cliVersion)}

/** 生成に使った scripts/generate-contract.ts のフォーマットversion。 */
export const GENERATOR_VERSION = ${GENERATOR_VERSION}

/** スキルを取得した上流のgit ref。 */
export const SKILL_REF = ${JSON.stringify(artifacts.skillRef)}

/** 上流のAgent Skill。無改変。 */
export const SKILL_DOCS: Record<string, string> = ${renderRecord(artifacts.skillDocs)}

/** 上流が宣言しているライセンス。スキルの再配布時に表示する。 */
export const SKILL_LICENSE_ID = ${JSON.stringify(artifacts.licenseId)}

/** \`cosense <command> --help\` の出力。 */
export const HELP_TEXTS: Record<string, string> = ${renderRecord(artifacts.helpTexts)}
`
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const cliVersion = readCliVersion()

  if (!force && isUpToDate(cliVersion)) {
    return
  }

  const artifacts = await collectArtifacts(cliVersion)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderModule(artifacts), 'utf8')
}

await main()
