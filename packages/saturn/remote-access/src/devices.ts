/**
 * The device ledger. Two secrets exist in this feature and neither is ever
 * written down: a pairing token lives in memory for ten minutes and is spent
 * once; a device token is handed to the phone and kept here only as a SHA-256
 * digest, so a reader of `devices.json` learns which phones are paired and
 * nothing that would let them act as one.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteDeviceRecord } from './types.ts'

const TOKEN_BYTES = 32
const LEDGER_FILE = 'devices.json'
const LEDGER_VERSION = 1

/** A pairing attempt the host refuses, with a reason safe to send over the wire. */
export class PairingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PairingError'
  }
}

interface StoredDevice extends RemoteDeviceRecord {
  /** SHA-256 of the device token, hex. The token itself is never stored. */
  digest: string
}

interface PendingPairing {
  digest: string
  expiresAt: number
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function digestOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Compare two hex digests without leaking the match position through timing. */
function digestMatches(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStored(raw: unknown): StoredDevice[] {
  if (!isRecord(raw) || raw.version !== LEDGER_VERSION || !Array.isArray(raw.devices)) return []
  return raw.devices.flatMap((entry): StoredDevice[] => {
    if (!isRecord(entry)) return []
    const { id, name, platform, pairedAt, lastSeenAt, digest } = entry
    if (typeof id !== 'string' || typeof name !== 'string' || typeof platform !== 'string'
      || typeof pairedAt !== 'string' || typeof digest !== 'string') return []
    return [{
      id,
      name,
      platform,
      pairedAt,
      lastSeenAt: typeof lastSeenAt === 'string' ? lastSeenAt : null,
      digest,
    }]
  })
}

/**
 * The paired-device ledger, durable under `<DSH_HOME>/remote/`.
 * Pairing tokens stay in memory: a token that does not survive a restart is a
 * token that cannot be found later on disk.
 */
export class DeviceLedger {
  private readonly pending = new Map<string, PendingPairing>()
  private devices: StoredDevice[] = []
  private tail: Promise<void> = Promise.resolve()

  private constructor(private readonly directory: string, devices: StoredDevice[]) {
    this.devices = devices
  }

  /**
   * Open (or create) the ledger under one directory.
   * @param directory - the remote-access state directory.
   * @returns the ledger, empty when nothing readable is stored.
   */
  static async open(directory: string): Promise<DeviceLedger> {
    await mkdir(directory, { recursive: true })
    let devices: StoredDevice[] = []
    try {
      devices = parseStored(JSON.parse(await readFile(join(directory, LEDGER_FILE), 'utf8')))
    } catch {
      // A missing or unreadable ledger is an empty ledger: remote access is an
      // opt-in convenience and must never be the reason the host fails to boot.
      devices = []
    }
    return new DeviceLedger(directory, devices)
  }

  /**
   * Mint a single-use pairing token for the QR payload.
   * @param now - current epoch milliseconds.
   * @param ttlMs - lifetime of the token.
   * @returns the token, base64url; only its digest is retained.
   */
  issuePairingToken(now: number, ttlMs: number): string {
    for (const [digest, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(digest)
    }
    const token = base64url(randomBytes(TOKEN_BYTES))
    const digest = digestOf(token)
    this.pending.set(digest, { digest, expiresAt: now + ttlMs })
    return token
  }

  /** Drop every outstanding pairing token (remote access going off, or a fresh code). */
  clearPairingTokens(): void {
    this.pending.clear()
  }

  /**
   * Spend a pairing token and enrol the device that presented it.
   * @param token - the token printed in the QR payload.
   * @param device - the phone's self-reported name and platform.
   * @param now - current epoch milliseconds.
   * @returns the long-lived device token and the ledger row it belongs to.
   * @throws {PairingError} when the token is unknown, spent, or expired.
   */
  async redeemPairingToken(
    token: string,
    device: { name: string; platform: string },
    now: number,
  ): Promise<{ deviceToken: string; record: RemoteDeviceRecord }> {
    const digest = digestOf(token)
    const entry = this.pending.get(digest)
    if (entry === undefined) throw new PairingError('this pairing code is not valid')
    this.pending.delete(digest)
    if (entry.expiresAt <= now) throw new PairingError('this pairing code has expired')
    const deviceToken = base64url(randomBytes(TOKEN_BYTES))
    const stored: StoredDevice = {
      id: base64url(randomBytes(9)),
      name: device.name.slice(0, 64),
      platform: device.platform.slice(0, 32),
      pairedAt: new Date(now).toISOString(),
      lastSeenAt: null,
      digest: digestOf(deviceToken),
    }
    this.devices = [...this.devices, stored]
    await this.flush()
    return { deviceToken, record: this.project(stored) }
  }

  /**
   * Resolve a bearer token to its device and stamp the sighting.
   * @param token - the device token presented by the request.
   * @param now - current epoch milliseconds.
   * @returns the device row, or undefined when nothing matches.
   */
  authenticate(token: string, now: number): RemoteDeviceRecord | undefined {
    if (token === '') return undefined
    const digest = digestOf(token)
    const found = this.devices.find(device => digestMatches(device.digest, digest))
    if (found === undefined) return undefined
    // Sightings are a convenience, not an audit record: they are written back
    // lazily so a busy stream never turns into a disk write per frame.
    found.lastSeenAt = new Date(now).toISOString()
    return this.project(found)
  }

  /** Every paired device, without the digests. */
  list(): RemoteDeviceRecord[] {
    return this.devices.map(device => this.project(device))
  }

  /**
   * Remove one device; its token stops working immediately and after a restart.
   * @param id - the ledger row id.
   * @returns whether a row was removed.
   */
  async revoke(id: string): Promise<boolean> {
    const next = this.devices.filter(device => device.id !== id)
    if (next.length === this.devices.length) return false
    this.devices = next
    await this.flush()
    return true
  }

  /** Persist sightings collected since the last write. */
  async checkpoint(): Promise<void> {
    await this.flush()
  }

  private project(device: StoredDevice): RemoteDeviceRecord {
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
    }
  }

  /** Serialize writes and replace the file atomically so a crash cannot truncate it. */
  private async flush(): Promise<void> {
    const snapshot = this.devices.map(device => ({ ...device }))
    const pending = this.tail.then(async () => {
      const target = join(this.directory, LEDGER_FILE)
      const temporary = `${target}.${base64url(randomBytes(6))}.tmp`
      await writeFile(temporary, `${JSON.stringify({ version: LEDGER_VERSION, devices: snapshot }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, target)
    })
    this.tail = pending.then(() => {}, () => {})
    await pending
  }
}
