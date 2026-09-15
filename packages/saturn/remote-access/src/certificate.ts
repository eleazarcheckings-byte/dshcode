/**
 * The LAN listener's identity. A phone that scans the pairing code pins the
 * SHA-256 of this certificate, so the harness mints its own rather than asking
 * anyone for one: an elliptic-curve key pair from node:crypto, a DER
 * TBSCertificate assembled here, and the signature Node produces over it.
 *
 * Node exposes signing and X.509 *parsing* but no certificate *writer*, so the
 * ASN.1 below is written by hand. Nothing about that is folklore: the suite
 * parses every issued certificate with node:crypto's own X509Certificate and
 * completes a real TLS handshake against it, which no malformed byte string
 * survives.
 */

import { createSign, createHash, generateKeyPairSync, randomBytes } from 'node:crypto'

/** One issued certificate and the key that answers for it. */
export interface IssuedCertificate {
  /** PKCS#8 private key, PEM encoded. */
  privateKeyPem: string
  /** The certificate, PEM encoded. */
  certificatePem: string
  /** Lowercase hex SHA-256 over the certificate DER — the value the phone pins. */
  fingerprintSha256: string
  /** The IPv4 literals this certificate answers for. */
  ipAddresses: readonly string[]
  /** The DNS names this certificate answers for. */
  dnsNames: readonly string[]
}

/** What the listener must be reachable as. */
export interface CertificateRequest {
  /** Subject and issuer common name (this host's display name). */
  commonName: string
  /** IPv4 literals placed in the subject alternative name. */
  ipAddresses: readonly string[]
  /** DNS names placed in the subject alternative name. */
  dnsNames: readonly string[]
  /** Lifetime in days from `now`. */
  validityDays: number
  /** Issue time; the certificate starts five minutes earlier for clock skew. */
  now: Date
}

const TAG_INTEGER = 0x02
const TAG_BIT_STRING = 0x03
const TAG_OCTET_STRING = 0x04
const TAG_OID = 0x06
const TAG_UTF8_STRING = 0x0c
const TAG_UTC_TIME = 0x17
const TAG_SEQUENCE = 0x30
const TAG_SET = 0x31

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2'
const OID_COMMON_NAME = '2.5.4.3'
const OID_BASIC_CONSTRAINTS = '2.5.29.19'
const OID_KEY_USAGE = '2.5.29.15'
const OID_EXT_KEY_USAGE = '2.5.29.37'
const OID_SUBJECT_ALT_NAME = '2.5.29.17'
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1'

const SKEW_MILLISECONDS = 5 * 60 * 1000
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SERIAL_BYTES = 16
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u

/** DER length prefix: short form below 128, long form above. */
function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size])
  const bytes: number[] = []
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** One DER tag-length-value triple. */
function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content)
  return Buffer.concat([Buffer.from([tag]), length(body.byteLength), body])
}

/**
 * Encode a dotted object identifier as DER content octets.
 * @param dotted - the arcs, for example `1.2.840.10045.4.3.2`.
 * @returns the content octets, without the tag or length.
 */
export function encodeObjectIdentifier(dotted: string): Uint8Array {
  const [first, second, ...rest] = dotted.split('.').map(Number)
  if (first === undefined || second === undefined
    || [first, second, ...rest].some(arc => !Number.isInteger(arc) || arc < 0)) {
    throw new Error(`remote-access: ${JSON.stringify(dotted)} is not an object identifier`)
  }
  const bytes: number[] = [first * 40 + second]
  for (const arc of rest) {
    const base128: number[] = [arc % 128]
    for (let carry = Math.floor(arc / 128); carry > 0; carry = Math.floor(carry / 128)) {
      base128.unshift(carry % 128 | 0x80)
    }
    bytes.push(...base128)
  }
  return Uint8Array.from(bytes)
}

function oid(dotted: string): Buffer {
  return tlv(TAG_OID, Buffer.from(encodeObjectIdentifier(dotted)))
}

/** A positive DER INTEGER from raw bytes (leading zero added when the top bit is set). */
function positiveInteger(raw: Buffer): Buffer {
  let at = 0
  while (at < raw.byteLength - 1 && raw[at] === 0) at += 1
  const trimmed = raw.subarray(at)
  const lead = trimmed[0] ?? 0
  const padded = (lead & 0x80) === 0 ? trimmed : Buffer.concat([Buffer.from([0]), trimmed])
  return tlv(TAG_INTEGER, padded)
}

