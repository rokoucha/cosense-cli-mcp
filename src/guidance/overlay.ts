import {
  CLI_VERSION,
  SKILL_LICENSE_ID,
  SKILL_REF,
} from '../generated/contract.js'

/**
 * 上流のAgent Skillは、CLIをshellから叩く前提で書かれている。
 * このoverlayはその前提とMCPの差のうち、tool一覧とinput schemaからは
 * 読み取れないものだけを補う。コマンドごとの読み替え表は意図的に持たない
 * (上流が動いた時、古い対応表は「積極的に間違った事」を主張してしまうため)。
 */

export const PREAMBLE = `# このサーバー (cosense-cli-mcp) について

以下はCosense公式CLI \`@helpfeel/cosense-cli\` (v${CLI_VERSION}) に同梱されているAgent Skillを、
そのまま取り込んだものである。原文はCLIをshellから実行する前提で書かれているが、このサーバーは
同じ機能をMCP toolとして公開している。読み替えに必要なのは以下だけで、あとは原文どおりに動けばよい。

- \`cosense <command> <args...>\` は同名のMCP toolに対応する。引数はJSONのフィールドとして渡す
  (位置引数・フラグ・stdinの区別は無い)。正確な入力形式は各toolのinput schemaが持っている
- \`cosense <command> --help\` は \`help({ command })\` で読める。スキルが「使う前にhelpを読め」と
  指示している箇所では、このtoolを使う
- スキル中の相対リンク (例: \`[read-page.md](read-page.md)\`) は、そのファイル名をそのまま
  \`guide({ topic: "read-page.md" })\` に渡せば読める
- スキルのコマンド一覧表には、このサーバーが公開していないコマンドも載っている。
  実際に使えるものはtool一覧が正
- shellでのクォート、stdinへのpipe、\`--input-file\` に関する記述は、tool呼び出しには
  当てはまらないので無視してよい

スキル中でユーザーへの確認 (AskUserQuestion) を求めている箇所は、ユーザーに問いかける手段が
あるならそうする。無ければスキルが規定するデフォルトを採用してそのまま進む。

上流スキルの著作権は Helpfeel Inc. にあり、ライセンスは ${SKILL_LICENSE_ID}。
取得元: https://github.com/helpfeel/cosense-cli (${SKILL_REF})
`

export const LOGIN_DOC = `# 認証エラーが返ってきた時

このサーバーの認証はMCPクライアント経由のOAuthで行う。CLIの \`cosense login\` に相当するtoolは
無く、AIが認証をやり直す手段は存在しない。

HTTP 401 / 403 が返ってきたら:

1. 権限の無いprojectを見に行っていないか、URLを確認する
2. 解決しなければユーザーに次のどちらかを依頼して、そこで作業を止める
   - MCPクライアント上でこのサーバーの接続を再認可する (トークンが失効している場合)
   - 対象projectのメンバーになっているか確認する (権限が足りない場合)

同じ操作をリトライしても解決しない。認証が解決したとユーザーから報告を受けてから、
最初に失敗した操作を再実行する。
`

export const VERSION_MISMATCH_DOC = `# toolの挙動がスキルと違う時

スキル・help・input schemaが食い違う時は、**input schemaとhelpが正**である。
スキルは上流リポジトリの特定refから固定で取り込んでいるため、先に古くなるのはスキルの側になる。

1. \`help({ command })\` を読み、引数・戻り値・HTTPエラーが手順どおりか確認する
2. スキルが参照しているコマンドがtool一覧に無いなら、このサーバーは公開していない。
   代替のtoolで目的を達成できないか検討する
3. それでも説明が付かない場合はユーザーに次を伝える
   - 発生した症状
   - CLI version: ${CLI_VERSION}
   - スキルのref: ${SKILL_REF}
`
