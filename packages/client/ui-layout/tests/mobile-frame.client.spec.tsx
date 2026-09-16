// @vitest-environment jsdom
/**
 * The shell at phone width (SPEC §8 M2): one column plus a title strip, the
 * sidebar carried as a modal drawer opened from that strip, closing on
 * Escape, on the backdrop, and on a route change. Same props form as
 * app-frame.client.spec.tsx — a real layout store instance, a recording
 * renderSlot stub, and a driven ResizeObserver, because jsdom has no layout
 * engine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const selectedSession = { current: 's-phone' as SessionId | undefined }
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AppFrameProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const SessionProviderStub: AppFrameProps['SessionProvider'] = ({ children, empty }) =>
  selectedSession.current === undefined ? <>{empty?.() ?? null}</> : <>{children}</>

let fireResize: (() => void) | null = null
class ResizeObserverStub {
  #cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.#cb = cb }
  observe(): void { fireResize = () => { this.#cb([], this) } }
  unobserve(): void {}
  disconnect(): void { fireResize = null }
}

/** Phone viewport of the acceptance scenario (iPhone 14 Pro logical width). */
const PHONE_WIDTH = 390
let frameWidth = PHONE_WIDTH

function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S { return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot)) }
}

function mountFrame() {
  window.innerWidth = frameWidth
  const instance = createLayoutStore().create()
  const renderSlot = ((key: string) => {
    if (key === 'sidebar') return <button type="button" data-testid="sidebar-button">sessions</button>
    if (key === 'conversation') return <div data-testid="center-content" />
    return null
  }) as AppFrameProps['renderSlot']
  const useSessions = ((sel: (s: SessionListState) => unknown) => {
    const current = selectedSession.current
    const sessionState = {
      ids: current === undefined ? [] : [current],
      byId: current === undefined
        ? {}
        : { [current]: { id: current, displayTitle: 'Test', running: false, blank: false, updatedAt: 1, title: 'Mobile session' } },
      current,
      phase: 'ready',
    } as SessionListState
    return sel(sessionState)
  }) as never
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }
  const element = () => (
    <AppFrame
      useStore={hookOf(instance)}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useWorkspaces={((sel: (s: WorkspaceSnapshot) => unknown) => sel(workspaceState)) as never}
      SessionProvider={SessionProviderStub}
      t={key => key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return { instance, frame, rerenderFrame: () => { utils.rerender(element()) }, ...utils }
}

/** The strip's menu control, the only drawer opener on a phone. */
function menuButton(frame: HTMLElement): HTMLButtonElement {
  const button = frame.querySelector<HTMLButtonElement>('[data-mobile-menu]')
  if (button === null) throw new Error('no mobile menu control in the title strip')
  return button
}

function drawer(frame: HTMLElement): HTMLElement {
  const panel = frame.querySelector<HTMLElement>('[data-mobile-drawer]')
  if (panel === null) throw new Error('no mobile drawer in the frame')
  return panel
}

beforeEach(() => {
  frameWidth = PHONE_WIDTH
  selectedSession.current = 's-phone' as SessionId
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }))
  window.innerWidth = frameWidth
  Element.prototype.getBoundingClientRect = function () {
    return { width: frameWidth, height: 844, top: 0, left: 0, right: frameWidth, bottom: 844, x: 0, y: 0, toJSON: () => ({}) }
  }
})

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllGlobals()
  fireResize = null
})