/** UTCTime `YYMMDDhhmmssZ`, the encoding X.509 uses through 2049. */
function utcTime(at: Date): Buffer {
  const pair = (value: number): string => String(value).padStart(2, '0')
  const text = pair(at.getUTCFullYear() % 100) + pair(at.getUTCMonth() + 1) + pair(at.getUTCDate())
    + pair(at.getUTCHours()) + pair(at.getUTCMinutes()) + pair(at.getUTCSeconds()) + 'Z'
  return tlv(TAG_UTC_TIME, Buffer.from(text, 'ascii'))
}

/** RDNSequence carrying one common name. */
function distinguishedName(commonName: string): Buffer {
  return tlv(TAG_SEQUENCE, tlv(TAG_SET, tlv(TAG_SEQUENCE,
    oid(OID_COMMON_NAME),
    tlv(TAG_UTF8_STRING, Buffer.from(commonName, 'utf8')),
  )))
}

function ipv4Octets(literal: string): Buffer {
  const match = IPV4_PATTERN.exec(literal)
  const parts = match?.slice(1).map(Number)
  if (parts === undefined || parts.some(part => part > 255)) {
    throw new Error(`remote-access: ${JSON.stringify(literal)} is not an IPv4 literal`)
  }
  return Buffer.from(parts)
}

/** GeneralNames: dNSName is context tag 2, iPAddress is context tag 7. */
function subjectAltNames(dnsNames: readonly string[], ipAddresses: readonly string[]): Buffer {
  return tlv(TAG_SEQUENCE,
    ...dnsNames.map(name => tlv(0x82, Buffer.from(name, 'ascii'))),
    ...ipAddresses.map(literal => tlv(0x87, ipv4Octets(literal))),
  )
}

function extension(dotted: string, critical: boolean, value: Buffer): Buffer {
  return tlv(TAG_SEQUENCE,
    oid(dotted),
    ...critical ? [tlv(0x01, Buffer.from([0xff]))] : [],
    tlv(TAG_OCTET_STRING, value),
  )
}

/**
 * Mint a self-signed leaf certificate for the LAN listener.
 * @param request - the names to answer for and the lifetime to answer for them.
 * @returns the key, the certificate, and the SHA-256 the pairing payload publishes.
 */
export function generateSelfSignedCertificate(request: CertificateRequest): IssuedCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }))
  const algorithm = tlv(TAG_SEQUENCE, oid(OID_ECDSA_SHA256))
  const notBefore = new Date(request.now.getTime() - SKEW_MILLISECONDS)
  const notAfter = new Date(request.now.getTime() + request.validityDays * DAY_MILLISECONDS)
  const name = distinguishedName(request.commonName)

  const tbs = tlv(TAG_SEQUENCE,
    // [0] EXPLICIT version, v3.
    tlv(0xa0, tlv(TAG_INTEGER, Buffer.from([2]))),
    positiveInteger(randomBytes(SERIAL_BYTES)),
    algorithm,
    name,
    tlv(TAG_SEQUENCE, utcTime(notBefore), utcTime(notAfter)),
    name,
    spki,
    // [3] EXPLICIT extensions.
    tlv(0xa3, tlv(TAG_SEQUENCE,
      // A leaf, not an authority: the phone trusts the fingerprint, not a chain.
      extension(OID_BASIC_CONSTRAINTS, true, tlv(TAG_SEQUENCE)),
      // digitalSignature only; the ECDHE handshake needs nothing else.
      extension(OID_KEY_USAGE, true, tlv(TAG_BIT_STRING, Buffer.from([7, 0x80]))),
      extension(OID_EXT_KEY_USAGE, false, tlv(TAG_SEQUENCE, oid(OID_SERVER_AUTH))),
      extension(OID_SUBJECT_ALT_NAME, false, subjectAltNames(request.dnsNames, request.ipAddresses)),
    )),
  )

  const signature = createSign('sha256').update(tbs).sign(privateKey)
  const certificate = tlv(TAG_SEQUENCE,
    tbs,
    algorithm,
    tlv(TAG_BIT_STRING, Buffer.concat([Buffer.from([0]), signature])),
  )

  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    certificatePem: pem(certificate),
    fingerprintSha256: createHash('sha256').update(certificate).digest('hex'),
    ipAddresses: [...request.ipAddresses],
    dnsNames: [...request.dnsNames],
  }
}

/** Wrap DER as a PEM certificate block at the conventional 64-column width. */
function pem(der: Buffer): string {
  const body = der.toString('base64').replace(/.{1,64}/gu, line => `${line}\n`)
  return `-----BEGIN CERTIFICATE-----\n${body}-----END CERTIFICATE-----\n`
}
