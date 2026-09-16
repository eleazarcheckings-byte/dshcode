// @vitest-environment jsdom
/**
 * The DeepSeek pricing lamp in the frame's top-right rail.
 *
 * The chip used to sit in the composer's trailing row. It now occupies one
 * `shell.overlay` seat beside the SaturnBot launcher, so it is visible on the
 * blank hero and inside every session alike, and it reserves its own width in
 * the Session header's trailing inset so the header utilities never slide
 * underneath it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { PeakRail, PEAK_RAIL_GAP } from '../src/client/skeleton/PeakChip.tsx'
import type { PeakRailProps } from '../src/client/skeleton/PeakChip.tsx'

/** 2024-01-01 is a Monday: 01:00 UTC sits inside the first weekday peak window. */
const MONDAY_PEAK = Date.UTC(2024, 0, 1, 1, 0)
/** 2024-01-07 is a Sunday: the whole day is off-peak. */
const SUNDAY_OFF_PEAK = Date.UTC(2024, 0, 7, 12, 0)

const RAIL_WIDTH = 72

let frame: HTMLDivElement
let overlay: HTMLDivElement

function mountRail(now: number, previousInset?: string) {
  vi.setSystemTime(now)
  frame = document.createElement('div')
  frame.setAttribute('data-shell-frame', '')
  if (previousInset !== undefined) frame.style.setProperty('--dsh-shell-trailing-extra', previousInset)
  overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  frame.appendChild(overlay)
  document.body.appendChild(frame)
  const props = { t: makeTranslate(en) } as PeakRailProps
  return render(<PeakRail {...props} />, { container: overlay })
}

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom lays nothing out; give the rail a real footprint so the reserved
  // inset is a measured number, not the 0 that would hide a broken measure.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const isRail = this.hasAttribute('data-peak-rail')
    return {
      x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0,
      width: isRail ? RAIL_WIDTH : 0, height: isRail ? 32 : 0, toJSON: () => ({}),
    }
  })
})

afterEach(() => {
  cleanup()
  frame?.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('PeakRail', () => {
  it('renders the pricing lamp as one named image node in the rail', () => {
    const view = mountRail(MONDAY_PEAK)
    const rail = view.container.querySelector('[data-peak-rail]')
    expect(rail).not.toBeNull()
    const lamp = view.getByRole('img')
    expect(rail?.contains(lamp)).toBe(true)
    expect(lamp.getAttribute('data-peak-chip')).toBe('')
    expect(lamp.getAttribute('aria-label')).toMatch(/^Peak pricing/)
    expect(lamp.textContent).toBe('Peak')
  })

  it('reads the off-peak tier on a weekend', () => {
    const view = mountRail(SUNDAY_OFF_PEAK)
    const lamp = view.getByRole('img')
    expect(lamp.getAttribute('aria-label')).toMatch(/^Off-peak pricing/)
    expect(lamp.textContent).toBe('Off-peak')
  })

  it('reserves its measured width plus the gap in the frame trailing inset, and releases it on unmount', () => {
    const view = mountRail(MONDAY_PEAK)
    expect(frame.style.getPropertyValue('--dsh-shell-trailing-extra')).toBe(`${RAIL_WIDTH + PEAK_RAIL_GAP}px`)
    view.unmount()
    expect(frame.style.getPropertyValue('--dsh-shell-trailing-extra')).toBe('')
  })

  it('restores a pre-existing reservation when it leaves', () => {
    const view = mountRail(MONDAY_PEAK, '40px')
    expect(frame.style.getPropertyValue('--dsh-shell-trailing-extra')).toBe(`${RAIL_WIDTH + PEAK_RAIL_GAP}px`)
    view.unmount()
    expect(frame.style.getPropertyValue('--dsh-shell-trailing-extra')).toBe('40px')
  })

  it('follows the tier switch on its minute tick', () => {
    // Monday 03:59 UTC: last minute of the first peak window.
    const view = mountRail(Date.UTC(2024, 0, 1, 3, 59))
    expect(view.getByRole('img').textContent).toBe('Peak')
    // The minute tick lands outside React's event path; act() flushes it.
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(view.getByRole('img').textContent).toBe('Off-peak')
  })
})
