import { describe, expect, it } from 'vitest'
import { rewriteCliGuidance } from './cliMessage.js'

/**
 * 上流CLIは認証まわりの失敗時に `cosense login` の実行を促す。
 * このサーバーではその経路が存在しないため、tool resultに載る前に書き換わる事を保証する。
 */

describe('rewriteCliGuidance', () => {
  const upstreamMessages = [
    // request.ts: HTTP 401/403
    'HTTP 401 Unauthorized\nhttps://scrapbox.io/api/pages/foo\n\n\nRun `cosense login https://scrapbox.io` to authenticate.',
    // whoami.ts / listProjects.ts: PATが無い
    'No Personal Access Token found for https://scrapbox.io. Run `cosense login https://scrapbox.io` to authenticate.',
    // resolveFileCredential.ts: --project の資格情報が無い
    'No credential found for --project https://scrapbox.io/foo. Run `cosense login https://scrapbox.io/foo` to authenticate.',
  ]

  it.each(upstreamMessages)(
    'removes the CLI login instruction (%#)',
    (message) => {
      const rewritten = rewriteCliGuidance(message)
      // 実行を促す命令形が消えている事。書き換え後の本文は
      // 「`cosense login` は実行できません」と言及するので、単語の有無では判定しない。
      expect(rewritten).not.toContain('Run `cosense login')
      expect(rewritten).not.toContain('to authenticate.')
      expect(rewritten).toContain('OAuth')
      expect(rewritten).toContain('再認可')
    },
  )

  it('keeps the original diagnostic text', () => {
    const rewritten = rewriteCliGuidance(upstreamMessages[0] as string)
    expect(rewritten).toContain('HTTP 401 Unauthorized')
    expect(rewritten).toContain('https://scrapbox.io/api/pages/foo')
  })

  it('leaves unrelated stderr untouched', () => {
    const message =
      'HTTP 422 Unprocessable Entity\nops[0].insertBefore not found'
    expect(rewriteCliGuidance(message)).toBe(message)
  })
})
