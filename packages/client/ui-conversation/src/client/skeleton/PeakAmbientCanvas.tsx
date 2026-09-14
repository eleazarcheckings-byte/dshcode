/**
 * PeakAmbientCanvas — a small chip-scoped canvas that emits a subtle ambient
 * particle field. The look reacts to the current pricing tier:
 *
 *   Peak     → muted red particles (the chip's own red lamp hue), slightly
 *              denser drift + a slow orbital sweep on the right edge,
 *              conveying gentle urgency.
 *   Off-peak → muted green particles (the chip's green lamp hue), sparse and
 *              calm — space at rest.
 *
 * Three motion types, intentional and minimal:
 *   1. Drift   — every particle floats in a slow random direction.
 *   2. Breathe — each particle's opacity pulses on its own period.
 *   3. Orbit   — in peak mode a secondary ring of particles traces a slow arc
 *               around the chip's trailing quarter, adding warmth without noise.
 *
 * Render guards:
 *   - `prefers-reduced-motion: reduce` → canvas hidden via CSS; RAF never starts.
 *   - Tab hidden (`visibilitychange`) → RAF paused, canvas cleared.
 *   - Canvas ResizeObserver keeps pixel dimensions matching the layout box.
 *   - Capability guard: jsdom (the unit lane) implements neither `matchMedia`
 *     nor a canvas 2D backend, so those detections degrade to a static chip
 *     instead of throwing. A real browser always satisfies them.
 */

import { useEffect, useRef } from 'react'
import css from './PeakAmbientCanvas.module.css'

// ─── capability guards ───────────────────────────────────────────────────────

/**
 * True when the chip may animate. `matchMedia` is absent under jsdom (the unit
 * lane) even though lib.dom types it as always present; an unknown preference
 * degrades to "no motion" rather than throwing, so the field stays static
 * there and the effect never touches the canvas. Every real browser provides
 * the API, so the OS preference — and the matching CSS rule — still govern the
 * rendered field.
 */
