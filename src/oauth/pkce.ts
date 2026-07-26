import { createHash } from 'node:crypto'

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) */
export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
