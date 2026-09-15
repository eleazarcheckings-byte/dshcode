/** Decorative execution topology whose moving signals correspond only to running branches. */
import { useEffect, useRef } from 'react'
import type { BotBranch } from '@saturnai/dsh-saturnbot/client'
import css from './Dashboard.module.css'

/**
 * Draw current branches and retain animation phase while motion is paused.
 * @param props - Live branches and the operator's motion preference; OS reduced motion takes precedence.
 * @returns Decorative topology with a static fallback; adjacent DOM owns status text.
 */
export function ExecutionCanvas({ branches, motion }: { branches: readonly BotBranch[]; motion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  const rows = useRef(branches)
  rows.current = branches
  const signature = branches.map(branch => `${branch.id}:${branch.status}`).join('|')
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof matchMedia !== 'function') return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0, height = 0, frame = 0, last = 0, previous: number | undefined
    let inView = true
    const colors = getComputedStyle(canvas)
    const accent = colors.color
    const line = colors.getPropertyValue('--bot-graph-line').trim() || accent
    const stopped = colors.getPropertyValue('--bot-graph-stopped').trim() || accent
    const running = (): boolean => rows.current.some(branch => branch.status === 'running' || branch.status === 'planning')
    const active = (): boolean => motion && !document.hidden && inView && !media.matches && running() && width > 0 && height > 0
    const draw = (): void => {
      if (width <= 0 || height <= 0) { delete canvas.dataset.rendered; return }
      ctx.clearRect(0, 0, width, height)
      const x = width / 2, y = 43
      ctx.lineWidth = 1
      rows.current.forEach((branch, index) => {
        const bx = width * (index + 1) / (rows.current.length + 1), by = height - 36
        const moving = branch.status === 'running' || branch.status === 'planning'
        const color = branch.status === 'failed' || branch.status === 'interrupted' ? stopped : branch.status === 'awaiting-approval' ? accent : line
        ctx.globalAlpha = 0.28
        ctx.strokeStyle = color
        ctx.beginPath(); ctx.moveTo(x, y + 17); ctx.bezierCurveTo(x, y + 60, bx, by - 40, bx, by - 8); ctx.stroke()
        if (moving) {
          const progress = (elapsed.current * 0.32 + index * 0.19) % 1
          const inverse = 1 - progress
          const px = inverse ** 3 * x + 3 * inverse ** 2 * progress * x + 3 * inverse * progress ** 2 * bx + progress ** 3 * bx
          const py = inverse ** 3 * (y + 17) + 3 * inverse ** 2 * progress * (y + 60)
            + 3 * inverse * progress ** 2 * (by - 40) + progress ** 3 * (by - 8)
          ctx.globalAlpha = 0.9; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 0.8; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = moving ? 0.75 : 0.35; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(bx, by, 2.1, 0, Math.PI * 2); ctx.fill()
      })
      ctx.globalAlpha = 0.75; ctx.strokeStyle = accent; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(x, y, 27, 9, -0.3, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = 0.1; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
      canvas.dataset.rendered = ''
    }
    const stop = (): void => { cancelAnimationFrame(frame); frame = 0; previous = undefined }
    const step = (time: number): void => {
      frame = 0
      if (!active()) return
      if (previous !== undefined) elapsed.current += Math.min(time - previous, 100) / 1000
      previous = time
      if (time - last >= 1000 / 30) { draw(); last = time }
      frame = requestAnimationFrame(step)
    }
    const sync = (): void => {
      if (!document.hidden && inView) draw()
      if (active()) { if (frame === 0) frame = requestAnimationFrame(step) } else stop()
    }
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width; height = rect.height
      const dpr = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); sync()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => { inView = entries.some(entry => entry.isIntersecting); sync() }) : undefined
    intersection?.observe(canvas)
    document.addEventListener('visibilitychange', sync); media.addEventListener('change', sync); resize()
    return () => { stop(); observer.disconnect(); intersection?.disconnect(); document.removeEventListener('visibilitychange', sync); media.removeEventListener('change', sync) }
  }, [signature, motion])
  return <div className={css.executionCanvas} aria-hidden="true"><canvas ref={canvasRef} /><svg viewBox="0 0 300 170" fill="none"><circle cx="150" cy="43" r="15" /><ellipse cx="150" cy="43" rx="27" ry="9" transform="rotate(-18 150 43)" />{branches.map((branch, index) => { const x = 300 * (index + 1) / (branches.length + 1); return <g key={branch.id}><path d={`M150 60C150 103 ${x} 94 ${x} 126`} /><circle cx={x} cy="134" r="7" /></g> })}</svg></div>
}
