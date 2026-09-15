/** Full-window monochrome ambience, pointer-revealed constellations, and deterministic meteors. */

/** Pointer coordinates in canvas CSS pixels and an eased reveal strength from zero to one; null disables reveal. */
export type StellarPointer = {
  /** Horizontal position relative to the canvas. */
  readonly x: number
  /** Vertical position relative to the canvas. */
  readonly y: number
  /** Eased pointer presence supplied by the animation owner. */
  readonly strength: number
} | null

/** Normalized constellation points and indexed edges, shared with the static SVG fallback. */
export const STELLAR_CONSTELLATIONS = [
  {
    minWidth: 0,
    points: [
      { x: 0.055, y: 0.23 }, { x: 0.091, y: 0.145 }, { x: 0.129, y: 0.28 },
      { x: 0.168, y: 0.19 }, { x: 0.201, y: 0.365 },
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    minWidth: 640,
    points: [
      { x: 0.811, y: 0.125 }, { x: 0.853, y: 0.265 }, { x: 0.894, y: 0.175 },
      { x: 0.928, y: 0.30 }, { x: 0.96, y: 0.38 },
    ],
    edges: [[0, 1], [1, 2], [1, 3], [3, 4]],
  },
  {
    minWidth: 0,
    points: [
      { x: 0.07, y: 0.65 }, { x: 0.115, y: 0.76 }, { x: 0.18, y: 0.715 }, { x: 0.225, y: 0.85 },
    ],
    edges: [[0, 1], [1, 2], [2, 3]],
  },
  {
    minWidth: 640,
    points: [
      { x: 0.76, y: 0.65 }, { x: 0.805, y: 0.76 }, { x: 0.88, y: 0.7 }, { x: 0.935, y: 0.86 },
    ],
    edges: [[0, 1], [1, 2], [2, 3]],
  },
] as const

// Priority order keeps the smaller field balanced when its lower-density subset is used.
const STARS = [
  [0.025, 0.55, 0.65, 0.33], [0.974, 0.61, 0.7, 0.36], [0.28, 0.075, 0.65, 0.28], [0.705, 0.06, 0.55, 0.24],
  [0.105, 0.755, 0.55, 0.21], [0.91, 0.825, 0.65, 0.29], [0.038, 0.095, 0.5, 0.2], [0.955, 0.085, 0.6, 0.3],
  [0.17, 0.57, 0.75, 0.39], [0.84, 0.56, 0.55, 0.24], [0.385, 0.035, 0.45, 0.18], [0.62, 0.93, 0.5, 0.18],
  [0.242, 0.93, 0.6, 0.24], [0.745, 0.925, 0.5, 0.22], [0.042, 0.875, 0.65, 0.3], [0.984, 0.93, 0.45, 0.2],
  [0.38, 0.43, 0.45, 0.17], [0.658, 0.57, 0.5, 0.2], [0.415, 0.725, 0.45, 0.18], [0.557, 0.295, 0.5, 0.18],
  [0.214, 0.11, 0.5, 0.23], [0.766, 0.305, 0.45, 0.17], [0.128, 0.94, 0.45, 0.18], [0.823, 0.88, 0.55, 0.2],
  [0.068, 0.665, 0.45, 0.19], [0.953, 0.765, 0.4, 0.17], [0.474, 0.07, 0.5, 0.2], [0.551, 0.035, 0.45, 0.15],
  [0.23, 0.465, 0.4, 0.16], [0.79, 0.685, 0.5, 0.21], [0.016, 0.33, 0.45, 0.17], [0.99, 0.25, 0.45, 0.19],
  [0.189, 0.805, 0.45, 0.17], [0.892, 0.665, 0.4, 0.15], [0.356, 0.93, 0.4, 0.14], [0.536, 0.96, 0.45, 0.16],
  [0.136, 0.065, 0.4, 0.17], [0.868, 0.06, 0.5, 0.24], [0.288, 0.735, 0.4, 0.14], [0.713, 0.8, 0.45, 0.17],
  [0.315, 0.195, 0.45, 0.17], [0.683, 0.16, 0.5, 0.2], [0.065, 0.425, 0.45, 0.18], [0.937, 0.465, 0.5, 0.18],
  [0.318, 0.585, 0.45, 0.18], [0.493, 0.53, 0.55, 0.23], [0.578, 0.675, 0.4, 0.17], [0.722, 0.47, 0.45, 0.21],
  [0.342, 0.85, 0.5, 0.19], [0.522, 0.82, 0.45, 0.17], [0.622, 0.39, 0.45, 0.18], [0.435, 0.18, 0.4, 0.16],
  [0.368, 0.32, 0.5, 0.21], [0.462, 0.655, 0.4, 0.16], [0.599, 0.165, 0.45, 0.18], [0.674, 0.855, 0.4, 0.15],
] as const

// The 116-second cycle spaces passages 8–15 active seconds apart across the entire window.
const METEORS = [
  { at: 0, x: 0.61, y: 0.09, dx: 0.21, dy: 0.18 },
  { at: 8, x: 0.055, y: 0.68, dx: 0.21, dy: 0.18 },
  { at: 16, x: 0.9, y: 0.36, dx: -0.2, dy: 0.2 },
  { at: 29, x: 0.55, y: 0.62, dx: -0.18, dy: 0.2 },
  { at: 41, x: 0.06, y: 0.08, dx: 0.21, dy: 0.22 },
  { at: 56, x: 0.27, y: 0.38, dx: -0.17, dy: 0.19 },
  { at: 65, x: 0.39, y: 0.045, dx: 0.15, dy: 0.2 },
  { at: 79, x: 0.68, y: 0.71, dx: 0.23, dy: 0.17 },
  { at: 90, x: 0.37, y: 0.4, dx: 0.24, dy: 0.19 },
  { at: 103, x: 0.72, y: 0.77, dx: -0.23, dy: 0.16 },
] as const

function proximity(x: number, y: number, radius: number, pointer: StellarPointer): number {
  if (pointer === null) return 0
  const dx = x - pointer.x, dy = y - pointer.y
  const falloff = Math.max(0, 1 - (dx * dx + dy * dy) / (radius * radius))
  return falloff * falloff * pointer.strength
}

function paintMeteor(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  if (time < 2.1) return
  const phase = (time - 2.1) % 116
  for (const meteor of METEORS) {
    const progress = (phase - meteor.at) / 1.05
    if (progress <= 0 || progress >= 1) continue
    const dx = meteor.dx * width, dy = meteor.dy * height
    const distance = Math.hypot(dx, dy)
    const x = meteor.x * width + dx * progress, y = meteor.y * height + dy * progress
    const trail = Math.min(136, width * 0.11) * Math.min(1, progress * 5)
    const tx = dx / distance * trail, ty = dy / distance * trail
    const envelope = Math.sin(progress * Math.PI)
    ctx.strokeStyle = '#e4e4e4'
    ctx.lineCap = 'round'
    for (let segment = 0; segment < 16; segment++) {
      const from = segment / 16, to = (segment + 1) / 16
      ctx.globalAlpha = envelope * from * from * 0.48
      ctx.lineWidth = 0.2 + from * 0.85
      ctx.beginPath()
      ctx.moveTo(x - tx * (1 - from), y - ty * (1 - from))
      ctx.lineTo(x - tx * (1 - to), y - ty * (1 - to))
      ctx.stroke()
    }
    ctx.fillStyle = '#f0f0f0'
    ctx.globalAlpha = envelope * 0.11
    ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = envelope * 0.76
    ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI * 2); ctx.fill()
    return
  }
}

