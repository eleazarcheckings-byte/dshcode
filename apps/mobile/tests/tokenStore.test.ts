import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage, TokenStore, type DeviceSession } from '../src/lib/tokenStore.ts'

describe('TokenStore', () => {
  let store: TokenStore

  beforeEach(() => {
    store = new TokenStore(new MemoryStorage())
  })

  it('returns null when nothing has been paired yet', async () => {
    expect(await store.load()).toBeNull()
  })

  it('round-trips a saved device session', async () => {
    const session: DeviceSession = {
      deviceToken: 'device-token-xyz',
      sessionCookieName: 'dsh_session',
      hostUrl: 'https://192.168.1.42:8443',
      hostName: 'izzy-pc',
      fingerprint: 'a'.repeat(64),
      pairedAt: new Date().toISOString(),
    }
    await store.save(session)
    expect(await store.load()).toEqual(session)
  })

  it('clears a saved session', async () => {
    await store.save({
      deviceToken: 't',
      sessionCookieName: 'c',
      hostUrl: 'https://host',
      hostName: 'n',
      pairedAt: new Date().toISOString(),
    })
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('treats corrupt stored JSON as no session', async () => {
    const storage = new MemoryStorage()
    await storage.set('saturn.remote.session', '{not json')
    const corrupt = new TokenStore(storage)
    expect(await corrupt.load()).toBeNull()
  })

  it('treats a session missing required fields as no session', async () => {
    const storage = new MemoryStorage()
    await storage.set('saturn.remote.session', JSON.stringify({ deviceToken: '' }))
    const invalid = new TokenStore(storage)
    expect(await invalid.load()).toBeNull()
  })
})
