// @vitest-environment jsdom
/**
 * The Remote settings card: it registers one localized Settings page, reads
 * the host once on mount, and never paints a pairing code the person did not
 * ask for. The device token is the one value that must never reach the DOM.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/registration.ts'
import { RemoteSection, type RemoteSectionInjected } from '../src/client/RemoteSection.tsx'
import { en } from '../src/client/locales.ts'
import type { RemotePairingPayload, RemoteStatusView } from '../src/client/contracts.ts'

usePinnedBrowserLanguages('en-US')
afterEach(cleanup)

const OFF: RemoteStatusView = {
  state: 'off',
  mode: 'lan',
  url: null,
  fingerprint: null,
  devices: [],
  tunnelAvailable: false,
  issue: 'none',
  journal: [],
}

const ON: RemoteStatusView = {
  ...OFF,
  state: 'on',
  url: 'https://192.168.1.24:8765',
  fingerprint: 'b'.repeat(64),
  devices: [{ id: 'dev-1', name: 'izzy iPhone', platform: 'ios', pairedAt: '2026-09-15T10:00:00.000Z', lastSeenAt: null }],
  journal: [{ at: '2026-09-15T10:00:00.000Z', action: 'enabled', detail: 'lan' }],
}

const CODE: RemotePairingPayload = {
  v: 1,
  name: 'izzy-workstation',
  url: 'https://192.168.1.24:8765',
  token: 'GmQ7x1sJ0kL9pR3tY6wZ2aB5cD8eF1gH4iJ7kM0nO3Q',
  fingerprint: 'b'.repeat(64),
  expires: '2099-01-01T00:00:00.000Z',
}

function face(overrides: Partial<RemoteSectionInjected> = {}): RemoteSectionInjected {
  return {
    status: vi.fn().mockResolvedValue(OFF),
    enable: vi.fn().mockResolvedValue(ON),
    disable: vi.fn().mockResolvedValue(OFF),
    pairingCode: vi.fn().mockResolvedValue(CODE),
    revoke: vi.fn().mockResolvedValue({ ...ON, devices: [] }),
    ...overrides,
  }
}

function t(key: keyof typeof en, values?: Record<string, string | number>): string {
  return Object.entries(values ?? {}).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )
}

describe('ui-remote-access plugin', () => {
  it('keeps the Host loader entry inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })

  it('registers one localized Remote settings page without calling the host eagerly', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const remoteAccess = face()
    ctx.provide('remoteAccess', remoteAccess)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)

    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.section')[0]
    expect(entry?.options).toMatchObject({ id: 'remote', order: 45 })
    expect(resolveSlotLabel(entry!.options.label)).toBe(en.nav)
    expect(remoteAccess.status).not.toHaveBeenCalled()
  })
})

describe('Remote settings section', () => {
  it('reads the host on mount and explains that remote access is off', async () => {
    const injected = face()
    render(<RemoteSection {...injected} t={t} close={() => {}} />)
    await waitFor(() => { expect(injected.status).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText(en.stateOff)).toBeTruthy()
    expect(screen.queryByTestId('remote-qr')).toBeNull()
  })

  it('turns LAN access on, shows the address and the certificate fingerprint, and lists paired devices', async () => {
    const injected = face()
    render(<RemoteSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.stateOff)
    fireEvent.click(screen.getByRole('button', { name: en.turnOn }))
    await waitFor(() => { expect(injected.enable).toHaveBeenCalledWith('lan') })
    expect(await screen.findByText('https://192.168.1.24:8765')).toBeTruthy()
    expect(screen.getByText(/bbbb/u)).toBeTruthy()
    expect(screen.getByText('izzy iPhone')).toBeTruthy()
  })

  it('draws the pairing QR only on request and never prints the token as text', async () => {
    const injected = face({ status: vi.fn().mockResolvedValue(ON) })
    const { container } = render(<RemoteSection {...injected} t={t} close={() => {}} />)
    await screen.findByText('https://192.168.1.24:8765')
    expect(screen.queryByTestId('remote-qr')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.showCode }))
    await waitFor(() => { expect(injected.pairingCode).toHaveBeenCalledTimes(1) })
    const qr = await screen.findByTestId('remote-qr')
    expect(qr.tagName.toLowerCase()).toBe('svg')
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M/u)
    expect(container.textContent).not.toContain(CODE.token)
  })

  it('revokes a paired device and drops it from the list', async () => {
    const injected = face({ status: vi.fn().mockResolvedValue(ON) })
    render(<RemoteSection {...injected} t={t} close={() => {}} />)
    await screen.findByText('izzy iPhone')
    fireEvent.click(screen.getByRole('button', { name: t('revokeDevice', { name: 'izzy iPhone' }) }))
    await waitFor(() => { expect(injected.revoke).toHaveBeenCalledWith('dev-1') })
    await waitFor(() => { expect(screen.queryByText('izzy iPhone')).toBeNull() })
  })

  it('names the missing binary instead of offering to fetch it', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue({ ...OFF, state: 'failed', mode: 'tunnel', issue: 'tunnel-missing' }),
    })
    render(<RemoteSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(en.tunnelMissing)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /download/iu })).toBeNull()
  })

  it('surfaces a host failure rather than pretending the card is off', async () => {
    const injected = face({ status: vi.fn().mockRejectedValue(new Error('host down')) })
    render(<RemoteSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(en.loadError)).toBeTruthy()
  })
})

describe('copy', () => {
  it('translates every key it ships', async () => {
    const { zh } = await import('../src/client/locales.ts')
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(zh)) expect(value, key).not.toBe('')
  })
})
