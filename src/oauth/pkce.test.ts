import { describe, expect, it } from 'vitest'
import { computeS256Challenge } from './pkce.js'

describe('computeS256Challenge', () => {
  // RFC 7636 Appendix B test vector
  it('matches the RFC 7636 test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(computeS256Challenge(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('produces different challenges for different verifiers', () => {
    expect(computeS256Challenge('verifier-a')).not.toBe(
      computeS256Challenge('verifier-b'),
    )
  })
})
