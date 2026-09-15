/**
 * The generated LAN certificate is judged by Node's own X.509 parser and by a
 * real TLS handshake — the two verifiers that cannot be satisfied by a
 * plausible-looking byte string.
 */

import { X509Certificate, createPublicKey } from 'node:crypto'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeObjectIdentifier, generateSelfSignedCertificate } from '../src/certificate.ts'

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })

describe('object identifier encoding', () => {
  it('encodes the dotted arcs this certificate needs', () => {
    // Published DER encodings; the certificate is wrong if these drift.
    expect(Buffer.from(encodeObjectIdentifier('1.2.840.10045.4.3.2')).toString('hex')).toBe('2a8648ce3d040302')
    expect(Buffer.from(encodeObjectIdentifier('2.5.4.3')).toString('hex')).toBe('550403')
    expect(Buffer.from(encodeObjectIdentifier('2.5.29.17')).toString('hex')).toBe('551d11')
    expect(Buffer.from(encodeObjectIdentifier('1.3.6.1.5.5.7.3.1')).toString('hex')).toBe('2b06010505070301')
  })
})

describe('self-signed certificate', () => {
  it('parses, carries the requested names, and verifies against its own key', () => {
    const issued = generateSelfSignedCertificate({
      commonName: 'saturn-host',
      ipAddresses: ['127.0.0.1', '192.168.1.24'],
      dnsNames: ['localhost'],
      validityDays: 397,
      now: new Date('2026-09-15T10:00:00.000Z'),
    })
    const certificate = new X509Certificate(issued.certificatePem)
    expect(certificate.subject).toContain('saturn-host')
    expect(certificate.issuer).toBe(certificate.subject)
    expect(certificate.subjectAltName).toContain('DNS:localhost')
    expect(certificate.subjectAltName).toContain('IP Address:127.0.0.1')
    expect(certificate.subjectAltName).toContain('IP Address:192.168.1.24')
    expect(certificate.checkIP('192.168.1.24')).toBe('192.168.1.24')
    expect(certificate.checkHost('localhost')).toBe('localhost')
    expect(certificate.checkIP('10.0.0.1')).toBeUndefined()
    expect(certificate.verify(createPublicKey(issued.privateKeyPem))).toBe(true)
    expect(certificate.ca).toBe(false)
    expect(new Date(certificate.validFrom).getTime()).toBeLessThan(Date.parse('2026-09-15T10:00:00.000Z'))
    expect(new Date(certificate.validTo).getTime()).toBeGreaterThan(Date.parse('2027-09-15T10:00:00.000Z'))
    expect(certificate.fingerprint256.replaceAll(':', '').toLowerCase()).toBe(issued.fingerprintSha256)
    expect(issued.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('serves a real TLS handshake whose peer fingerprint is the published one', async () => {
    const issued = generateSelfSignedCertificate({
      commonName: 'saturn-host',
      ipAddresses: ['127.0.0.1'],
      dnsNames: ['localhost'],
      validityDays: 30,
      now: new Date(),
    })
    const server = createServer({ key: issued.privateKeyPem, cert: issued.certificatePem }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('remote')
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    closers.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
    const port = (server.address() as AddressInfo).port
    const peer = await new Promise<string>((resolve, reject) => {
      const socket = connect({ port, host: '127.0.0.1', rejectUnauthorized: false, servername: 'localhost' }, () => {
        const detail = socket.getPeerCertificate()
        socket.end()
        resolve(detail.fingerprint256)
      })
      socket.on('error', reject)
    })
    expect(peer.replaceAll(':', '').toLowerCase()).toBe(issued.fingerprintSha256)
  })

  it('issues a distinct serial and key per call', () => {
    const now = new Date()
    const first = generateSelfSignedCertificate({ commonName: 'a', ipAddresses: ['127.0.0.1'], dnsNames: [], validityDays: 30, now })
    const second = generateSelfSignedCertificate({ commonName: 'a', ipAddresses: ['127.0.0.1'], dnsNames: [], validityDays: 30, now })
    expect(new X509Certificate(first.certificatePem).serialNumber)
      .not.toBe(new X509Certificate(second.certificatePem).serialNumber)
    expect(first.fingerprintSha256).not.toBe(second.fingerprintSha256)
  })

  it('refuses an address list it cannot encode', () => {
    expect(() => generateSelfSignedCertificate({
      commonName: 'a',
      ipAddresses: ['not-an-address'],
      dnsNames: [],
      validityDays: 30,
      now: new Date(),
    })).toThrow(/IPv4/u)
  })
})
