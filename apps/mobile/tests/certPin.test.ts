import { describe, expect, it } from 'vitest'
import { fingerprintsMatch, normalizeFingerprint } from '../src/lib/certPin.ts'

const digest = 'aa'.repeat(32)

describe('normalizeFingerprint', () => {
  it('lowercases and strips colons from an OpenSSL-style fingerprint', () => {
    const colonForm = digest.toUpperCase().match(/.{2}/g)!.join(':')
    expect(normalizeFingerprint(colonForm)).toBe(digest)
  })

  it('strips whitespace', () => {
    expect(normalizeFingerprint(`  ${digest}  `)).toBe(digest)
  })
})

describe('fingerprintsMatch', () => {
  it('matches identical hex digests regardless of case or separators', () => {
    const colonUpper = digest.toUpperCase().match(/.{2}/g)!.join(':')
    expect(fingerprintsMatch(digest, colonUpper)).toBe(true)
  })

  it('rejects a mismatched digest', () => {
    const other = 'bb'.repeat(32)
    expect(fingerprintsMatch(digest, other)).toBe(false)
  })

  it('rejects a digest of the wrong length', () => {
    expect(fingerprintsMatch(digest, 'aa')).toBe(false)
  })

  it('rejects an empty observed fingerprint', () => {
    expect(fingerprintsMatch(digest, '')).toBe(false)
  })
})
