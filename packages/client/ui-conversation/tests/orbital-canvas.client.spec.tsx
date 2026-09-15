// @vitest-environment jsdom
/** Full-frame geometry, resource ownership, and user motion preferences for the shared sky. */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrbitalCanvas } from '../src/client/skeleton/OrbitalCanvas.tsx'
import { paintOrbitalField } from '../src/client/skeleton/orbital-field.ts'
import { paintStellarField } from '../src/client/skeleton/stellar-field.ts'

vi.mock('../src/client/skeleton/orbital-field.ts', () => ({ paintOrbitalField: vi.fn() }))

let clock: Map<number, FrameRequestCallback>
let sequence: number
let media: EventTarget & { matches: boolean }
let hidden: boolean
let setIntersecting: (visible: boolean) => void
const resizeDisconnect = vi.fn()
const intersectionDisconnect = vi.fn()

function frame(time: number): void {
  const callbacks = [...clock.values()]
  clock.clear()
  act(() => { callbacks.forEach((callback) => { callback(time) }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  clock = new Map()
  sequence = 0
  hidden = false
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    clock.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { clock.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect = resizeDisconnect
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      setIntersecting = (visible) => {
        callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
    }
    observe(): void {}
    disconnect = intersectionDisconnect
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

describe('orbital canvas lifecycle', () => {
  it('bounds backing pixels at DPR 2 and paints no more than 30 frames per second', () => {
    vi.stubGlobal('devicePixelRatio', 4)
    const view = render(<OrbitalCanvas motion state="idle" />)
    const canvas = view.container.querySelector('canvas')!
    expect(canvas.width).toBe(1440)
    expect(canvas.height).toBe(500)
    vi.mocked(paintOrbitalField).mockClear()
    frame(0)
    frame(16)
    frame(32)
    frame(48)
    expect(paintOrbitalField).toHaveBeenCalledTimes(2)
    expect(clock.size).toBe(1)
  })

  it('stops the clock when hidden or offscreen and releases every observer on unmount', () => {
    const view = render(<OrbitalCanvas motion state="idle" />)
    const removeListener = vi.spyOn(view.container, 'removeEventListener')
    expect(clock.size).toBe(1)
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(clock.size).toBe(0)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    expect(clock.size).toBe(1)
    act(() => { setIntersecting(false) })
    expect(clock.size).toBe(0)
    act(() => { setIntersecting(true) })
    expect(clock.size).toBe(1)
    view.unmount()
    expect(clock.size).toBe(0)
    expect(resizeDisconnect).toHaveBeenCalledTimes(2)
    expect(intersectionDisconnect).toHaveBeenCalledOnce()
    expect(removeListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('pointerleave', expect.any(Function))
    document.dispatchEvent(new Event('visibilitychange'))
    media.dispatchEvent(new Event('change'))
    expect(clock.size).toBe(0)
  })

  it('eases mouse proximity into the sky without animating touch, paused, or reduced-motion input', () => {
    const view = render(<OrbitalCanvas motion state="idle" />)
    const move = (pointerType: string): void => {
      act(() => {
        view.container.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType, clientX: 80, clientY: 45 }))
      })
    }
    frame(0)
    move('touch')
    frame(100)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toBeNull()
    move('mouse')
    frame(200)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toMatchObject({ x: 80, y: 45 })
    const strength = vi.mocked(paintOrbitalField).mock.lastCall?.[5]?.strength ?? 0
    expect(strength).toBeGreaterThan(0)
    expect(strength).toBeLessThan(1)
    act(() => { view.container.dispatchEvent(new Event('pointerleave')) })
    frame(300)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]?.strength).toBeLessThan(strength)
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
    move('mouse')
    expect(clock.size).toBe(0)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toBeNull()
    view.rerender(<OrbitalCanvas motion={false} state="idle" />)
    move('mouse')
    expect(clock.size).toBe(0)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toBeNull()
  })

  it('animates an empty focused composer but stops for reduced motion, user pause, and a populated draft', () => {
    media.matches = true
    const view = render(<OrbitalCanvas motion state="idle" />)
    expect(paintOrbitalField).toHaveBeenCalled()
    expect(clock.size).toBe(0)
    act(() => { media.matches = false; media.dispatchEvent(new Event('change')) })
    expect(clock.size).toBe(1)
    view.rerender(<OrbitalCanvas motion={false} state="idle" />)
    expect(clock.size).toBe(0)
    view.rerender(<OrbitalCanvas motion state="focused" />)
    expect(clock.size).toBe(1)
    view.rerender(<OrbitalCanvas motion state="drafting" />)
    expect(clock.size).toBe(0)
    expect(view.container.querySelector('[data-orbital-state="drafting"]')).not.toBeNull()
  })

  it('retains the current frame time through motion toggles, focus, and drafting', () => {
    const view = render(<OrbitalCanvas motion state="idle" />)
    frame(0)
    frame(100)
    const lastTime = (): number | undefined => vi.mocked(paintOrbitalField).mock.lastCall?.[3]
    expect(lastTime()).toBeCloseTo(0.1)
    view.rerender(<OrbitalCanvas motion={false} state="idle" />)
    expect(lastTime()).toBeCloseTo(0.1)
    expect(clock.size).toBe(0)
    view.rerender(<OrbitalCanvas motion state="focused" />)
    expect(lastTime()).toBeCloseTo(0.1)
    frame(300)
    frame(400)
    expect(lastTime()).toBeCloseTo(0.165)
    view.rerender(<OrbitalCanvas motion state="drafting" />)
    expect(lastTime()).toBeCloseTo(0.165)
    expect(clock.size).toBe(0)
  })

  it('resumes from active time without replaying meteors missed while hidden', () => {
    render(<OrbitalCanvas motion state="idle" />)
    frame(0)
    frame(100)
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    frame(20_000)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    frame(30_000)
    frame(30_100)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[3]).toBeCloseTo(0.2)
    expect(clock.size).toBe(1)
  })

  it('clears proximity on drafting and ignores pointer events outside the sky', () => {
    const view = render(<OrbitalCanvas motion state="idle" />)
    const move = (clientX: number, clientY: number): void => {
      view.container.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX, clientY }))
    }
    frame(0)
    move(80, 45)
    frame(100)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).not.toBeNull()
    view.rerender(<OrbitalCanvas motion state="drafting" />)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toBeNull()
    move(80, 45)
    expect(clock.size).toBe(0)
    view.rerender(<OrbitalCanvas motion state="idle" />)
    frame(200)
    move(900, 45)
    frame(300)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toBeNull()
  })

  it('keeps the static fallback without scheduling frames while layout has zero size', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
      toJSON: () => ({}),
    })
    const view = render(<OrbitalCanvas motion state="idle" />)
    expect(view.container.querySelector('canvas[data-rendered]')).toBeNull()
    expect(clock.size).toBe(0)
    expect(paintOrbitalField).not.toHaveBeenCalled()
  })

  it('keeps its deterministic SVG fallback when no canvas backend is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const view = render(<OrbitalCanvas motion state="idle" />)
    expect(view.container.querySelector('svg')).not.toBeNull()
    expect(view.container.querySelector('canvas[data-rendered]')).toBeNull()
    expect(clock.size).toBe(0)
    expect(paintOrbitalField).not.toHaveBeenCalled()
    expect([...view.container.querySelectorAll('svg path')].map(path => path.getAttribute('d'))).toMatchInlineSnapshot(`
      [
        "M55 230L91 145",
        "M91 145L129 280",
        "M129 280L168 190",
        "M168 190L201 365",
        "M811 125L853 265",
        "M853 265L894 175",
        "M853 265L928 300",
        "M928 300L960 380",
        "M70 650L115 760",
        "M115 760L180 715",
        "M180 715L225 850",
        "M760 650L805 760",
        "M805 760L880 700",
        "M880 700L935 860",
      ]
    `)
  })

  it('bounds total backing pixels on a 4K window', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 3840, height: 2160, x: 0, y: 0, top: 0, left: 0, right: 3840, bottom: 2160, toJSON: () => ({}),
    })
    const view = render(<OrbitalCanvas motion state="idle" />)
    const canvas = view.container.querySelector('canvas')!
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_003_000)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.slice(1, 3)).toEqual([3840, 2160])
  })

  it('tracks the planet anchor across foreground layout changes and retains one sky when it disappears', async () => {
    let left = 260
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-saturn-anchor')
        ? { width: 400, height: 190, x: left, y: 100, top: 100, left, right: left + 400, bottom: 290, toJSON: () => ({}) }
        : { width: 720, height: 250, x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 250, toJSON: () => ({}) }
    })
    const scene = (hero: boolean) => <div data-shell-frame="">
      <div data-shell-background=""><OrbitalCanvas motion={false} state="idle" /></div>
      <main>{hero && <div data-saturn-anchor="" />}<button>Foreground</button></main>
    </div>
    const view = render(scene(true))
    const canvas = view.container.querySelector('canvas')!
    const currentAnchor = () => vi.mocked(paintOrbitalField).mock.lastCall?.[6]
    expect(currentAnchor()).toEqual({ x: 260, y: 100, width: 400, height: 190 })
    left = 60
    act(() => { view.container.querySelector('main')!.dispatchEvent(new Event('scroll')) })
    expect(currentAnchor()?.x).toBe(60)
    view.rerender(scene(false))
    await act(async () => { await Promise.resolve() })
    expect(currentAnchor()).toBeNull()
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
    expect(view.container.querySelector('canvas')).toBe(canvas)
    view.rerender(scene(true))
    await act(async () => { await Promise.resolve() })
    expect(currentAnchor()?.x).toBe(60)
    expect(clock.size).toBe(0)
  })

  it('receives pointer movement from foreground controls through the full frame', () => {
    const view = render(<div data-shell-frame="">
      <div><OrbitalCanvas motion state="idle" /></div><button>Foreground</button>
    </div>)
    frame(0)
    view.getByRole('button').dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), {
      pointerType: 'mouse', clientX: 80, clientY: 45,
    }))
    frame(100)
    expect(vi.mocked(paintOrbitalField).mock.lastCall?.[5]).toMatchObject({ x: 80, y: 45 })
  })
})

