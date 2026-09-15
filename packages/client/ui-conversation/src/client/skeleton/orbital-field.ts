/** Deterministic canvas painting for the conversation's decorative Saturn field. */
import { paintStellarField, type StellarPointer } from './stellar-field.ts'

/**
 * The signature ring tilt (SPEC §2: "one tilt value everywhere"), in radians
 * for `ctx.rotate`. 2026-09-15 transcript-polish: this canvas previously used
 * -0.25 rad (≈-14.3°) while the favicon/mark (`ui-skin-saturn`) and this
 * file's own SVG fallback used -18° — two render paths drawing two angles
 * for the same mark (recon/desktop-ux-audit.md item 2). -18° is the value the
 * design law's precedent text and the favicon already committed to.
 */
const RING_TILT_RADIANS = -18 * (Math.PI / 180)

/** The composer state echoed by the decorative field; no agent activity is inferred. */
export type OrbitalState = 'idle' | 'focused' | 'drafting'

/** The welcome screen's planet position, relative to the full application canvas. */
export interface OrbitalAnchor {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Paint one Saturn frame with a sparse stellar backdrop in CSS pixels.
 * @param ctx - A 2D context already scaled for the display density.
 * @param width - Visible canvas width in CSS pixels.
 * @param height - Visible canvas height in CSS pixels.
 * @param time - Active animation time in seconds; zero produces the static composition.
 * @param state - Actual composer focus and draft state.
 * @param pointer - Optional pointer proximity used to reveal constellation lines.
 * @param anchor - Planet layout area; null keeps only the application-wide sky.
 */
export function paintOrbitalField(
  ctx: CanvasRenderingContext2D, width: number, height: number, time: number, state: OrbitalState,
  pointer: StellarPointer = null,
  anchor: OrbitalAnchor | null = { x: 0, y: 0, width, height },
): void {
  ctx.clearRect(0, 0, width, height)
  paintStellarField(ctx, width, height, time, pointer)
  if (anchor === null || anchor.width <= 0 || anchor.height <= 0) return
  ctx.save()
  const scale = Math.min(anchor.width / 720, anchor.height / 250, 1)
  ctx.translate(anchor.x + anchor.width / 2, anchor.y + anchor.height * 0.52)
  ctx.scale(scale, scale)
  const angle = RING_TILT_RADIANS + Math.sin(time * 0.35) * 0.085
  const depth = 0.26 + Math.sin(time * 0.25) * 0.022
  const light = 0.94 + Math.sin(time * 0.3) * 0.06 + (state === 'idle' ? 0 : 0.05)

  // The halo establishes the ring's ambient light source.
  const halo = ctx.createRadialGradient(-32, -12, 24, 0, 0, 250)
  halo.addColorStop(0, `rgba(153,153,153,${0.17 * light})`)
  halo.addColorStop(0.48, `rgba(104,104,104,${0.075 * light})`)
  halo.addColorStop(1, 'rgba(104,104,104,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, 0, 250, 0, Math.PI * 2)
  ctx.fill()
  ctx.rotate(angle)

  const ringGradient = ctx.createLinearGradient(-290, -75, 240, 75)
  ringGradient.addColorStop(0, 'rgba(180,180,180,0)')
  ringGradient.addColorStop(0.18, `rgba(167,167,167,${0.29 * light})`)
  ringGradient.addColorStop(0.48, `rgba(177,177,177,${0.78 * light})`)
  ringGradient.addColorStop(0.72, `rgba(203,203,203,${0.9 * light})`)
  ringGradient.addColorStop(1, 'rgba(138,138,138,0.12)')

  // A moving reflection lights the material; its oscillation never suggests a progress loop.
  const reflectionAngle = 1.4 + Math.sin(time * 0.36) * 1.1
  const reflectionX = Math.cos(reflectionAngle) * 218
  const reflectionY = Math.sin(reflectionAngle) * 218 * depth
  const reflection = ctx.createRadialGradient(reflectionX, reflectionY, 8, reflectionX, reflectionY, 132)
  reflection.addColorStop(0, 'rgba(227,227,227,0.82)')
  reflection.addColorStop(0.3, 'rgba(200,200,200,0.38)')
  reflection.addColorStop(1, 'rgba(179,179,179,0)')

  // Retain visible separation on small canvases; reflections follow the same ring paths.
  const ringCount = Math.max(10, Math.round(65 * scale * scale))
  const ringStep = 118.4 / (ringCount - 1)

  const rings = (front: boolean): void => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(-330, front ? 0 : -150, 660, 150)
    ctx.clip()
    ctx.beginPath()
    ctx.ellipse(0, 0, 266, 266 * depth, 0, 0, Math.PI * 2)
    ctx.ellipse(0, 0, 146, 146 * depth, 0, 0, Math.PI * 2)
    ctx.fillStyle = ringGradient
    ctx.globalAlpha = 0.075
    ctx.fill('evenodd')
    ctx.strokeStyle = ringGradient
    for (let i = 0; i < ringCount; i++) {
      const radius = 146 + i * ringStep
      if (radius > 211 && radius < 217) continue
      ctx.globalAlpha = i % 7 === 0 ? 0.82 : 0.28 + (i / ringCount) * 0.21
      ctx.lineWidth = Math.max(i % 7 === 0 ? 0.95 : 0.65, 0.7 / scale)
      ctx.beginPath()
      ctx.ellipse(0, 0, radius, radius * depth, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (front) {
      ctx.strokeStyle = reflection
      ctx.globalAlpha = 0.72
      for (let i = 0; i < ringCount; i += 2) {
        const radius = 146 + i * ringStep
        if (radius > 211 && radius < 217) continue
        ctx.lineWidth = Math.max(i % 12 === 0 ? 1.3 : 0.7, 0.7 / scale)
        ctx.beginPath()
        ctx.ellipse(0, 0, radius, radius * depth, 0, 0, Math.PI)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  rings(false)

  // A shaded volume occludes the far half of the rings; the illuminated rim faces the input.
  const sphere = ctx.createRadialGradient(-29, -35, 3, 4, 7, 75)
  sphere.addColorStop(0, '#505050')
  sphere.addColorStop(0.25, '#383838')
  sphere.addColorStop(0.65, '#171717')
  sphere.addColorStop(1, '#0b0b0b')
  ctx.beginPath()
  ctx.arc(0, 0, 69, 0, Math.PI * 2)
  ctx.fillStyle = sphere
  ctx.fill()
  const rim = ctx.createLinearGradient(-70, -55, 58, 60)
  rim.addColorStop(0, `rgba(211,211,211,${0.86 * light})`)
  rim.addColorStop(0.35, 'rgba(163,163,163,0.36)')
  rim.addColorStop(0.72, 'rgba(109,109,109,0.06)')
  rim.addColorStop(1, 'rgba(109,109,109,0)')
  ctx.strokeStyle = rim
  ctx.lineWidth = 0.9
  ctx.stroke()
  rings(true)

  // This broad reflection moves with the ring plane; it is lighting, not progress.
  ctx.beginPath()
  ctx.ellipse(0, 0, 229, 229 * depth, 0, reflectionAngle - 0.45, reflectionAngle + 0.45)
  ctx.strokeStyle = `rgba(211,211,211,${0.34 * light})`
  ctx.lineWidth = 1.15
  ctx.stroke()
  ctx.restore()
}
