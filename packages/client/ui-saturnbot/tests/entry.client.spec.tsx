// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SaturnBotEntry } from '../src/client/Entry.tsx'
import type { SaturnBotEntryProps, SaturnBotViewState } from '../src/client/contracts.ts'
import { en } from '../src/client/locales.ts'
import { actions, state } from './fixtures.client.ts'

function props(standalone: boolean, openWindow: () => Promise<boolean> = vi.fn(async () => true)): SaturnBotEntryProps {
  return {
    ...actions(), standalone, openWindow, t: makeTranslate(en),
    useBot: <T,>(select: (value: SaturnBotViewState) => T): T => select(state()),
    useWorkspaces: <T,>(select: (value: { items: [] }) => T): T => select({ items: [] }),
  } as unknown as SaturnBotEntryProps
}
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Give the launcher seat a real box in jsdom: the reserved inset is measured, not guessed. */
function stubLauncherWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const isSeat = this.hasAttribute('data-saturnbot-launcher')
    return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: isSeat ? width : 0, height: isSeat ? 32 : 0, toJSON: () => ({}) }
  })
}

it('reserves the main header space and invokes the separate-window launcher', async () => {
  const open = vi.fn(async () => false)
  stubLauncherWidth(120)
  const view = render(<div data-frame=""><div data-shell-overlay=""><SaturnBotEntry {...props(false, open)} /></div></div>)
  const frame = view.container.querySelector<HTMLElement>('[data-frame]')
  // The launcher publishes its measured footprint: 18px corner inset + its own
  // width + a 12px gap, so the header utilities and the pricing lamp stop
  // short of it whatever the label's locale or length.
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('150px')
  fireEvent.click(screen.getByRole('button', { name: en['launch.label'] }))
  expect(open).toHaveBeenCalledOnce()
  expect((await screen.findByRole('alert')).textContent).toBe(en['launch.blocked'])
  expect(view.container.querySelector('[data-saturnbot-dashboard]')).toBeNull()
  view.unmount()
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('')
})

it('follows its own box: re-measures on resize and releases the inset when the sheet hides it', () => {
  // jsdom has no ResizeObserver; capture the callback so the test can fire it.
  let observe: ResizeObserverCallback | undefined
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observe = callback }
    observe() {}
    disconnect() { observe = undefined }
  })
  stubLauncherWidth(120)
  const view = render(<div data-frame=""><div data-shell-overlay=""><SaturnBotEntry {...props(false)} /></div></div>)
  const frame = view.container.querySelector<HTMLElement>('[data-frame]')
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('150px')
  vi.restoreAllMocks()
  stubLauncherWidth(96)
  observe?.([], {} as ResizeObserver)
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('126px')
  vi.restoreAllMocks()
  stubLauncherWidth(0)
  observe?.([], {} as ResizeObserver)
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('')
  view.unmount()
  expect(observe).toBeUndefined()
  vi.unstubAllGlobals()
})

it('reserves nothing while the phone sheet hides the launcher', () => {
  stubLauncherWidth(0)
  const view = render(<div data-frame=""><div data-shell-overlay=""><SaturnBotEntry {...props(false)} /></div></div>)
  const frame = view.container.querySelector<HTMLElement>('[data-frame]')
  expect(frame?.style.getPropertyValue('--dsh-shell-trailing-inset')).toBe('')
  view.unmount()
})

it('reports a restore failure separately and permits another attempt', async () => {
  const open = vi.fn().mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce(false)
  render(<SaturnBotEntry {...props(false, open)} />)
  const launcher = screen.getByRole('button', { name: en['launch.label'] })
  fireEvent.click(launcher)
  expect((await screen.findByRole('alert')).textContent).toBe(en['launch.unavailable'])
  expect(launcher.hasAttribute('disabled')).toBe(false)
  fireEvent.click(launcher)
  expect((await screen.findByRole('alert')).textContent).toBe(en['launch.blocked'])
  expect(open).toHaveBeenCalledTimes(2)
})

it('titles the standalone window and makes the covered harness inert with cleanup', () => {
  document.title = 'Saturn AI'
  const view = render(<div><button>Harness composer</button><div data-shell-overlay=""><SaturnBotEntry {...props(true)} /></div></div>)
  const covered = screen.getByRole('button', { name: 'Harness composer' })
  expect(covered.inert).toBe(true)
  expect(document.title).toBe('SaturnBot')
  expect(view.container.querySelector('[data-saturnbot-dashboard]')).not.toBeNull()
  expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  view.unmount()
  expect(covered.inert).toBe(false)
  expect(document.title).toBe('Saturn AI')
})

it('marks the launcher seat with a durable anchor the phone sheet can stand down', () => {
  const view = render(<div data-shell-overlay=""><SaturnBotEntry {...props(false)} /></div>)
  const seat = view.container.querySelector('[data-saturnbot-launcher]')
  expect(seat).not.toBeNull()
  expect(seat?.querySelector('button')).not.toBeNull()
})
