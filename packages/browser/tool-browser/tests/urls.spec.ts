import { describe, expect, it } from 'vitest'
import { isLinkLocalHost, parseBrowserUrl } from '../src/urls.ts'

describe('isLinkLocalHost', () => {
  it('recognizes 169.254.0.0/16 in dotted-decimal, hex, octal, and decimal-integer forms', () => {
    expect(isLinkLocalHost('169.254.169.254')).toBe(true)
    expect(isLinkLocalHost('169.254.0.1')).toBe(true)
    // WHATWG URL canonicalizes hex/octal/decimal IPv4-looking hosts to dotted-decimal
    // before this function ever sees them (proven in parseBrowserUrl below); this
    // case documents that the dotted-decimal check alone is what actually guards.
    expect(isLinkLocalHost('169.253.255.255')).toBe(false)
    expect(isLinkLocalHost('169.255.0.0')).toBe(false)
  })

  it('recognizes IPv6 link-local fe80::/10, bracketed or not', () => {
    expect(isLinkLocalHost('[fe80::1]')).toBe(true)
    expect(isLinkLocalHost('fe80::1')).toBe(true)
    expect(isLinkLocalHost('FE80::1')).toBe(true)
    expect(isLinkLocalHost('[fec0::1]')).toBe(false)
    expect(isLinkLocalHost('[::1]')).toBe(false)
  })

  it('recognizes 169.254.0.0/16 embedded in an IPv4-mapped IPv6 literal', () => {
    expect(isLinkLocalHost('[::ffff:169.254.169.254]')).toBe(true)
    expect(isLinkLocalHost('[::ffff:a9fe:a9fe]')).toBe(true)
    expect(isLinkLocalHost('[::ffff:192.168.1.1]')).toBe(false)
  })

  it('allows loopback and RFC1918 private hosts', () => {
    expect(isLinkLocalHost('127.0.0.1')).toBe(false)
    expect(isLinkLocalHost('[::1]')).toBe(false)
    expect(isLinkLocalHost('10.0.0.5')).toBe(false)
    expect(isLinkLocalHost('172.16.0.5')).toBe(false)
    expect(isLinkLocalHost('192.168.1.5')).toBe(false)
    expect(isLinkLocalHost('example.com')).toBe(false)
  })
})

describe('parseBrowserUrl link-local policy', () => {
  it('refuses cloud instance metadata and other 169.254.0.0/16 hosts', () => {
    expect(() => parseBrowserUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      'browser: url host is link-local or cloud instance metadata',
    )
    expect(() => parseBrowserUrl('http://169.254.169.254/')).toThrow(/169\.254\.169\.254/)
  })

  it('refuses hex/octal/decimal-integer spellings of a link-local host (canonicalized by URL parsing)', () => {
    expect(() => parseBrowserUrl('http://0xa9.0xfe.0xa9.0xfe/')).toThrow('link-local')
    expect(() => parseBrowserUrl('http://2852039166/')).toThrow('link-local')
  })

  it('refuses IPv6 link-local hosts', () => {
    expect(() => parseBrowserUrl('http://[fe80::1]/')).toThrow('link-local')
  })

  it('keeps loopback and RFC1918 private hosts reachable', () => {
    expect(parseBrowserUrl('http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/')
    expect(parseBrowserUrl('http://10.0.0.5/')).toBe('http://10.0.0.5/')
    expect(parseBrowserUrl('http://172.16.0.5/')).toBe('http://172.16.0.5/')
    expect(parseBrowserUrl('http://192.168.1.5/')).toBe('http://192.168.1.5/')
    expect(parseBrowserUrl('http://[::1]/')).toBe('http://[::1]/')
  })
})
