import { describe, expect, it } from 'vitest'
import {
  fileUrlSchema,
  originSchema,
  pageUrlSchema,
  projectUrlSchema,
} from './url.js'

const ORIGIN = 'https://scrapbox.io'

describe('originSchema', () => {
  const schema = originSchema(ORIGIN)

  it('accepts the exact allowed origin', () => {
    expect(schema.parse('https://scrapbox.io')).toBe('https://scrapbox.io')
  })

  it('rejects a different origin', () => {
    expect(schema.safeParse('https://evil.example.com').success).toBe(false)
  })

  it('rejects http (non-https)', () => {
    expect(schema.safeParse('http://scrapbox.io').success).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    expect(schema.safeParse('https://user:pass@scrapbox.io').success).toBe(
      false,
    )
  })

  it('rejects a trailing path', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai').success).toBe(false)
  })

  it('rejects a trailing dot host (bypass attempt)', () => {
    expect(schema.safeParse('https://scrapbox.io./').success).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(schema.safeParse('not a url').success).toBe(false)
  })
})

describe('projectUrlSchema', () => {
  const schema = projectUrlSchema(ORIGIN)

  it('accepts <origin>/<project>', () => {
    expect(schema.parse('https://scrapbox.io/shokai')).toBe(
      'https://scrapbox.io/shokai',
    )
  })

  it('accepts a trailing slash', () => {
    expect(schema.parse('https://scrapbox.io/shokai/')).toBe(
      'https://scrapbox.io/shokai/',
    )
  })

  it('rejects extra path segments', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai/page').success).toBe(
      false,
    )
  })

  it('rejects query strings', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai?x=1').success).toBe(
      false,
    )
  })

  it('rejects a different origin', () => {
    expect(schema.safeParse('https://evil.example.com/shokai').success).toBe(
      false,
    )
  })
})

describe('pageUrlSchema', () => {
  const schema = pageUrlSchema(ORIGIN)

  it('accepts <origin>/<project>/<page>', () => {
    expect(schema.parse('https://scrapbox.io/shokai/foo')).toBe(
      'https://scrapbox.io/shokai/foo',
    )
  })

  it('accepts a well-formed lineId fragment', () => {
    const lineId = 'a'.repeat(24)
    expect(schema.parse(`https://scrapbox.io/shokai/foo#${lineId}`)).toBe(
      `https://scrapbox.io/shokai/foo#${lineId}`,
    )
  })

  it('rejects query strings', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai/foo?x=1').success).toBe(
      false,
    )
  })

  it('rejects missing page segment', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai').success).toBe(false)
  })
})

describe('fileUrlSchema', () => {
  const schema = fileUrlSchema(ORIGIN)

  it('accepts /files/<fileId>', () => {
    const fileId = 'a'.repeat(24)
    expect(schema.parse(`https://scrapbox.io/files/${fileId}`)).toBe(
      `https://scrapbox.io/files/${fileId}`,
    )
  })

  it('accepts /files/<fileId>.<ext>', () => {
    const fileId = 'a'.repeat(24)
    expect(schema.parse(`https://scrapbox.io/files/${fileId}.pdf`)).toBe(
      `https://scrapbox.io/files/${fileId}.pdf`,
    )
  })

  it('rejects query strings', () => {
    const fileId = 'a'.repeat(24)
    expect(
      schema.safeParse(`https://scrapbox.io/files/${fileId}?x=1`).success,
    ).toBe(false)
  })

  it('rejects fragments', () => {
    const fileId = 'a'.repeat(24)
    expect(
      schema.safeParse(`https://scrapbox.io/files/${fileId}#x`).success,
    ).toBe(false)
  })

  it('rejects non-files paths', () => {
    expect(schema.safeParse('https://scrapbox.io/shokai/foo').success).toBe(
      false,
    )
  })
})
