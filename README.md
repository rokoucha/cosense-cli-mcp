# cosense-cli-mcp

[`@helpfeel/cosense-cli`](https://github.com/helpfeel/cosense-cli)をMCP経由で使えるようにするサーバー。

## 使い方

必要な環境変数を設定して起動すると動きます。任意のものは記載してません。

```
ISSUER=https://cosense-mcp.example.com
LOG_HASH_SECRET=<base64url 32byte>
JWE_KEYS_AUTHORIZE_REQUEST=k1:<base64url 32byte>
JWE_KEYS_AUTHORIZATION_CODE=k1:<base64url 32byte>
JWE_KEYS_ACCESS_TOKEN=k1:<base64url 32byte>
JWE_KEYS_REFRESH_TOKEN=k1:<base64url 32byte>
OAUTH_CLIENTS_JSON=[{"id":"chatgpt","redirectUris":["https://chatgpt.com/connector_platform_oauth_redirect"]}]
```

鍵生成: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

`NODE_ENV=production`時はこれらが未設定だと起動失敗。それ以外は自動生成した使い捨て鍵で動く(開発用)。

## Docker起動例

```bash
docker run -p 3000:3000 \
  -e ISSUER=https://cosense-mcp.example.com \
  -e LOG_HASH_SECRET=... \
  -e JWE_KEYS_AUTHORIZE_REQUEST=k1:... \
  -e JWE_KEYS_AUTHORIZATION_CODE=k1:... \
  -e JWE_KEYS_ACCESS_TOKEN=k1:... \
  -e JWE_KEYS_REFRESH_TOKEN=k1:... \
  -e OAUTH_CLIENTS_JSON='[{"id":"chatgpt","redirectUris":["https://chatgpt.com/connector_platform_oauth_redirect"]}]' \
  ghcr.io/rokoucha/cosense-cli-mcp:latest
```

## License

Copyright (c) 2026 Rokoucha

Released under the MIT license, see LICENSE.

## 動的クライアント登録

`/.well-known/oauth-authorization-server` の `registration_endpoint` で公開する
`POST /register` にJSONを送るとクライアントを登録できます。事前登録の
`OAUTH_CLIENTS_JSON` は任意で、引き続き利用できます。

```json
{
  "client_name": "My MCP client",
  "redirect_uris": ["https://client.example.com/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

認証方式は `none` と `client_secret_post`（省略時）に対応します。
後者では登録応答の `client_secret` を `/token` に送ります。
認可にはどちらもPKCE S256が必須です。redirect URIはHTTPS、またはローカル開発用の
HTTP loopback URLを登録し、認可時は完全一致で検証します。

登録情報は署名付きclient IDに保持するため、DBや永続ボリュームは不要です。
署名には `JWE_KEYS_REFRESH_TOKEN` から用途別に導出した鍵を使います。
全インスタンスで同じ鍵と `ISSUER` を設定してください。登録時の鍵を削除すると、
その鍵で登録したクライアントは再登録が必要です。個別の登録更新・削除には対応しません。
