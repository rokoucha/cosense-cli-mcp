/**
 * このサーバーが発行しうる全scope。
 *
 * discovery文書(PRM / AS metadata)、401 challenge、`/authorize` の検証で同じ値を使う。
 * ここが唯一の定義なので、片方だけ増えてクライアントが要求できないscopeが生まれる事はない。
 */
export const ALL_SCOPES = [
  'cosense:read',
  'cosense:write',
  'offline_access',
] as const

export type Scope = (typeof ALL_SCOPES)[number]