describe('AppFrame at phone width', () => {
  it('declares the mobile shape and drops the desktop column template', () => {
    const { frame } = mountFrame()
    expect(frame.dataset.mobile).toBe('true')
    // The desktop inline template would beat the mobile sheet; the frame must
    // leave the tracks to CSS instead.
    expect(frame.style.gridTemplateColumns).toBe('')
    expect(frame.querySelector('[data-mobile-strip]')).not.toBeNull()
    expect(frame.querySelector('[data-mobile-backdrop]')).not.toBeNull()
  })

  it('keeps the desktop shape above the breakpoint', () => {
    frameWidth = 1280
    const { frame } = mountFrame()
    expect(frame.dataset.mobile).toBeUndefined()
    expect(frame.style.gridTemplateColumns).not.toBe('')
    expect(frame.querySelector('[data-mobile-strip]')).toBeNull()
  })

  it('titles the strip with the current Session', () => {
    const { frame } = mountFrame()
    expect(frame.querySelector('[data-mobile-strip]')?.textContent).toContain('Mobile session')
  })

  it('carries the sidebar as a closed modal drawer until the strip opens it', () => {
    const { frame } = mountFrame()
    const panel = drawer(frame)
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(frame.dataset.drawerOpen).toBeUndefined()
    expect(menuButton(frame).getAttribute('aria-expanded')).toBe('false')
    // Never unmounted: the sidebar subtree survives every open/close.
    expect(panel.querySelector('[data-testid="sidebar-button"]')).not.toBeNull()

    act(() => { menuButton(frame).click() })
    expect(frame.dataset.drawerOpen).toBe('true')
    expect(menuButton(frame).getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelector('[data-testid="sidebar-button"]')).not.toBeNull()
  })

  it('renders the drawer sidebar wide, never as the desktop rail', () => {
    const calls: { collapsed: boolean; width: number }[] = []
    window.innerWidth = PHONE_WIDTH
    const instance = createLayoutStore().create()
    const renderSlot = ((key: string, owner: { collapsed: boolean; width: number }) => {
      if (key === 'sidebar') { calls.push(owner); return null }
      return null
    }) as AppFrameProps['renderSlot']
    const useSessions = ((sel: (s: SessionListState) => unknown) =>
      sel({ ids: [], byId: {}, current: undefined, phase: 'ready' } as unknown as SessionListState)) as never
    render(
      <AppFrame
        useStore={hookOf(instance)}
        actions={instance.actions}
        renderSlot={renderSlot}
        useSessions={useSessions}
        useSessionPendingInteraction={useSessionPendingInteraction}
        useWorkspaces={((sel: (s: WorkspaceSnapshot) => unknown) =>
          sel({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })) as never}
        SessionProvider={SessionProviderStub}
        t={key => key}
      />,
    )
    expect(calls.at(-1)).toEqual({ collapsed: false, width: 328 })
  })

  it('closes on the backdrop, on Escape, and on a route change', () => {
    const { frame, rerenderFrame } = mountFrame()
    const backdrop = frame.querySelector<HTMLElement>('[data-mobile-backdrop]')!

    act(() => { menuButton(frame).click() })
    act(() => { backdrop.click() })
    expect(frame.dataset.drawerOpen).toBeUndefined()

    act(() => { menuButton(frame).click() })
    act(() => {
      drawer(frame).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(frame.dataset.drawerOpen).toBeUndefined()

    act(() => { menuButton(frame).click() })
    expect(frame.dataset.drawerOpen).toBe('true')
    selectedSession.current = 's-other' as SessionId
    act(() => { rerenderFrame() })
    expect(frame.dataset.drawerOpen).toBeUndefined()
  })

  it('traps focus in the open drawer and hands it back to the strip on close', () => {
    const { frame } = mountFrame()
    const trigger = menuButton(frame)
    act(() => { trigger.click() })
    expect(document.activeElement).toBe(frame.querySelector('[data-testid="sidebar-button"]'))
    act(() => { trigger.click() })
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the drawer when the window widens past the breakpoint', () => {
    const { frame } = mountFrame()
    act(() => { menuButton(frame).click() })
    expect(frame.dataset.drawerOpen).toBe('true')
    frameWidth = 1280
    act(() => { fireResize?.() })
    expect(frame.dataset.mobile).toBeUndefined()
    expect(frame.querySelector('[data-mobile-drawer]')).toBeNull()
  })
})
