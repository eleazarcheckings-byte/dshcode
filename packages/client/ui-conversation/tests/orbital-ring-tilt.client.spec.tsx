// @vitest-environment jsdom
/**
 * One signature ring tilt everywhere (SPEC §2): -18°, in both render paths.
 * 2026-09-15 transcript-polish, recon/desktop-ux-audit.md item 2 — the live
 * canvas (orbital-field.ts) previously rotated at -0.25 rad (≈-14.3°) while
 * this component's own SVG fallback and the favicon both already used -18°,
 * two paths drawing two angles for the one mark.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { paintOrbitalField } from '../src/client/skeleton/orbital-field.ts'
import { OrbitalCanvas } from '../src/client/skeleton/OrbitalCanvas.tsx'

/** Every ctx method/property this module and its stellar-field import touch, as a recording no-op. */
function makeCtxStub() {
  const rotateCalls: number[] = []
  const gradient = { addColorStop() {} }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'rotate') return (angle: number) => { rotateCalls.push(angle) }
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient
      if (prop in target) return target[prop as string]
      return () => {}
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rotateCalls }
}

describe('paintOrbitalField ring tilt', () => {
  it('rotates the ring at -18° (within the same live oscillation) at time zero', () => {
    const { ctx, rotateCalls } = makeCtxStub()
    paintOrbitalField(ctx, 720, 250, 0, 'idle')
    expect(rotateCalls).toHaveLength(1)
    const expected = -18 * (Math.PI / 180)
    expect(rotateCalls[0]).toBeCloseTo(expected, 5)
  })
})

describe('OrbitalCanvas SVG fallback ring tilt', () => {
  let media: EventTarget & { matches: boolean }
  let hidden: boolean

  beforeEach(() => {
    media = Object.assign(new EventTarget(), { matches: false })
    hidden = false
    vi.stubGlobal('matchMedia', () => media)
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 720, height: 250, x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 250,
      toJSON: () => ({}),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws the static fallback ring at the same -18°', () => {
    const view = render(<OrbitalCanvas motion state="idle" />)
    const g = view.container.querySelector('svg g[transform]')
    expect(g?.getAttribute('transform')).toBe('rotate(-18 360 130)')
  })
})
