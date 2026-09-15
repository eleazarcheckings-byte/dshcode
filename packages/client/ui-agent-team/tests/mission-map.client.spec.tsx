// @vitest-environment jsdom
/** The visual map settles when motion is unnecessary and disposes browser resources. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamView } from '@saturnai/dsh-agent-team/client'
import { MissionMap } from '../src/client/MissionMap.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function browser() {
  let intersection: IntersectionObserverCallback | undefined
  let resize: ResizeObserverCallback | undefined
  let motionChanged: (() => void) | undefined
  const resizeDisconnect = vi.fn()
  const intersectionDisconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect = resizeDisconnect
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback }
    observe() {}
    disconnect = intersectionDisconnect
  })
  const motion = {
    matches: false,
    addEventListener: (_name: string, callback: () => void) => { motionChanged = callback },
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', () => motion)
  const request = vi.fn(() => 7)
  const cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const bounds = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 250 } as DOMRect)
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), setLineDash: vi.fn(), fill: vi.fn(), arc: vi.fn(), fillText: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return {
    context, request, cancel, hidden, motion, bounds, resizeDisconnect, intersectionDisconnect,
    resize: () => resize!([], {} as ResizeObserver),
    intersect: (value: boolean) => intersection!([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver),
    reduce: () => { motion.matches = true; motionChanged!() },
  }
}

const view: TeamView = {
  members: [{ id: 'lead' as SessionId, name: 'lead', role: 'lead', status: 'running', diagnostics: [] }],
  tasks: [],
}

describe('mission map lifecycle', () => {
  it('does not schedule frames at zero size and resumes when resize reveals the map', () => {
    const b = browser()
    b.bounds.mockReturnValue({ width: 0, height: 0 } as DOMRect)
    render(<MissionMap view={view} selected={null} />)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.context.clearRect).not.toHaveBeenCalled()
    b.bounds.mockReturnValue({ width: 400, height: 250 } as DOMRect)
    act(() => { b.resize() })
    expect(b.request).toHaveBeenCalledOnce()
    b.bounds.mockReturnValue({ width: 0, height: 250 } as DOMRect)
    act(() => { b.resize() })
    expect(b.request).toHaveBeenCalledOnce()
    expect(b.cancel).toHaveBeenCalledWith(7)
  })

  it('animates only while visible and cancels its observers when removed', () => {
    const b = browser()
    const rendered = render(<MissionMap view={view} selected={null} />)
    expect(b.context.fillText).toHaveBeenCalledWith('lead', 200, 156)
    expect(b.request).toHaveBeenCalledTimes(1)
    act(() => { b.intersect(false) })
    expect(b.cancel).toHaveBeenCalledWith(7)
    expect(b.request).toHaveBeenCalledTimes(1)
    act(() => { b.intersect(true) })
    expect(b.request).toHaveBeenCalledTimes(2)
    b.hidden.mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(b.request).toHaveBeenCalledTimes(2)
    b.hidden.mockReturnValue(false)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(b.request).toHaveBeenCalledTimes(3)
    act(() => { b.reduce() })
    expect(b.request).toHaveBeenCalledTimes(3)
    rendered.unmount()
    expect(b.resizeDisconnect).toHaveBeenCalledOnce()
    expect(b.intersectionDisconnect).toHaveBeenCalledOnce()
    expect(b.motion.removeEventListener).toHaveBeenCalledOnce()
  })

  it('paints settled teams once and retains their names without a frame loop', () => {
    const b = browser()
    render(<MissionMap view={{ ...view, members: [{ ...view.members[0]!, status: 'idle' }] }} selected="lead" />)
    expect(b.context.fillText).toHaveBeenCalledWith('lead', 200, 156)
    expect(b.request).not.toHaveBeenCalled()
  })
})
