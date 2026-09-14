/** Durable First Light setup state over a real mirror-derived scope and a fake wire. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { decodeFirstLightSection, FirstLightStore } from '../src/client/first-light-store.ts'
import {
  FIRST_LIGHT_COMPLETE_FIELD, FIRST_LIGHT_PROFILE_FIELD, FIRST_LIGHT_SETTINGS_NAMESPACE,
  FIRST_LIGHT_VERSION, FIRST_LIGHT_VOICE_FIELD,
} from '../src/onboarding-copy.ts'

const schemaService = new SettingsSchemaService(new Context())

/** The settings namespace answers over the Remote carrier, which has no envelope. */
function ok<T>(value: T) {
  return { ok: true as const, value }
}

function rejected(message: string) {
  return {
    ok: false as const,
    error: new RemoteError('settings/rejected', message, { ns: FIRST_LIGHT_SETTINGS_NAMESPACE }),
  }
}

function namespace(value: unknown = {}, revision = 0) {
  return {
    ns: FIRST_LIGHT_SETTINGS_NAMESPACE,
    schema: {},
    value,
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

/** The First Light store over a real mirror-derived scope and a fake wire. */
function buildFirstLight(
  api: { describe?: ReturnType<typeof vi.fn>; mutate?: ReturnType<typeof vi.fn> },
  persistence: 'host' | 'memory' = 'host',
) {
  const ctx = { remote: { settings: api } } as never
  const mirror = new SettingsDescribeMirror(ctx, persistence)
  const scope = new SettingsScopeController(
    ctx,
    { namespace: FIRST_LIGHT_SETTINGS_NAMESPACE, decode: decodeFirstLightSection },
    mirror,
    persistence,
    schemaService,
  )
  return { mirror, controller: new FirstLightStore(scope) }
}

describe('FirstLightStore', () => {
  it('keeps the whole sequence process-local while Host persistence is disabled', async () => {
    const describeCall = vi.fn()
    const mutate = vi.fn()
    const { controller } = buildFirstLight({ describe: describeCall, mutate }, 'memory')

    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', complete: false })
    await expect(controller.saveProfile({ name: 'Izzy', building: 'brands', language: 'en' }))
      .resolves.toBe(true)
    await expect(controller.saveVoice({ tone: 'direct' })).resolves.toBe(true)
    await expect(controller.seal()).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      complete: true,
      profile: { name: 'Izzy', building: 'brands', language: 'en' },
      voice: { tone: 'direct' },
    })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ complete: true })
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reads only the exact current sequence version as complete', async () => {
    for (const [version, complete] of [
      [undefined, false],
      ['older-copy', false],
      [FIRST_LIGHT_VERSION, true],
    ] as const) {
      const describeCall = vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [namespace(version === undefined ? {} : { [FIRST_LIGHT_COMPLETE_FIELD]: version })],
      })))
      const { mirror, controller } = buildFirstLight({ describe: describeCall })
      await mirror.load()
      await controller.load()
      expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', complete })
    }
  })

  it('seals the owner version through one revision-fenced mutation', async () => {
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [namespace({}, 3)],
    })))
    const mutate = vi.fn(() => Promise.resolve(ok(namespace({ [FIRST_LIGHT_COMPLETE_FIELD]: FIRST_LIGHT_VERSION }, 4))))
    const { mirror, controller } = buildFirstLight({ describe: describeCall, mutate })
    await mirror.load()
    await controller.load()
    await expect(controller.seal()).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith(
      FIRST_LIGHT_SETTINGS_NAMESPACE,
      [{ op: 'set', path: [FIRST_LIGHT_COMPLETE_FIELD], value: FIRST_LIGHT_VERSION }],
      3,
    )
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', complete: true })
    expect(describeCall).toHaveBeenCalledTimes(1)
  })

  it('writes the profile and the voice as their own durable fields', async () => {
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [namespace({}, 3)],
    })))
    const mutate = vi.fn(() => Promise.resolve(ok(namespace({}, 4))))
    const { mirror, controller } = buildFirstLight({ describe: describeCall, mutate })
    await mirror.load()
    await controller.load()
    await controller.saveProfile({ name: 'Izzy', building: 'brands', language: 'zh' })
    expect(mutate).toHaveBeenLastCalledWith(
      FIRST_LIGHT_SETTINGS_NAMESPACE,
      [{
        op: 'set',
        path: [FIRST_LIGHT_PROFILE_FIELD],
        value: { name: 'Izzy', building: 'brands', language: 'zh' },
      }],
      3,
    )
  })

  it('reports a refused seal as not complete after its recovery read', async () => {
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [namespace()],
    })))
    const mutate = vi.fn(() => Promise.resolve(rejected('the settings document is read-only')))
    const { mirror, controller } = buildFirstLight({ describe: describeCall, mutate })
    await mirror.load()
    await controller.load()
    await expect(controller.seal()).resolves.toBe(false)
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      complete: false,
      error: 'the entry did not persist',
    })
    expect(describeCall).toHaveBeenCalledTimes(2)
  })

  it('keeps the sequence pending while the settings read has not answered', async () => {
    const describeCall = vi.fn(() => Promise.reject(new Error('offline')))
    const { mirror, controller } = buildFirstLight({ describe: describeCall })
    await mirror.load()
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({
      status: 'loading',
      complete: false,
      profile: { name: '', building: '', language: '' },
      voice: { tone: '' },
      error: null,
    })
  })

  it('reports a missing namespace as an error instead of a silent skip', async () => {
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [],
    })))
    const { mirror, controller } = buildFirstLight({ describe: describeCall })
    await mirror.load()
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'first-light settings are unavailable',
    })
  })

  it('reads malformed durable values as unfilled instead of throwing', async () => {
    for (const value of [null, 42, { [FIRST_LIGHT_PROFILE_FIELD]: 42, [FIRST_LIGHT_VOICE_FIELD]: 'x' }]) {
      const describeCall = vi.fn(() => Promise.resolve(ok({
        writable: true, hasDocument: false, namespaces: [namespace(value)],
      })))
      const { mirror, controller } = buildFirstLight({ describe: describeCall })
      await mirror.load()
      await controller.load()
      expect(controller.store.getSnapshot()).toMatchObject({
        status: 'ready',
        profile: { name: '', building: '', language: '' },
        voice: { tone: '' },
      })
    }
  })
})
