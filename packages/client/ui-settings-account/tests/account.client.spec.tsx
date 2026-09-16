// @vitest-environment jsdom
/**
 * Settings → Account: empty not-connected, no fake user, user-initiated
 * update check that stays honest when the GitHub feed is unpublished.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { AccountSection, type AccountSectionInjected } from '../src/client/AccountSection.tsx'
import { en } from '../src/client/locales.ts'
import type { AccountStatus, UpdateCheck } from '../src/client/contracts.ts'

usePinnedBrowserLanguages('en-US')
afterEach(() => {
  cleanup()
  delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
})

const DISCONNECTED: AccountStatus = { version: 1, connected: false, reason: 'not-connected' }
const UNAVAILABLE: AccountStatus = { version: 1, connected: false, reason: 'oauth-unavailable' }
const INCOMPLETE: AccountStatus = { version: 1, connected: false, reason: 'oauth-incomplete' }
const CONNECTED: AccountStatus = {
  version: 1,
  connected: true,
  sub: 'user_1',
  connectedAt: '2026-09-15T00:00:00.000Z',
  email: 'izzy@izzy.la',
  name: 'izzy',
}

function face(overrides: Partial<AccountSectionInjected> = {}): AccountSectionInjected {
  return {
    status: vi.fn().mockResolvedValue(UNAVAILABLE),
    signIn: vi.fn().mockResolvedValue(UNAVAILABLE),
    signOut: vi.fn().mockResolvedValue(DISCONNECTED),
    checkUpdates: vi.fn().mockResolvedValue({ status: 'empty', current: '1.2.3' } satisfies UpdateCheck),
    openRelease: vi.fn(),
    ...overrides,
  }
}

function injectedFace(slots: SlotRegistry): AccountSectionInjected {
  const injectFn = slots.entries('settings.section')[0]?.inject
  if (injectFn === undefined) throw new Error('account section inject missing')
  return (injectFn as unknown as () => AccountSectionInjected)()
}

function t(key: keyof typeof en, values?: Record<string, string | number>): string {
  return Object.entries(values ?? {}).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )
}

describe('ui-settings-account plugin', () => {
  it('keeps the Host loader entry inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })

  it('registers one localized Account settings page without calling the host eagerly', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)

    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.section')[0]
    expect(entry?.options).toMatchObject({ id: 'account', order: 8 })
    expect(resolveSlotLabel(entry!.options.label)).toBe(en.nav)
  })

  it('injects a disconnected face when the desktop bridge is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const host = injectedFace(slots)
    await expect(host.status()).resolves.toEqual({ version: 1, connected: false, reason: 'oauth-unavailable' })
    await expect(host.signIn()).resolves.toMatchObject({ connected: false })
    await expect(host.signOut()).resolves.toMatchObject({ connected: false })
    await expect(host.checkUpdates()).resolves.toEqual({ status: 'empty', current: '' })
    host.openRelease('https://example.com')
  })

  it('forwards through the desktop bridge when present', async () => {
    const accountStatus = vi.fn().mockResolvedValue(CONNECTED)
    const accountSignIn = vi.fn().mockResolvedValue(UNAVAILABLE)
    const accountSignOut = vi.fn().mockResolvedValue(DISCONNECTED)
    const checkForUpdates = vi.fn().mockResolvedValue({ status: 'empty', current: '1.2.3' })
    const openRelease = vi.fn()
    ;(window as unknown as { dshDesktop: unknown }).dshDesktop = {
      accountStatus, accountSignIn, accountSignOut, checkForUpdates, openRelease,
    }
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const host = injectedFace(slots)
    await expect(host.status()).resolves.toEqual(CONNECTED)
    await host.signIn()
    await host.signOut()
    await host.checkUpdates()
    host.openRelease('https://github.com/eleazarcheckings-byte/dshcode/releases/latest')
    expect(accountSignIn).toHaveBeenCalledOnce()
    expect(accountSignOut).toHaveBeenCalledOnce()
    expect(openRelease).toHaveBeenCalledOnce()
  })

  it('falls back to disconnected when the desktop bridge omits account methods', async () => {
    ;(window as unknown as { dshDesktop: object }).dshDesktop = {}
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const host = injectedFace(slots)
    await expect(host.status()).resolves.toEqual({ version: 1, connected: false, reason: 'oauth-unavailable' })
    await expect(host.signIn()).resolves.toMatchObject({ connected: false })
    await expect(host.signOut()).resolves.toMatchObject({ connected: false })
    await expect(host.checkUpdates()).resolves.toEqual({ status: 'empty', current: '' })
    host.openRelease('https://example.com')
  })
})

describe('Account settings section', () => {
  it('reads the host on mount and shows the empty not-connected state', async () => {
    const injected = face()
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(en.disconnected)).toBeTruthy()
    expect(screen.getByText(en.oauthUnavailable)).toBeTruthy()
    expect(screen.queryByText(/izzy@izzy.la/u)).toBeNull()
    expect(screen.getByRole('button', { name: en.signIn })).toBeTruthy()
  })

  it('keeps the empty state after Sign in when OAuth cannot complete', async () => {
    const injected = face({ signIn: vi.fn().mockResolvedValue(INCOMPLETE) })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    await waitFor(() => { expect(injected.signIn).toHaveBeenCalledOnce() })
    expect(await screen.findByText(en.oauthIncomplete)).toBeTruthy()
    expect(screen.queryByText(t('connectedAs', { name: 'izzy' }))).toBeNull()
  })

  it('renders a real connected session and signs out to disconnected', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue(CONNECTED),
      signOut: vi.fn().mockResolvedValue(DISCONNECTED),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(t('connectedAs', { name: 'izzy' }))).toBeTruthy()
    expect(screen.getByText(t('connectedEmail', { email: 'izzy@izzy.la' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    await waitFor(() => { expect(injected.signOut).toHaveBeenCalledOnce() })
    expect((await screen.findByRole('status')).textContent).toBe(en.disconnected)
    expect(screen.queryByText(t('connectedAs', { name: 'izzy' }))).toBeNull()
  })

  it('names a subject when the session has no display name', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue({
        version: 1, connected: true, sub: 'user_only', connectedAt: '2026-09-15T00:00:00.000Z',
      }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(t('connectedAs', { name: 'user_only' }))).toBeTruthy()
    expect(screen.getByText(t('connectedSub', { sub: 'user_only' }))).toBeTruthy()
  })

  it('explains a malformed stored session instead of inventing a user', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue({ version: 1, connected: false, reason: 'malformed' }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(en.malformed)).toBeTruthy()
    expect(screen.getByText(en.disconnected)).toBeTruthy()
  })

  it('reports an empty update feed honestly', async () => {
    const injected = face()
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.emptyFeed)).toBeTruthy()
    expect(screen.getByText(t('installVersion', { version: '1.2.3' }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.openRelease })).toBeNull()
  })

  it('offers the GitHub release when a newer installer exists without a feed', async () => {
    const url = 'https://github.com/eleazarcheckings-byte/dshcode/releases/tag/v1.2.4'
    const injected = face({
      checkUpdates: vi.fn().mockResolvedValue({
        status: 'available-no-feed', current: '1.2.3', latest: 'v1.2.4', releaseUrl: url,
      }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(t('availableNoFeed', { version: 'v1.2.4' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.openRelease }))
    expect(injected.openRelease).toHaveBeenCalledWith(url)
  })

  it('names a feed version when latest.yml exists', async () => {
    const injected = face({
      checkUpdates: vi.fn().mockResolvedValue({
        status: 'available',
        current: '1.2.3',
        latest: '1.3.0',
        releaseUrl: 'https://github.com/eleazarcheckings-byte/dshcode/releases/latest',
      }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(t('available', { version: '1.3.0' }))).toBeTruthy()
  })

  it('says this install is current, with or without a feed', async () => {
    const injected = face({
      checkUpdates: vi.fn()
        .mockResolvedValueOnce({ status: 'current', current: '1.2.3', feed: true })
        .mockResolvedValueOnce({ status: 'current', current: '1.2.3', feed: false }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(t('upToDate', { version: '1.2.3' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.upToDateNoFeed)).toBeTruthy()
  })

  it('surfaces a failed check rather than claiming the install is current', async () => {
    const injected = face({
      checkUpdates: vi.fn().mockResolvedValue({ status: 'error', current: '1.2.3', message: 'offline' }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.updateError)).toBeTruthy()
  })

  it('surfaces a host failure rather than pretending a user is signed in', async () => {
    const injected = face({ status: vi.fn().mockRejectedValue(new Error('host down')) })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(en.loadError)).toBeTruthy()
    expect(screen.queryByText(/izzy/u)).toBeNull()
  })

  it('surfaces sign-in failure without inventing a session', async () => {
    const injected = face({ signIn: vi.fn().mockRejectedValue(new Error('no')) })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(await screen.findByText(en.loadError)).toBeTruthy()
  })

  it('renders not-connected copy when the reason is a bare empty session', async () => {
    const injected = face({ status: vi.fn().mockResolvedValue(DISCONNECTED) })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect((await screen.findByRole('status')).textContent).toBe(en.disconnected)
    expect(screen.queryByText(en.oauthUnavailable)).toBeNull()
  })

  it('surfaces sign-out failure without keeping a fake user', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue(CONNECTED),
      signOut: vi.fn().mockRejectedValue(new Error('no')),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(t('connectedAs', { name: 'izzy' }))
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(await screen.findByText(en.loadError)).toBeTruthy()
  })

  it('names the email when the session has no display name', async () => {
    const injected = face({
      status: vi.fn().mockResolvedValue({
        version: 1, connected: true, sub: 'user_mail', connectedAt: '2026-09-15T00:00:00.000Z',
        email: 'only@izzy.la',
      }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    expect(await screen.findByText(t('connectedAs', { name: 'only@izzy.la' }))).toBeTruthy()
    expect(screen.getByText(t('connectedEmail', { email: 'only@izzy.la' }))).toBeTruthy()
  })

  it('omits the install version line when the desktop bridge has no version', async () => {
    const injected = face({
      checkUpdates: vi.fn().mockResolvedValue({ status: 'empty', current: '' }),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.emptyFeed)).toBeTruthy()
    expect(screen.queryByText(/Version /u)).toBeNull()
  })

  it('surfaces a thrown update check rather than claiming the install is current', async () => {
    const injected = face({
      checkUpdates: vi.fn().mockRejectedValue(new Error('offline')),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.loadError)).toBeTruthy()
  })

  it('shows Checking while the feed request is in flight', async () => {
    let resolveCheck: (value: UpdateCheck) => void = () => {}
    const injected = face({
      checkUpdates: vi.fn(() => new Promise<UpdateCheck>((resolve) => { resolveCheck = resolve })),
    })
    render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByRole('button', { name: en.checking })).toBeTruthy()
    resolveCheck({ status: 'empty', current: '1.2.3' })
    expect(await screen.findByText(en.emptyFeed)).toBeTruthy()
  })

  it('does not paint a session that arrives after unmount', async () => {
    let resolveStatus: (value: AccountStatus) => void = () => {}
    const injected = face({
      status: vi.fn(() => new Promise<AccountStatus>((resolve) => { resolveStatus = resolve })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    unmount()
    resolveStatus(CONNECTED)
    await Promise.resolve()
    expect(screen.queryByText(t('connectedAs', { name: 'izzy' }))).toBeNull()
  })

  it('does not paint sign-in that settles after unmount', async () => {
    let resolveSignIn: (value: AccountStatus) => void = () => {}
    const injected = face({
      signIn: vi.fn(() => new Promise<AccountStatus>((resolve) => { resolveSignIn = resolve })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    unmount()
    resolveSignIn(CONNECTED)
    await Promise.resolve()
    expect(screen.queryByText(t('connectedAs', { name: 'izzy' }))).toBeNull()
  })

  it('does not paint an update result that arrives after unmount', async () => {
    let resolveCheck: (value: UpdateCheck) => void = () => {}
    const injected = face({
      checkUpdates: vi.fn(() => new Promise<UpdateCheck>((resolve) => { resolveCheck = resolve })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    unmount()
    resolveCheck({ status: 'empty', current: '1.2.3' })
    await Promise.resolve()
    expect(screen.queryByText(en.emptyFeed)).toBeNull()
  })

  it('does not paint a sign-in failure after unmount', async () => {
    let rejectSignIn: (error: Error) => void = () => {}
    const injected = face({
      signIn: vi.fn(() => new Promise<AccountStatus>((_resolve, reject) => { rejectSignIn = reject })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    unmount()
    rejectSignIn(new Error('gone'))
    await Promise.resolve()
    expect(screen.queryByText(en.loadError)).toBeNull()
  })

  it('does not paint an update failure after unmount', async () => {
    let rejectCheck: (error: Error) => void = () => {}
    const injected = face({
      checkUpdates: vi.fn(() => new Promise<UpdateCheck>((_resolve, reject) => { rejectCheck = reject })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    unmount()
    rejectCheck(new Error('gone'))
    await Promise.resolve()
    expect(screen.queryByText(en.loadError)).toBeNull()
  })

  it('does not paint a host failure that arrives after unmount', async () => {
    let rejectStatus: (error: Error) => void = () => {}
    const injected = face({
      status: vi.fn(() => new Promise<AccountStatus>((_resolve, reject) => { rejectStatus = reject })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    unmount()
    rejectStatus(new Error('gone'))
    await Promise.resolve()
    expect(screen.queryByText(en.loadError)).toBeNull()
  })

  it('does not paint a sign-out failure after unmount', async () => {
    let rejectSignOut: (error: Error) => void = () => {}
    const injected = face({
      status: vi.fn().mockResolvedValue(CONNECTED),
      signOut: vi.fn(() => new Promise<AccountStatus>((_resolve, reject) => { rejectSignOut = reject })),
    })
    const { unmount } = render(<AccountSection {...injected} t={t} close={() => {}} />)
    await screen.findByText(t('connectedAs', { name: 'izzy' }))
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    unmount()
    rejectSignOut(new Error('gone'))
    await Promise.resolve()
    expect(screen.queryByText(en.loadError)).toBeNull()
  })
})