/**
 * Paint full-window diffuse light, stars, and meteors before Saturn without clearing or changing the caller's canvas state.
 * @param ctx - A 2D context already scaled to CSS pixels by the animation owner.
 * @param width - Visible canvas width in CSS pixels.
 * @param height - Visible canvas height in CSS pixels.
 * @param time - Nonnegative active animation time in seconds; zero has no shooting star.
 * @param pointer - Canvas-relative pointer and eased reveal strength, or null to disable proximity highlights.
 */
export function paintStellarField(
  ctx: CanvasRenderingContext2D, width: number, height: number, time: number, pointer: StellarPointer,
): void {
  if (width <= 0 || height <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.52, 0, width * 0.5, height * 0.52, Math.hypot(width, height) * 0.62)
  glow.addColorStop(0, '#fff')
  glow.addColorStop(0.42, '#d7d7d7')
  glow.addColorStop(1, 'rgba(215,215,215,0)')
  ctx.fillStyle = glow
  ctx.globalAlpha = 0.014 + Math.sin(time * 0.16) * 0.004
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#d7d7d7'
  const count = width < 640 ? 20 : width < 900 ? 36 : STARS.length
  for (let index = 0; index < count; index++) {
    const star = STARS[index]
    if (star === undefined) continue
    ctx.globalAlpha = star[3] * (1 + Math.sin(time * 0.23 + index * 1.73) * 0.09)
    ctx.beginPath(); ctx.arc(star[0] * width, star[1] * height, star[2], 0, Math.PI * 2); ctx.fill()
  }
  const radius = Math.min(150, width * 0.22)
  ctx.strokeStyle = '#dedede'
  ctx.lineWidth = 0.65
  for (const group of STELLAR_CONSTELLATIONS) {
    if (width < group.minWidth) continue
    for (const [from, to] of group.edges) {
      const a = group.points[from], b = group.points[to]
      if (b === undefined) continue
      const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height
      ctx.globalAlpha = 0.055 + proximity((ax + bx) / 2, (ay + by) / 2, radius, pointer) * 0.19
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
    }
    for (const point of group.points) {
      const x = point.x * width, y = point.y * height
      ctx.globalAlpha = 0.42 + proximity(x, y, radius, pointer) * 0.3
      ctx.beginPath(); ctx.arc(x, y, 0.85, 0, Math.PI * 2); ctx.fill()
    }
  }
  paintMeteor(ctx, width, height, time)
  ctx.restore()
}
