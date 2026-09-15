/** Decorative Saturn canvas with an accessible, static rendering path. */
import { useEffect, useId, useRef } from 'react'
import { paintOrbitalField, type OrbitalAnchor, type OrbitalState } from './orbital-field.ts'
import { STELLAR_CONSTELLATIONS, type StellarPointer } from './stellar-field.ts'
import css from './OrbitalCanvas.module.css'

/** Presentation inputs derived by the conversation shell. */
export interface OrbitalCanvasProps {
  /** User preference; the OS reduced-motion preference always takes precedence. */
  motion: boolean
  /** Actual composer focus and draft state. */
  state: OrbitalState
}

/**
 * Render a deterministic Saturn field. Animation pauses while writing, hidden, or offscreen.
 * @param props - Motion preference and current composer state.
 * @returns Decorative canvas over an SVG fallback, both excluded from the accessibility tree.
 */
export function OrbitalCanvas({ motion, state }: OrbitalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const planetRef = useRef<SVGSVGElement>(null)
  const activeTimeRef = useRef(0)
  const fallbackId = useId().replaceAll(':', '')

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof window.matchMedia !== 'function') return
    const ctx = canvas.getContext('2d')
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let width = 0
    let height = 0
    let visible = true
    let activeTime = activeTimeRef.current
    let lastTime: number | undefined
    let lastPaint = -Infinity
    let pointer: StellarPointer = null
    let pointerTarget: { x: number; y: number } | null = null
    const pointerSurface = canvas.closest<HTMLElement>('[data-shell-frame]') ?? canvas.parentElement?.parentElement
    let anchorElement: HTMLElement | null = null
    const measureAnchor = (): OrbitalAnchor | null => {
      if (anchorElement === null || !anchorElement.isConnected) return null
      const rect = anchorElement.getBoundingClientRect()
      const bounds = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height }
    }
    const canAnimate = (): boolean => ctx !== null && motion && state !== 'drafting' && !media.matches
      && !document.hidden && visible && width > 0 && height > 0
    const paint = (): void => {
      if (width <= 0 || height <= 0) {
        delete canvas.dataset.rendered
        return
      }
      const anchor = measureAnchor()
      const fallback = planetRef.current
      if (fallback !== null) {
        fallback.style.display = anchor === null ? 'none' : ''
        if (anchor !== null) {
          // Keep the SVG planet at the painter's capped scale on ultrawide displays.
          const scale = Math.min(anchor.width / 720, anchor.height / 250, 1)
          fallback.style.left = `${anchor.x + anchor.width / 2 - 360 * scale}px`
          fallback.style.top = `${anchor.y + anchor.height * 0.52 - 130 * scale}px`
          fallback.style.width = `${720 * scale}px`
          fallback.style.height = `${250 * scale}px`
        }
      }
      if (ctx === null) return
      paintOrbitalField(ctx, width, height, activeTime, state, canAnimate() ? pointer : null, anchor)
      canvas.dataset.rendered = ''
    }
    const stop = (): void => {
      cancelAnimationFrame(frame)
      frame = 0
      lastTime = undefined
    }
    const step = (time: number): void => {
      frame = 0
      if (!canAnimate()) { lastTime = undefined; return }
      if (lastTime !== undefined) {
        const elapsed = Math.min(time - lastTime, 100) / 1000
        activeTime += elapsed * (state === 'focused' ? 0.65 : 1)
        activeTimeRef.current = activeTime
        if (pointerTarget !== null || pointer !== null) {
          const currentStrength = pointer?.strength ?? 0
          const targetStrength = pointerTarget === null ? 0 : 1
          const strength = currentStrength + (targetStrength - currentStrength) * (1 - Math.exp(-elapsed * 8))
          const position = pointerTarget ?? pointer
          pointer = position !== null && strength > 0.001 ? { x: position.x, y: position.y, strength } : null
        }
      }
      lastTime = time
      if (time - lastPaint >= 1000 / 30) { paint(); lastPaint = time }
      frame = requestAnimationFrame(step)
    }
    const sync = (): void => {
      if (canAnimate()) {
        if (frame === 0) frame = requestAnimationFrame(step)
      } else {
        stop()
        pointer = null
        pointerTarget = null
        if (!document.hidden && visible) paint()
      }
    }
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      // Bound full-window fill cost on high-density and 4K displays.
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / Math.max(1, width * height)))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!document.hidden && visible) paint()
      sync()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const repaint = (): void => { if (!document.hidden && visible) paint() }
    const anchorObserver = new ResizeObserver(repaint)
    const refreshAnchor = (): void => {
      const next = pointerSurface?.querySelector<HTMLElement>('[data-saturn-anchor]') ?? null
      if (next !== anchorElement) {
        anchorObserver.disconnect()
        anchorElement = next
        if (next !== null) {
          anchorObserver.observe(next)
          // Capped hero width can stay fixed while the surrounding column shifts.
          const column = next.closest('main')
          if (column !== null) anchorObserver.observe(column)
        }
      }
      repaint()
    }
    const containsAnchor = (node: Node): boolean => node instanceof Element
      && (node.matches('[data-saturn-anchor]') || node.querySelector('[data-saturn-anchor]') !== null)
    const mutations = new MutationObserver((records) => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsAnchor))) refreshAnchor()
    })
    if (pointerSurface !== null && pointerSurface !== undefined) {
      mutations.observe(pointerSurface, { childList: true, subtree: true })
      pointerSurface.addEventListener('scroll', repaint, { passive: true, capture: true })
    }
    const intersection = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        visible = entries.some(entry => entry.isIntersecting)
        sync()
      })
      : undefined
    intersection?.observe(canvas)
    media.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    const leave = (): void => { pointerTarget = null }
    const point = (event: PointerEvent): void => {
      if (!canAnimate() || event.pointerType !== 'mouse') return
      const bounds = canvas.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      pointerTarget = x >= 0 && x <= width && y >= 0 && y <= height ? { x, y } : null
    }
    pointerSurface?.addEventListener('pointermove', point, { passive: true })
    pointerSurface?.addEventListener('pointerleave', leave)
    refreshAnchor()
    resize()
    return () => {
      stop()
      resizeObserver.disconnect()
      anchorObserver.disconnect()
      mutations.disconnect()
      intersection?.disconnect()
      media.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      pointerSurface?.removeEventListener('pointermove', point)
      pointerSurface?.removeEventListener('pointerleave', leave)
      pointerSurface?.removeEventListener('scroll', repaint, true)
      delete canvas.dataset.rendered
    }
  }, [motion, state])

  return (
    <div className={css.field} data-orbital-state={state} data-motion={motion ? 'on' : 'off'} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
      <div className={css.fallback}>
        <svg className={css.fallbackSky} viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none">
          {STELLAR_CONSTELLATIONS.map((constellation, index) => (
            <g key={index} className={constellation.minWidth === 0 ? undefined : css.wideConstellation}>
              {constellation.points.map((point, pointIndex) => (
                <circle key={pointIndex} cx={point.x * 1000} cy={point.y * 1000} r="0.9" fill="#fff" opacity="0.32" />
              ))}
              {constellation.edges.map(([from, to], edgeIndex) => {
                const start = constellation.points[from]
                const end = constellation.points[to]
                if (end === undefined) return null
                return <path key={edgeIndex} d={`M${start.x * 1000} ${start.y * 1000}L${end.x * 1000} ${end.y * 1000}`} stroke="#fff" strokeWidth="0.6" vectorEffect="non-scaling-stroke" opacity="0.12" />
              })}
            </g>
          ))}
        </svg>
        <svg ref={planetRef} className={css.fallbackPlanet} viewBox="0 0 720 250" fill="none" style={{ display: 'none' }}>
          <defs>
            <radialGradient id={`${fallbackId}-sphere`} cx="28%" cy="24%" r="78%">
              <stop stopColor="#474747" /><stop offset="0.5" stopColor="#252525" /><stop offset="1" stopColor="#0b0b0b" />
            </radialGradient>
            <linearGradient id={`${fallbackId}-ring`} x1="100" y1="85" x2="610" y2="170" gradientUnits="userSpaceOnUse">
              <stop stopColor="#afafaf" stopOpacity="0.04" /><stop offset="0.6" stopColor="#b5b5b5" stopOpacity="0.45" /><stop offset="1" stopColor="#b5b5b5" stopOpacity="0.1" />
            </linearGradient>
            <clipPath id={`${fallbackId}-front`}><rect x="0" y="130" width="720" height="120" /></clipPath>
          </defs>
          <g transform="rotate(-14.3 360 130)">
            <g stroke={`url(#${fallbackId}-ring)`} strokeWidth="0.7">
              {[146, 156, 166, 176, 186, 196, 206, 216, 226, 236, 246, 256].map(radius => (
                <ellipse key={radius} cx="360" cy="130" rx={radius} ry={radius * 0.255} />
              ))}
            </g>
            <circle cx="360" cy="130" r="69" fill={`url(#${fallbackId}-sphere)`} stroke="#969696" strokeOpacity="0.3" strokeWidth="0.7" />
            <g clipPath={`url(#${fallbackId}-front)`} stroke={`url(#${fallbackId}-ring)`} strokeWidth="0.7">
              {[146, 156, 166, 176, 186, 196, 206, 216, 226, 236, 246, 256].map(radius => (
                <ellipse key={radius} cx="360" cy="130" rx={radius} ry={radius * 0.255} />
              ))}
            </g>
          </g>
        </svg>
      </div>
    </div>
  )
}
