import { describe, expect, it } from 'vitest'
import {
  buildPairRequestBody,
  isPairingExpired,
  parsePairingPayload,
  PairingPayloadError,
} from '../src/lib/pairing.ts'

const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
const past = new Date(Date.now() - 60 * 1000).toISOString()
const fingerprint = 'a'.repeat(64)

function lanPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    name: 'izzy-pc',
    url: 'https://192.168.1.42:8443',
    token: 'opaque-token-abc',
    fingerprint,
    expires: future,
    ...overrides,
  })
}

function tunnelPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    name: 'izzy-pc',
    url: 'https://saturn-abc123.trycloudflare.com',
    token: 'opaque-token-abc',
    expires: future,
    ...overrides,
  })
}

describe('parsePairingPayload', () => {
  it('parses a well-formed LAN payload', () => {
    const payload = parsePairingPayload(lanPayload())
    expect(payload).toEqual({
      v: 1,
      name: 'izzy-pc',
      url: 'https://192.168.1.42:8443',
      token: 'opaque-token-abc',
      fingerprint,
      expires: future,
    })
  })

  it('parses a well-formed tunnel payload with no fingerprint', () => {
    const payload = parsePairingPayload(tunnelPayload())
    expect(payload.fingerprint).toBeUndefined()
    expect(payload.url).toContain('trycloudflare.com')
  })

  it('rejects invalid JSON', () => {
    expect(() => parsePairingPayload('not json')).toThrow(PairingPayloadError)
  })

  it('rejects a non-object payload', () => {
    expect(() => parsePairingPayload('42')).toThrow(PairingPayloadError)
  })

  it('rejects an unsupported version', () => {
    expect(() => parsePairingPayload(lanPayload({ v: 2 }))).toThrow(/version/)
  })

  it('rejects a missing token', () => {
    expect(() => parsePairingPayload(lanPayload({ token: '' }))).toThrow(PairingPayloadError)
  })

  it('rejects a non-https url', () => {
    expect(() => parsePairingPayload(lanPayload({ url: 'http://192.168.1.42:8443' }))).toThrow(/https/)
  })

  it('rejects a malformed expires field', () => {
    expect(() => parsePairingPayload(lanPayload({ expires: 'not-a-date' }))).toThrow(PairingPayloadError)
  })

  it('rejects a malformed fingerprint', () => {
    expect(() => parsePairingPayload(lanPayload({ fingerprint: 'zz' }))).toThrow(/fingerprint/)
  })

  it('rejects a LAN payload with no fingerprint', () => {
    expect(() => parsePairingPayload(lanPayload({ fingerprint: undefined }))).toThrow(/fingerprint/)
  })
})

describe('isPairingExpired', () => {
  it('is false before the expiry time', () => {
    const payload = parsePairingPayload(lanPayload({ expires: future }))
    expect(isPairingExpired(payload, new Date())).toBe(false)
  })

  it('is true after the expiry time', () => {
    const payload = parsePairingPayload(tunnelPayload({ expires: future }))
    expect(isPairingExpired(payload, new Date(Date.parse(future) + 1))).toBe(true)
  })

  it('rejects an already-expired payload at parse time is not enforced (caller checks separately)', () => {
    // parsePairingPayload only validates shape; expiry is a runtime check against "now".
    const payload = parsePairingPayload(tunnelPayload({ expires: past }))
    expect(isPairingExpired(payload)).toBe(true)
  })
})

describe('buildPairRequestBody', () => {
  it('shapes the exchange body per the pairing contract', () => {
    const payload = parsePairingPayload(lanPayload())
    const body = buildPairRequestBody(payload, { name: 'izzy iPhone', platform: 'ios' })
    expect(body).toEqual({
      token: 'opaque-token-abc',
      device: { name: 'izzy iPhone', platform: 'ios' },
    })
  })
})
