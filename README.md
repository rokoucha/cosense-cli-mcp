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
