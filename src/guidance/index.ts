import { HELP_TEXTS, SKILL_DOCS } from '../generated/contract.js'
import { LOGIN_DOC, PREAMBLE, VERSION_MISMATCH_DOC } from './overlay.js'

function upstreamDoc(name: string): string {
  const content = SKILL_DOCS[name]
  if (content === undefined) {
    throw new Error(
      `上流スキル ${name} が生成物に含まれていません。\`pnpm run contract --force\` を実行してください。`,
    )
  }
  return content
}

/**
 * guideのtopic名は、上流スキル中のリンク (`[read-page.md](read-page.md)`) と同じ文字列にする。
 * AIがスキルで見た名前をそのまま渡せば引けるので、名前の対応表が要らなくなる。
 *
 * login.md と version-mismatch.md は上流から取り込まず、このサーバー向けに書いたものを
 * 同じ名前で差し替えている。上流スキルからのリンクはそのまま新しい内容に解決される。
 */
export const GUIDE_TOPICS: Record<string, string> = {
  'SKILL.md': `${PREAMBLE}\n---\n\n${upstreamDoc('SKILL.md')}`,
  'read-page.md': upstreamDoc('read-page.md'),
  'edit-page.md': upstreamDoc('edit-page.md'),
  'login.md': LOGIN_DOC,
  'version-mismatch.md': VERSION_MISMATCH_DOC,
}

export const GUIDE_TOPIC_NAMES = Object.keys(GUIDE_TOPICS) as [
  string,
  ...string[],
]

export function guideTopic(topic: string): string | undefined {
  return GUIDE_TOPICS[topic]
}

export function helpText(command: string): string | undefined {
  return HELP_TEXTS[command]
}

/**
 * initializeでクライアントに渡すサーバー説明。
 * 上流SKILL.mdはスキルの入口なので、呼ばれるまで待たずここで配る。
 */
export function buildInstructions(): string {
  return GUIDE_TOPICS['SKILL.md'] as string
}
