import { describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_SYNC_EVENT,
  BACKGROUND_SYNC_INTERVAL_MINUTES,
  BACKGROUND_SYNC_LABEL,
  BACKGROUND_SYNC_SRC,
  BACKGROUND_SYNC_STORE_EVENT,
  buildBackgroundRunnerConfig,
  buildStoreSessionArgs,
  syncBackgroundSession,
  type EventDispatcher,
} from '../src/lib/backgroundSync.ts'

// Mars r1 finding #2: "background poll of /saturn/remote/events -> local
// notifications" was undelivered — pollOnce() existed but nothing scheduled
// it. This module is the app-side half of the fix: it hands the paired
// session to @capacitor/background-runner's isolated JS engine (which polls
// on its own OS-scheduled tick, see apps/mobile/assets/background-runner.js)
// and is the single source of truth for the plugin config both
// capacitor.config.ts and the runner file must agree on.

describe('buildBackgroundRunnerConfig', () => {
  it('returns the exact plugins.BackgroundRunner block capacitor.config.ts installs', () => {
    expect(buildBackgroundRunnerConfig()).toEqual({
      label: BACKGROUND_SYNC_LABEL,
      src: BACKGROUND_SYNC_SRC,
      event: BACKGROUND_SYNC_EVENT,
      repeat: true,
      interval: BACKGROUND_SYNC_INTERVAL_MINUTES,
      autoStart: true,
    })
  })

  it('never sets an interval below Android Background Runner\'s 15-minute floor', () => {
    expect(buildBackgroundRunnerConfig().interval).toBeGreaterThanOrEqual(15)
  })
})

describe('buildStoreSessionArgs', () => {
  it('returns an empty object when there is no session, clearing the runner\'s KV store', () => {
    expect(buildStoreSessionArgs(undefined)).toEqual({})
  })

  it('extracts only hostUrl and deviceToken from a fuller session object', () => {
    const session = {
      hostUrl: 'https://192.168.1.9:8443',
      deviceToken: 'dev-abc',
      sessionCookieName: 'dsh_session',
      hostName: 'izzy-pc',
      pairedAt: new Date().toISOString(),
    }
    expect(buildStoreSessionArgs(session)).toEqual({
      hostUrl: 'https://192.168.1.9:8443',
      deviceToken: 'dev-abc',
    })
  })
})

describe('syncBackgroundSession', () => {
  it('dispatches storeSession with the session payload, addressed to this runner label', async () => {
    const dispatchEvent = vi.fn().mockResolvedValue(undefined)
    const dispatcher: EventDispatcher = { dispatchEvent }
    await syncBackgroundSession(dispatcher, { hostUrl: 'https://host', deviceToken: 'tok' })
    expect(dispatchEvent).toHaveBeenCalledWith({
      label: BACKGROUND_SYNC_LABEL,
      event: BACKGROUND_SYNC_STORE_EVENT,
      details: { hostUrl: 'https://host', deviceToken: 'tok' },
    })
  })

  it('dispatches empty details to clear the runner state when session is undefined (revoke/forget)', async () => {
    const dispatchEvent = vi.fn().mockResolvedValue(undefined)
    const dispatcher: EventDispatcher = { dispatchEvent }
    await syncBackgroundSession(dispatcher, undefined)
    expect(dispatchEvent).toHaveBeenCalledWith({
      label: BACKGROUND_SYNC_LABEL,
      event: BACKGROUND_SYNC_STORE_EVENT,
      details: {},
    })
  })

  it('propagates a dispatch failure rather than swallowing it', async () => {
    const dispatcher: EventDispatcher = { dispatchEvent: vi.fn().mockRejectedValue(new Error('runner unavailable')) }
    await expect(syncBackgroundSession(dispatcher, { hostUrl: 'h', deviceToken: 't' })).rejects.toThrow(
      'runner unavailable',
    )
  })
})