function motionAllowed(): boolean {
  /* v8 ignore next 2 -- jsdom (the unit lane) omits matchMedia; every browser provides it, so the absent arm is unit-lane-only. */
  if (typeof matchMedia !== 'function') return false
  return !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * True when the runtime offers a frame clock. jsdom without `pretendToBeVisual`
 * and non-browser runtimes leave `requestAnimationFrame` undefined; the field
 * then holds a static frame instead of animating rather than throwing.
 */
function hasFrameClock(): boolean {
  /* v8 ignore next -- needs a runtime without a frame clock; jsdom and every browser provide one. */
  return typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'
}

// ─── palette ────────────────────────────────────────────────────────────────

/**
 * Muted red family — the peak hours palette. Keyed to the chip's own red lamp
 * hue (`--dsw-static-red-400`) and built from the skin's red static scale, so
 * the field behind the label agrees with the light rather than fighting it.
 */
const PEAK_COLORS = [
  { r: 224, g: 104, b: 95 },  // #E0685F  (red-400 — the lamp hue)
  { r: 200, g: 68, b: 57 },   // #C84439  (red-500 — deeper)
  { r: 177, g: 53, b: 43 },   // #B1352B  (red-600 — deepest)
]

/**
 * Muted green family — the off-peak palette, keyed to the chip's green lamp hue
 * (`--dsw-static-green-400`) and built from the skin's green static scale.
 * Mid tones only: the field must never outshine the lamp, and a pale highlight
 * at particle alpha would wash the 11px label where it overlapped a glyph.
 */
const OFF_PEAK_COLORS = [
  { r: 92, g: 171, b: 112 },  // #5CAB70  (green-400 — the lamp hue)
  { r: 53, g: 138, b: 80 },   // #358A50  (green-500 — deeper)
]

// ─── particle shape ──────────────────────────────────────────────────────────

interface Particle {
  x: number
  y: number
  /** Velocity in pixels/frame. */
  vx: number
  vy: number
  r: number    // radius px
  a: number    // current alpha 0..1
  av: number   // alpha velocity (breathe)
  /** Colour index into the current palette. */
  ci: number
}

function makeParticle(w: number, h: number, peak: boolean): Particle {
  const speed = peak ? 0.18 : 0.10
  const angle = Math.random() * Math.PI * 2
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(angle) * speed * (0.5 + Math.random() * 0.5),
    vy: Math.sin(angle) * speed * (0.5 + Math.random() * 0.5),
    r: 0.7 + Math.random() * (peak ? 1.2 : 0.8),
    a: 0.1 + Math.random() * 0.35,
    av: (Math.random() - 0.5) * 0.004,
    ci: Math.floor(Math.random() * 3),
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export interface PeakAmbientCanvasProps {
  peak: boolean
}

/**
 * Renders a decorative `<canvas>` positioned absolutely within its parent.
 * The parent must be `position: relative` with `overflow: hidden`.
 */
export function PeakAmbientCanvas({ peak }: PeakAmbientCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const peakRef = useRef(peak)
  peakRef.current = peak

  useEffect(() => {
    // Respect the OS reduce-motion preference — skip entirely.
    if (!motionAllowed()) return
    // No frame clock to drive the field: leave the canvas static rather than
    // crash on an undefined requestAnimationFrame.
    if (!hasFrameClock()) return

    const canvas = canvasRef.current
    if (canvas === null) return
    // A runtime can expose a <canvas> but no 2D backend; a null context means
    // there is nothing to draw, so the ambient field is skipped.
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    // ── size ──────────────────────────────────────────────────────────────
    let W = 0, H = 0
    let particles: Particle[] = []

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      W = Math.round(rect.width) || 1
      H = Math.round(rect.height) || 1
      const dpr = window.devicePixelRatio || 1
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)
      // Rebuild particles so they land inside the new bounds.
      const count = Math.max(8, Math.round(W * 0.22))
      particles = Array.from({ length: count }, () => makeParticle(W, H, peakRef.current))
    }

    // Use ResizeObserver so the canvas tracks CSS layout changes.
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    // ── RAF loop ──────────────────────────────────────────────────────────
    let rafId = 0
    let paused = false

    const onVisibility = (): void => {
      paused = document.hidden
      if (!paused && rafId === 0) rafId = requestAnimationFrame(step)
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Orbital sweep: a second ring of particles arc clockwise in peak mode.
    let orbitAngle = 0

    const step = (): void => {
      if (paused) { rafId = 0; return }

      ctx.clearRect(0, 0, W, H)

      const isPeak = peakRef.current
      const palette = isPeak ? PEAK_COLORS : OFF_PEAK_COLORS
      const speedScale = isPeak ? 1.0 : 0.6
      // `noUncheckedIndexedAccess` makes every read `Color | undefined`; both
      // palettes are non-empty constants, so the first entry is a safe wrap
      // fallback for the modulo index below.
      const wrapColor = palette[0]
      /* v8 ignore next -- the palettes are non-empty module constants. */
      if (wrapColor === undefined) return

      // ── drift + breathe particles ────────────────────────────────────
      for (const p of particles) {
        p.x = (p.x + p.vx * speedScale + W) % W
        p.y = (p.y + p.vy * speedScale + H) % H
        p.a += p.av
        if (p.a < 0.05) { p.a = 0.05; p.av = Math.abs(p.av) }
        if (p.a > 0.50) { p.a = 0.50; p.av = -Math.abs(p.av) }

        const col = palette[p.ci % palette.length] ?? wrapColor
        ctx.save()
        ctx.globalAlpha = p.a
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${col.r},${col.g},${col.b})`
        ctx.fill()
        ctx.restore()
      }

      // ── orbital arc (peak only) ──────────────────────────────────────
      if (isPeak) {
        orbitAngle = (orbitAngle + 0.004) % (Math.PI * 2)
        const cx = W * 0.82
        const cy = H * 0.5
        const orbitR = Math.min(W, H) * 0.32
        const ORBIT_COUNT = 3
        for (let i = 0; i < ORBIT_COUNT; i++) {
          const a = orbitAngle + (i / ORBIT_COUNT) * Math.PI * 2
          const ox = cx + Math.cos(a) * orbitR
          const oy = cy + Math.sin(a) * orbitR
          const col = PEAK_COLORS[i % PEAK_COLORS.length] ?? wrapColor
          ctx.save()
          ctx.globalAlpha = 0.18
          ctx.beginPath()
          ctx.arc(ox, oy, 1.0, 0, Math.PI * 2)
          ctx.fillStyle = `rgb(${col.r},${col.g},${col.b})`
          ctx.fill()
          ctx.restore()
        }
      }

      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, []) // intentionally no deps — peak reads via ref

  return <canvas ref={canvasRef} className={css.canvas} aria-hidden />
}
