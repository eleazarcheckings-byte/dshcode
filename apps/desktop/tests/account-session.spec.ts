import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  accountSessionPath,
  parseAccountSession,
  readAccountSession,
  writeAccountSession,
} from '../src/account-session.ts'

describe('parseAccountSession', () => {
  it('collapses a connected record without sub into disconnected', () => {
    expect(parseAccountSession({ version: 1, connected: true, name: 'izzy' })).toEqual({
      version: 1,
      connected: false,
      reason: 'malformed',
    })
  })

  it('never invents a user from empty or foreign JSON', () => {
    expect(parseAccountSession(null)).toEqual({ version: 1, connected: false, reason: 'malformed' })
    expect(parseAccountSession({ version: 1, connected: false })).toEqual({
      version: 1,
      connected: false,
      reason: 'not-connected',
    })
    expect(parseAccountSession({
      version: 1,
      connected: true,
      sub: 'user_1',
      connectedAt: '2026-09-15T00:00:00.000Z',
      email: 'izzy@izzy.la',
      name: 'izzy',
    })).toEqual({
      version: 1,
      connected: true,
      sub: 'user_1',
      connectedAt: '2026-09-15T00:00:00.000Z',
      email: 'izzy@izzy.la',
      name: 'izzy',
    })
    expect(parseAccountSession({ version: 1, connected: false, reason: 'oauth-incomplete' })).toEqual({
      version: 1,
      connected: false,
      reason: 'oauth-incomplete',
    })
    expect(parseAccountSession({ version: 1, connected: true, sub: 'user_1' })).toEqual({
      version: 1,
      connected: false,
      reason: 'malformed',
    })
  })
})

describe('account session file', () => {
  it('treats a missing file as not-connected and persists a real session under a temp home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'saturn-account-'))
    await expect(readAccountSession(home)).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'not-connected',
    })
    await writeAccountSession(home, {
      version: 1,
      connected: true,
      sub: 'user_1',
      connectedAt: '2026-09-15T00:00:00.000Z',
      email: 'izzy@izzy.la',
    })
    const stored = JSON.parse(await readFile(accountSessionPath(home), 'utf8')) as unknown
    expect(stored).toMatchObject({ connected: true, sub: 'user_1' })
    expect(stored).not.toMatchObject({ connected: true, sub: undefined })
    await expect(readAccountSession(home)).resolves.toMatchObject({ connected: true, sub: 'user_1' })
    await writeAccountSession(home, { version: 1, connected: false, reason: 'not-connected' })
    await expect(readAccountSession(home)).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'not-connected',
    })
  })

  it('treats unreadable JSON as malformed rather than connected', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const home = await mkdtemp(join(tmpdir(), 'saturn-account-bad-'))
    await mkdir(join(home, 'account'), { recursive: true })
    await writeFile(accountSessionPath(home), '{not json', 'utf8')
    await expect(readAccountSession(home)).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'malformed',
    })
  })
})