function stellarRecording(width: number, time: number, pointer: Parameters<typeof paintStellarField>[4] = null, height = 285) {
  const strokes: { alpha: number; from: number[]; to: number[] }[] = []
  const dots: { x: number; y: number; radius: number }[] = []
  let from: number[] = []
  let to: number[] = []
  const context = {
    globalAlpha: 1,
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    moveTo(x: number, y: number): void { from = [x, y] },
    lineTo(x: number, y: number): void { to = [x, y] },
    stroke(): void { strokes.push({ alpha: context.globalAlpha, from, to }) },
    arc(x: number, y: number, radius: number): void { dots.push({ x, y, radius }) },
  }
  paintStellarField(context as unknown as CanvasRenderingContext2D, width, height, time, pointer)
  return { strokes, dots, context }
}

describe('stellar canvas composition', () => {
  it('distributes shooting stars through every horizontal and vertical third of the full application', () => {
    const heads: { x: number; y: number }[] = []
    for (let time = 0; time < 180; time += 0.25) {
      const recording = stellarRecording(1920, time, null, 1080)
      const passing = recording.dots.filter(dot => dot.radius === 0.9)
      expect(passing.length).toBeLessThanOrEqual(1)
      heads.push(...passing)
    }
    expect(heads.length).toBeGreaterThan(20)
    expect(new Set(heads.map(head => Math.floor(head.x / 1920 * 3))).size).toBe(3)
    expect(new Set(heads.map(head => Math.floor(head.y / 1080 * 3))).size).toBe(3)
    expect(new Set(heads.map(head => `${head.x < 960 ? 'left' : 'right'}-${head.y < 540 ? 'top' : 'bottom'}`)).size).toBe(4)
    expect(heads.every(head => head.x > 0 && head.x < 1920 && head.y > 0 && head.y < 1080)).toBe(true)
  })

  it('scales meteor travel with the entire window on wide displays', () => {
    const small = stellarRecording(1040, 2.625, null, 600).dots.find(dot => dot.radius === 0.9)
    const large = stellarRecording(2080, 2.625, null, 1200).dots.find(dot => dot.radius === 0.9)
    expect(small).toBeDefined()
    expect(large?.x).toBeCloseTo(small!.x * 2)
    expect(large?.y).toBeCloseTo(small!.y * 2)
  })

  it('draws one brief meteor at a time with quiet intervals between passes', () => {
    const stationary = stellarRecording(1040, 0)
    expect(stellarRecording(1040, 2).strokes).toEqual(stationary.strokes)
    const passing = stellarRecording(1040, 2.625)
    expect(passing.strokes).toHaveLength(stationary.strokes.length + 16)
    expect(passing.dots).toHaveLength(stationary.dots.length + 2)
    expect(stellarRecording(1040, 3.2).strokes).toEqual(stationary.strokes)
    expect(stellarRecording(1040, 20).strokes).toEqual(stationary.strokes)
    expect(stellarRecording(1040, 10.625).strokes).toHaveLength(passing.strokes.length)
    expect(passing.context.save).toHaveBeenCalledOnce()
    expect(passing.context.restore).toHaveBeenCalledOnce()
    expect(passing.dots.slice(-2).map(dot => ({
      x: Number(dot.x.toFixed(3)), y: Number(dot.y.toFixed(3)), radius: dot.radius,
    }))).toMatchInlineSnapshot(`
      [
        {
          "radius": 2.6,
          "x": 743.6,
          "y": 51.3,
        },
        {
          "radius": 0.9,
          "x": 743.6,
          "y": 51.3,
        },
      ]
    `)
  })

  it('reduces stars and constellations on narrow fields without changing their retained placement', () => {
    const wide = stellarRecording(1040, 0)
    const narrow = stellarRecording(380, 0)
    expect(narrow.strokes.length).toBeLessThan(wide.strokes.length)
    expect(narrow.dots.length).toBeLessThan(wide.dots.length)
    expect(narrow.dots.every(dot => dot.x >= 0 && dot.x <= 380 && dot.y >= 0 && dot.y <= 285)).toBe(true)
    expect(narrow.dots[0]!.x / 380).toBeCloseTo(wide.dots[0]!.x / 1040)
    expect(stellarRecording(0, 0).context.save).not.toHaveBeenCalled()
  })

  it('reveals nearby constellation connections without moving any star or connection', () => {
    const quiet = stellarRecording(1040, 0)
    const nearby = stellarRecording(1040, 0, { x: 80, y: 60, strength: 1 })
    expect(nearby.dots).toEqual(quiet.dots)
    expect(nearby.strokes.map(({ from, to }) => ({ from, to }))).toEqual(quiet.strokes.map(({ from, to }) => ({ from, to })))
    expect(nearby.strokes[0]?.alpha).toBeGreaterThan(quiet.strokes[0]!.alpha)
    expect(nearby.strokes.at(-1)?.alpha).toBe(quiet.strokes.at(-1)?.alpha)
    expect(stellarRecording(1040, 0, { x: 80, y: 60, strength: 0 }).strokes).toEqual(quiet.strokes)
  })
})
