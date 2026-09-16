// @vitest-environment jsdom
/**
 * Mobile drawer accessibility primitive (SPEC §8 M2): Escape closes, Tab is
 * trapped inside the open panel, and the trigger regains focus on dismissal.
 * Written against the DOM directly — the trap is a plain installer, not a
 * hook, so it is provable without a renderer (packages/client/AGENTS.md:
 * business components carry no subscription machinery).
 *
 * The reduced-motion contract lives in JS as well as CSS: with motion reduced
 * the panel has no slide to start, so focus moves in the same task; otherwise
 * it moves on the next frame, after the slide is under way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusableWithin, installDrawerTrap } from '@deepseek-ai/dsh-client-ui-layout/src/client/drawer.ts'

/** Build an open-drawer DOM: an outside trigger plus a panel with three focusables. */
function mountDrawer(): { panel: HTMLElement; trigger: HTMLButtonElement; inside: HTMLButtonElement[] } {
  document.body.innerHTML = ''
  const trigger = document.createElement('button')
  trigger.textContent = 'menu'
  document.body.append(trigger)
  const panel = document.createElement('div')
  const inside = ['one', 'two', 'three'].map((label) => {
    const button = document.createElement('button')
    button.textContent = label
    panel.append(button)
    return button
  })
  // A disabled control and a hidden one are never tab stops.
  const disabled = document.createElement('button')
  disabled.disabled = true
  panel.append(disabled)
  document.body.append(panel)
  trigger.focus()
  return { panel, trigger, inside }
}

/** Dispatch a keydown the trap can see (it listens on the panel, bubbling). */
function press(target: HTMLElement, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('focusableWithin', () => {
  it('lists the enabled, rendered focusables in document order', () => {
    const { panel, inside } = mountDrawer()
    expect(focusableWithin(panel)).toEqual(inside)
  })

  it('skips a subtree the drawer has hidden', () => {
    const { panel, inside } = mountDrawer()
    inside[1]!.hidden = true
    expect(focusableWithin(panel)).toEqual([inside[0], inside[2]])
  })
})

describe('installDrawerTrap', () => {
  it('moves focus into the panel immediately when motion is reduced', () => {
    const { panel, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    expect(document.activeElement).toBe(inside[0])
    dispose()
  })

  it('defers the focus move to the next frame while the panel slides in', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { panel, trigger, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: false })
    expect(document.activeElement).toBe(trigger)
    frames.forEach((frame) => { frame(0) })
    expect(document.activeElement).toBe(inside[0])
    dispose()
  })

  it('falls back to the panel itself when it holds no focusable control', () => {
    document.body.innerHTML = ''
    const panel = document.createElement('div')
    document.body.append(panel)
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    expect(document.activeElement).toBe(panel)
    expect(panel.getAttribute('tabindex')).toBe('-1')
    dispose()
  })

  it('closes on Escape and consumes the key', () => {
    const { panel } = mountDrawer()
    const onClose = vi.fn()
    const dispose = installDrawerTrap(panel, { onClose, reducedMotion: true })
    const event = press(panel, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('wraps Tab from the last control back to the first', () => {
    const { panel, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    inside[2]!.focus()
    const event = press(panel, 'Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(inside[0])
    dispose()
  })

  it('wraps Shift+Tab from the first control back to the last', () => {
    const { panel, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    const event = press(panel, 'Tab', true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(inside[2])
    dispose()
  })

  it('leaves an interior Tab to the browser', () => {
    const { panel, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    inside[0]!.focus()
    const event = press(panel, 'Tab')
    expect(event.defaultPrevented).toBe(false)
    dispose()
  })

  it('ignores keys it does not own, and Tab in an empty panel', () => {
    document.body.innerHTML = ''
    const panel = document.createElement('div')
    document.body.append(panel)
    const onClose = vi.fn()
    const dispose = installDrawerTrap(panel, { onClose, reducedMotion: true })
    expect(press(panel, 'a').defaultPrevented).toBe(false)
    expect(press(panel, 'Tab').defaultPrevented).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    dispose()
  })

  it('restores focus to the opener on dispose, and is idempotent', () => {
    const { panel, trigger, inside } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    expect(document.activeElement).toBe(inside[0])
    dispose()
    expect(document.activeElement).toBe(trigger)
    inside[1]!.focus()
    dispose()
    expect(document.activeElement).toBe(inside[1])
  })

  it('skips the restore when the opener left the document', () => {
    const { panel, trigger } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: true })
    trigger.remove()
    expect(() => { dispose() }).not.toThrow()
  })

  it('cancels a pending focus frame when disposed before it runs', () => {
    const frames: FrameRequestCallback[] = []
    const cancel = vi.fn()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancel)
    const { panel, trigger } = mountDrawer()
    const dispose = installDrawerTrap(panel, { onClose: () => {}, reducedMotion: false })
    dispose()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })
})
