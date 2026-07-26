/**
 * CLIのエラー出力には、CLIを手で叩く前提の復旧指示が混ざる。
 * その代表が `Run \`cosense login <target>\` to authenticate.` で、
 * 認証情報が無い時とHTTP 401/403の時に上流CLIの複数箇所から出力される。
 *
 * このサーバーの認証はMCPクライアント経由のOAuthで、CLIのloginコマンドは経路として
 * 存在しない。指示をそのままtool resultに載せるとAIがユーザーにターミナルを開かせようと
 * するので、MCP上で実際に取れる行動に書き換えてから返す。
 */

const CLI_LOGIN_INSTRUCTION = /\s*Run `cosense login [^`]*` to authenticate\./g

const OAUTH_GUIDANCE = [
  '',
  '',
  'このサーバーの認証はMCPクライアント経由のOAuthで行うため、`cosense login` は実行できません。',
  'AI側で復旧する手段はありません。ユーザーに次のどちらかを依頼してください:',
  '  - MCPクライアント上でこのサーバーの接続を再認可する (トークンが失効している場合)',
  '  - 対象projectのメンバーになっているか確認する (権限が足りない場合)',
].join('\n')

/** CLI前提の復旧指示を、MCP上で実行可能な案内に置き換える。 */
export function rewriteCliGuidance(text: string): string {
  return text.replace(CLI_LOGIN_INSTRUCTION, OAUTH_GUIDANCE)
}
