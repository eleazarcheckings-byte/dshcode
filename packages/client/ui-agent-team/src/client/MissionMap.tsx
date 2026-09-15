/** Canvas projection of the real Team roster; all controls remain ordinary HTML. */
import { useEffect, useRef } from 'react'
import type { TeamView } from '@saturnai/dsh-agent-team/client'
import { missionGraph } from './mission.ts'
import css from './TeamAction.module.css'

interface MissionMapProps {
  view: TeamView
  selected: string | null
}

/** Draw roster membership and task dependencies with animation only for running members.
 * @param props - Current Team facts and the roster member under keyboard or pointer focus.
 * @returns an aria-hidden graphic duplicated by the adjacent roster and task descriptions.
 */
export function MissionMap({ view, selected }: MissionMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const { nodes, edges } = missionGraph(view)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = true
    let frame = 0
    let lastFrame = 0
    const running = nodes.some(node => node.member.status === 'running')
    const canPaint = (): boolean => {
      const bounds = canvas.getBoundingClientRect()
      return visible && !document.hidden && bounds.width > 0 && bounds.height > 0
    }

    const paint = (time: number): void => {
      const { width, height } = canvas.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const pixelWidth = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const style = getComputedStyle(canvas)
      const token = (name: string): string => style.getPropertyValue(name).trim()
      const ink = token('--dsw-alias-label-secondary')
      const dim = token('--dsw-alias-border-l1')
      const accent = token('--saturn-accent') || token('--dsw-alias-label-primary')
      const error = token('--dsw-alias-state-error-primary')
      const surface = token('--dsw-alias-bg-layer-2')
      const lead = nodes.find(node => node.member.role === 'lead')
      context.lineWidth = 1
      if (lead !== undefined) {
        for (const node of nodes) {
          if (node === lead) continue
          context.strokeStyle = dim
          context.globalAlpha = selected === node.member.id ? 1 : 0.7
          context.beginPath()
          context.moveTo(lead.x * width, lead.y * height)
          context.lineTo(node.x * width, node.y * height)
          context.stroke()
        }
      }
      for (const edge of edges) {
        const from = nodes.find(node => node.member.id === edge.from)
        const to = nodes.find(node => node.member.id === edge.to)
        if (from === undefined || to === undefined) continue
        context.globalAlpha = 0.7
        context.strokeStyle = accent
        context.setLineDash([3, 5])
        context.beginPath()
        context.moveTo(from.x * width, from.y * height)
        context.lineTo(to.x * width, to.y * height)
        context.stroke()
        context.setLineDash([])
      }
      for (const node of nodes) {
        const x = node.x * width
        const y = node.y * height
        const active = node.member.status === 'running'
        const color = node.member.status === 'failed' ? error : active ? accent : ink
        const radius = node.member.role === 'lead' ? 16 : 10
        const focused = selected === node.member.id
        context.globalAlpha = 1
        if (active || focused) {
          const halo = context.createRadialGradient(x, y, radius, x, y, radius + 30)
          halo.addColorStop(0, color)
          halo.addColorStop(1, 'transparent')
          context.globalAlpha = focused ? 0.2 : 0.1
          context.fillStyle = halo
          context.beginPath()
          context.arc(x, y, radius + 30, 0, Math.PI * 2)
          context.fill()
          context.globalAlpha = 1
        }
        context.fillStyle = surface
        context.strokeStyle = color
        context.lineWidth = focused ? 2 : 1
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        if (active) {
          const angle = motion.matches ? -Math.PI / 2 : time / 1200
          context.fillStyle = accent
          context.beginPath()
          context.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 2.5, 0, Math.PI * 2)
          context.fill()
        }
        context.fillStyle = color
        context.font = `500 10px ${style.fontFamily}`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(String(node.tasks), x, y)
        context.font = `11px ${style.fontFamily}`
        const label = node.member.name.length > 19 ? `${node.member.name.slice(0, 17)}…` : node.member.name
        context.fillStyle = ink
        context.fillText(label, x, y + radius + 15)
      }
      context.globalAlpha = 1
    }

    const animate = (time: number): void => {
      frame = 0
      if (!canPaint()) return
      // Canvas coordinates are stable; only the small running-state indicator moves.
      if (time - lastFrame >= 32) {
        paint(time)
        lastFrame = time
      }
      if (running && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const restart = (): void => {
      cancelAnimationFrame(frame)
      frame = 0
      if (!canPaint()) return
      paint(performance.now())
      if (running && !motion.matches) frame = requestAnimationFrame(animate)
    }
    const resize = new ResizeObserver(restart)
    resize.observe(canvas)
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some(entry => entry.isIntersecting)
      restart()
    })
    intersection.observe(canvas)
    document.addEventListener('visibilitychange', restart)
    motion.addEventListener('change', restart)
    restart()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', restart)
      motion.removeEventListener('change', restart)
    }
  }, [view, selected])

  return <canvas className={css.mapCanvas} ref={canvasRef} aria-hidden="true" />
}
