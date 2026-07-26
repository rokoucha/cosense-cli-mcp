import { randomBytes } from 'node:crypto'

export const AUTHORIZE_FORM_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface AuthorizeFormParams {
  requestToken: string
  csrfToken: string
  clientId: string
  scope: string
  errorMessage?: string
}

export function renderAuthorizeForm(params: AuthorizeFormParams): string {
  const scopes = params.scope
    .split(' ')
    .filter(Boolean)
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join('')

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cosense連携の認可</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  ul { margin: 0.5rem 0 1.5rem; padding-left: 1.5rem; }
  label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
  input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.5rem; font-size: 1rem; }
  button { margin-top: 1rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; }
</style>
</head>
<body>
<main>
  <h1>Cosense Personal Access Tokenの入力</h1>
  <p>クライアント <strong>${escapeHtml(params.clientId)}</strong> が次の権限を要求しています:</p>
  <ul>${scopes}</ul>
  ${params.errorMessage ? `<p class="error">${escapeHtml(params.errorMessage)}</p>` : ''}
  <form method="post" action="/authorize" autocomplete="off">
    <input type="hidden" name="request_token" value="${escapeHtml(params.requestToken)}">
    <input type="hidden" name="csrf_token" value="${escapeHtml(params.csrfToken)}">
    <label for="pat">Cosense Personal Access Token</label>
    <input type="password" id="pat" name="pat" required autocomplete="off" autofocus>
    <button type="submit">認可する</button>
  </form>
</main>
</body>
</html>
`
}
