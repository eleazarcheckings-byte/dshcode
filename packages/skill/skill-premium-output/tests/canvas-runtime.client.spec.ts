// @vitest-environment jsdom
/** Exercises the same standalone canvas recipe that generated apps copy into their own source. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Frame {
  width: number
  height: number
  dpr: number
  time: number
  delta: number
  reducedMotion: boolean
}

interface Controller {
  setPaused(value: boolean): void
  repaint(): void
  dispose(): void
}

type AttachCanvas = (
  canvas: HTMLCanvasElement,
  render: (context: CanvasRenderingContext2D, frame: Frame) => void,
  options?: { fps?: number; maxDpr?: number; paused?: boolean },
) => Controller | null

// The recipe ships as plain JavaScript for copying, outside the package's TypeScript compiler face.
const recipe = '../skills/purposeful-motion/recipes/canvas-runtime.mjs'
const { attachCanvas } = await import(recipe) as { attachCanvas: AttachCanvas }

let callbacks: Map<number, FrameRequestCallback>
let sequence: number
let hidden: boolean
let dimensions: { width: number; height: number }
let resized: () => void
let intersected: (visible: boolean) => void
let media: EventTarget & { matches: boolean }
let canvas: HTMLCanvasElement
let controller: Controller | null
const resizeDisconnect = vi.fn()
const intersectionDisconnect = vi.fn()
const context = { save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn() }

function tick(time: number): void {
  const pending = [...callbacks.values()]
  callbacks.clear()
  for (const callback of pending) callback(time)
}

beforeEach(() => {
  vi.clearAllMocks()
  callbacks = new Map()
  sequence = 0
  hidden = false
  controller = null
  dimensions = { width: 720, height: 250 }
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
  vi.stubGlobal('devicePixelRatio', 4)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe(): void {}
    disconnect = resizeDisconnect
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersected = (visible) => {
        callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
    }
    observe(): void {}
    disconnect = intersectionDisconnect
  })
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  canvas = document.createElement('canvas')
  document.body.append(canvas)
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({
    ...dimensions, x: 0, y: 0, left: 0, top: 0, right: dimensions.width, bottom: dimensions.height, toJSON: () => ({}),
  }))
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  controller?.dispose()
  canvas.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('copied canvas runtime', () => {
  it('scales and clears the context, paints at the budget, and clamps a long frame gap', () => {
    const render = vi.fn<Parameters<AttachCanvas>[1]>()
    controller = attachCanvas(canvas, render)
    expect(canvas.width).toBe(1440)
    expect(canvas.height).toBe(500)
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0)
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 720, 250)
    expect(render.mock.lastCall?.[1]).toEqual({ width: 720, height: 250, dpr: 2, time: 0, delta: 0, reducedMotion: false })
    render.mockClear()
    tick(0)
    tick(16)
    tick(32)
    expect(render).not.toHaveBeenCalled()
    tick(48)
    expect(render).toHaveBeenCalledOnce()
    expect(render.mock.lastCall?.[1].delta).toBeCloseTo(0.048)
    tick(10_000)
    expect(render.mock.lastCall?.[1].time).toBeCloseTo(0.148)
    expect(render.mock.lastCall?.[1].delta).toBeCloseTo(0.1)
    expect(callbacks.size).toBe(1)
    expect(context.save.mock.calls.length).toBe(context.restore.mock.calls.length)
  })

  it('retains scene time through user pause, hidden tabs, offscreen state, and zero-size layout', () => {
    const render = vi.fn<Parameters<AttachCanvas>[1]>()
    controller = attachCanvas(canvas, render)
    tick(0)
    tick(100)
    controller?.setPaused(true)
    expect(callbacks.size).toBe(0)
    controller?.repaint()
    expect(render.mock.lastCall?.[1].time).toBeCloseTo(0.1)
    expect(render.mock.lastCall?.[1].delta).toBe(0)
    controller?.setPaused(false)
    tick(1000)
    tick(1100)
    expect(render.mock.lastCall?.[1].time).toBeCloseTo(0.2)
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(callbacks.size).toBe(0)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    tick(30_000)
    tick(30_100)
    expect(render.mock.lastCall?.[1].time).toBeCloseTo(0.3)
    intersected(false)
    expect(callbacks.size).toBe(0)
    intersected(true)
    expect(callbacks.size).toBe(1)
    dimensions = { width: 0, height: 0 }
    resized()
    expect(callbacks.size).toBe(0)
    dimensions = { width: 380, height: 180 }
    resized()
    expect(callbacks.size).toBe(1)
    expect(render.mock.lastCall?.[1]).toMatchObject({ width: 380, height: 180, delta: 0 })
    expect(render.mock.lastCall?.[1].time).toBeCloseTo(0.3)
  })

  it('renders static reduced-motion frames and disposes all acquired resources', () => {
    media.matches = true
    const render = vi.fn<Parameters<AttachCanvas>[1]>()
    const removeMedia = vi.spyOn(media, 'removeEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    controller = attachCanvas(canvas, render)
    expect(render.mock.lastCall?.[1].reducedMotion).toBe(true)
    expect(callbacks.size).toBe(0)
    media.matches = false
    media.dispatchEvent(new Event('change'))
    expect(callbacks.size).toBe(1)
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(callbacks.size).toBe(0)
    controller?.dispose()
    controller?.dispose()
    expect(resizeDisconnect).toHaveBeenCalledOnce()
    expect(intersectionDisconnect).toHaveBeenCalledOnce()
    expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function))
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function))
    render.mockClear()
    controller?.repaint()
    controller?.setPaused(false)
    resized()
    intersected(true)
    media.dispatchEvent(new Event('change'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(render).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(0)
  })

  it('keeps a missing canvas backend resource-free and releases resources after a render failure', () => {
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)
    expect(attachCanvas(canvas, vi.fn())).toBeNull()
    expect(callbacks.size).toBe(0)
    expect(resizeDisconnect).not.toHaveBeenCalled()
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    expect(() => attachCanvas(canvas, () => { throw new Error('scene failed') })).toThrow('scene failed')
    expect(resizeDisconnect).toHaveBeenCalledOnce()
    expect(intersectionDisconnect).toHaveBeenCalledOnce()
    expect(callbacks.size).toBe(0)
    expect(context.restore).toHaveBeenCalledOnce()
  })

  it('bounds custom options and rejects non-finite budgets', () => {
    expect(() => attachCanvas(canvas, vi.fn(), { fps: NaN })).toThrow('finite numbers')
    expect(() => attachCanvas(canvas, vi.fn(), { maxDpr: Infinity })).toThrow('finite numbers')
    const render = vi.fn<Parameters<AttachCanvas>[1]>()
    controller = attachCanvas(canvas, render, { fps: 1000, maxDpr: 10, paused: true })
    expect(render.mock.lastCall?.[1].dpr).toBe(3)
    expect(callbacks.size).toBe(0)
    controller?.setPaused(false)
    render.mockClear()
    tick(0)
    tick(8)
    expect(render).not.toHaveBeenCalled()
    tick(17)
    expect(render).toHaveBeenCalledOnce()
  })
})
