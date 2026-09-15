// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ExecutionCanvas } from '../src/client/ExecutionCanvas.tsx'
import { branch } from './fixtures.client.ts'

let frames: Map<number, FrameRequestCallback>, count: number
let media: EventTarget & { matches: boolean }, hidden: boolean
const clear = vi.fn(), resizeDisconnect = vi.fn(), intersectionDisconnect = vi.fn()
const arc = vi.fn<CanvasRenderingContext2D['arc']>(), curve = vi.fn()
function frame(time: number): void {
  const pending = [...frames.values()]; frames.clear()
  act(() => { pending.forEach((callback) => { callback(time) }) })
}
beforeEach(() => {
  vi.clearAllMocks(); frames = new Map(); count = 0; hidden = false
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('devicePixelRatio', 4)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++count, callback); return count })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect = resizeDisconnect })
  vi.stubGlobal('IntersectionObserver', class { observe(): void {} disconnect = intersectionDisconnect })
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 170 } as DOMRect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: clear, setTransform: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), bezierCurveTo: curve,
    arc, ellipse: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('animates only real running branches with bounded pixels and frame rate', () => {
  const view = render(<ExecutionCanvas branches={[branch]} motion />)
  expect(view.container.querySelector('canvas')?.width).toBe(600)
  clear.mockClear()
  frame(16); frame(32); frame(48); frame(64)
  expect(clear).toHaveBeenCalledOnce()
  view.rerender(<ExecutionCanvas branches={[{ ...branch, status: 'awaiting-approval' }]} motion />)
  expect(frames.size).toBe(0)
  view.unmount()
  expect(resizeDisconnect).toHaveBeenCalled()
  expect(intersectionDisconnect).toHaveBeenCalled()
})

it('pauses hidden/reduced-motion surfaces while preserving a static topology', () => {
  const view = render(<ExecutionCanvas branches={[branch]} motion />)
  expect(frames.size).toBe(1)
  hidden = true; document.dispatchEvent(new Event('visibilitychange'))
  expect(frames.size).toBe(0)
  hidden = false; document.dispatchEvent(new Event('visibilitychange'))
  expect(frames.size).toBe(1)
  media.matches = true; media.dispatchEvent(new Event('change'))
  expect(frames.size).toBe(0)
  expect(view.container.querySelector('canvas')?.hasAttribute('data-rendered')).toBe(true)
})

it('freezes the signal on user pause and resumes from the retained phase without catching up', () => {
  const view = render(<ExecutionCanvas branches={[branch]} motion />)
  frame(40); frame(80); frame(120)
  const point = (): [number, number] | undefined => {
    const call = arc.mock.calls.findLast(call => call[2] === 2.2)
    return call === undefined ? undefined : [call[0], call[1]]
  }
  const beforePause = point()
  expect(beforePause).toBeDefined()
  view.rerender(<ExecutionCanvas branches={[branch]} motion={false} />)
  expect(frames.size).toBe(0)
  expect(point()).toEqual(beforePause)
  clear.mockClear()
  frame(5000)
  expect(clear).not.toHaveBeenCalled()
  view.rerender(<ExecutionCanvas branches={[branch]} motion />)
  expect(frames.size).toBe(1)
  frame(5040)
  expect(point()).toEqual(beforePause)
  frame(5080)
  expect(point()).not.toEqual(beforePause)
})

it('redraws changed branch topology while paused and keeps OS reduced motion authoritative', () => {
  const view = render(<ExecutionCanvas branches={[branch]} motion={false} />)
  expect(frames.size).toBe(0)
  clear.mockClear(); curve.mockClear(); arc.mockClear()
  view.rerender(<ExecutionCanvas branches={[{ ...branch, status: 'completed' }]} motion={false} />)
  expect(clear).toHaveBeenCalledOnce()
  expect(curve).toHaveBeenCalledOnce()
  expect(arc.mock.calls.some(call => call[2] === 2.2)).toBe(false)
  expect(view.container.querySelector('canvas')?.hasAttribute('data-rendered')).toBe(true)
  media.matches = true
  act(() => { media.dispatchEvent(new Event('change')) })
  view.rerender(<ExecutionCanvas branches={[branch]} motion />)
  expect(frames.size).toBe(0)
  media.matches = false
  act(() => { media.dispatchEvent(new Event('change')) })
  expect(frames.size).toBe(1)
  view.rerender(<ExecutionCanvas branches={[branch]} motion={false} />)
  act(() => { media.dispatchEvent(new Event('change')) })
  expect(frames.size).toBe(0)
})
