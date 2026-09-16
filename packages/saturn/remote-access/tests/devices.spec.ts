/**
 * The device ledger: pairing tokens are single-use and expire, device tokens
 * are only ever stored as digests, and a revoked device stops authenticating
 * immediately and across a reopen.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceLedger, PairingError } from '../src/devices.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function ledger(): Promise<{ store: DeviceLedger; directory: string; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'saturn-remote-devices-'))
  directories.push(directory)
  return { store: await DeviceLedger.open(directory), directory, file: join(directory, 'devices.json') }
}

const DEVICE = { name: 'izzy iPhone', platform: 'ios' } as const

describe('device ledger', () => {
  it('pairs once, authenticates the returned token, and never writes it down', async () => {
    const l = await ledger()
    const now = Date.parse('2026-09-15T10:00:00.000Z')
    const pairing = l.store.issuePairingToken(now, 600_000)
    expect(pairing).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    const paired = await l.store.redeemPairingToken(pairing, DEVICE, now + 1000)
    expect(paired.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(paired.record).toMatchObject({ name: 'izzy iPhone', platform: 'ios' })
    expect(l.store.authenticate(paired.deviceToken, now + 2000)?.id).toBe(paired.record.id)
    expect(l.store.list()).toHaveLength(1)

    const written = await readFile(l.file, 'utf8')
    expect(written).not.toContain(paired.deviceToken)
    expect(written).not.toContain(pairing)
    expect(written).toContain('izzy iPhone')
  })

  it('refuses a replayed, expired, or unknown pairing token', async () => {
    const l = await ledger()
    const now = Date.parse('2026-09-15T10:00:00.000Z')
    const pairing = l.store.issuePairingToken(now, 600_000)
    await l.store.redeemPairingToken(pairing, DEVICE, now + 1000)
    await expect(l.store.redeemPairingToken(pairing, DEVICE, now + 2000)).rejects.toBeInstanceOf(PairingError)

    const stale = l.store.issuePairingToken(now, 600_000)
    await expect(l.store.redeemPairingToken(stale, DEVICE, now + 600_001)).rejects.toThrow(/expired/u)
    await expect(l.store.redeemPairingToken('x'.repeat(43), DEVICE, now)).rejects.toThrow(/pairing/u)
  })

  it('rejects an unknown device token and every near miss of a real one', async () => {
    const l = await ledger()
    const now = Date.now()
    const paired = await l.store.redeemPairingToken(l.store.issuePairingToken(now, 600_000), DEVICE, now)
    // A 32-byte token is 43 base64url characters: 256 bits = 42 × 6 + 4, so the
    // last character carries four significant bits and is one of sixteen values
    // (A E I M Q U Y c g k o s w 0 4 8). Hard-coding 'A' as the replacement
    // therefore reproduced the real token about one run in sixteen; pick a
    // character the token does not already end in.
    const nearMiss = `${paired.deviceToken.slice(0, -1)}${paired.deviceToken.endsWith('A') ? 'Q' : 'A'}`
    expect(nearMiss).not.toBe(paired.deviceToken)
    expect(l.store.authenticate(nearMiss, now)).toBeUndefined()
    expect(l.store.authenticate('', now)).toBeUndefined()
    expect(l.store.authenticate(paired.deviceToken.slice(0, 10), now)).toBeUndefined()
  })

  it('survives a reopen and forgets a revoked device for good', async () => {
    const l = await ledger()
    const now = Date.now()
    const paired = await l.store.redeemPairingToken(l.store.issuePairingToken(now, 600_000), DEVICE, now)

    const reopened = await DeviceLedger.open(l.directory)
    expect(reopened.authenticate(paired.deviceToken, now)?.name).toBe('izzy iPhone')
    expect(await reopened.revoke(paired.record.id)).toBe(true)
    expect(reopened.authenticate(paired.deviceToken, now)).toBeUndefined()
    expect(await reopened.revoke(paired.record.id)).toBe(false)

    const third = await DeviceLedger.open(l.directory)
    expect(third.list()).toEqual([])
    expect(third.authenticate(paired.deviceToken, now)).toBeUndefined()
  })

  it('records the last time a device was seen without touching disk on every request', async () => {
    const l = await ledger()
    const now = Date.parse('2026-09-15T10:00:00.000Z')
    const paired = await l.store.redeemPairingToken(l.store.issuePairingToken(now, 600_000), DEVICE, now)
    expect(paired.record.lastSeenAt).toBe(null)
    l.store.authenticate(paired.deviceToken, now + 60_000)
    expect(l.store.list()[0]?.lastSeenAt).toBe(new Date(now + 60_000).toISOString())
  })

  it('opens an empty ledger when the stored file is unreadable rather than failing the host', async () => {
    const l = await ledger()
    const now = Date.now()
    await l.store.redeemPairingToken(l.store.issuePairingToken(now, 600_000), DEVICE, now)
    await rm(l.file)
    expect((await DeviceLedger.open(l.directory)).list()).toEqual([])
  })
})
