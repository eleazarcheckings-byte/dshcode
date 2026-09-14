/**
 * Regenerate the Saturn AI desktop icon artifacts from the ring mark.
 *
 * `assets/icon.svg` is the 1024 px master and stays the source of the mark's
 * geometry. Rasterizing it unchanged is correct at 48 px and above, but its
 * ring is a hairline: at 16 px the stroke falls under one pixel, the ellipse
 * collapses into a diagonal bar, and the mark reads as an arrowhead rather
 * than a ringed planet. This script therefore emits one size-compensated
 * variant per optical tier, in which only the stroke width and the tile inset
 * change — the ellipse radii, the -18 degree tilt, and the planet radius are
 * the master's, unaltered — then assembles the tiers into a multi-resolution
 * ICO.
 *
 * Outputs (committed; electron-builder consumes the ICO and never runs this
 * script, so a normal build needs no ImageMagick install):
 *   assets/icon.ico   256/128/64/48/40/32/24/20/16 Windows application icon
 *   assets/about.png  256 px ring glyph on transparency, the About surface icon
 *
 * Requires ImageMagick 7 (`magick`) with an SVG delegate — the committed
 * artifacts are what ship, so this is a regeneration tool, not a build step.
 *
 * Usage: node apps/desktop/scripts/make-icon.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const assetsDir = resolve(import.meta.dirname, '..', 'assets')

/** Ring-mark geometry, identical to `assets/icon.svg`. */
const MARK = {
  /** Mark grid the geometry is authored in; the master maps it to a 1024 canvas. */
  grid: 64,
  /** Base scale of the master: 64 grid units -> 768 px of the 1024 canvas. */
  baseScale: 12,
  ringRx: 27,
  ringRy: 9.5,
  /** Ring tilt in degrees; the signature mechanism must survive every size. */
  ringTilt: -18,
  planetR: 15,
  /** Y where the ring passes behind the top and in front of the bottom. */
  ringFrontClipY: 33,
}

/** Saturn AI design-ladder colors, matching the locked cold near-black palette. */
const TILE_FROM = '#121216'
const TILE_TO = '#0a0a0c'
const GOLD = '#DDA43A'

/**
 * Optical tiers. Each tier reuses the master geometry and changes only the
 * compensations a smaller raster needs: a thicker ring so the stroke survives
 * the quantizer, and a smaller tile inset so the mark is not squeezed by
 * padding that only reads as padding at large sizes.
 *
 * The smallest tier additionally relieves the ring's minor axis. At 16 px the
 * planet's diameter exceeds the ring's squashed height, so the ring's two
 * openings collapse into notches and the mark reads as a single gold lozenge.
 * Carrying the ring to a less flattened ellipse restores the two openings and
 * therefore the ringed-planet reading. The ring's major axis, its tilt, and
 * the planet radius stay the master's; only this tier's minor axis moves.
 */
const TIERS = [
  { max: 23, tileInset: 0.01, tileRadius: 0.215, markScale: 1.30, ringStroke: 6.0, ringRy: 12 },
  { max: 47, tileInset: 0.045, tileRadius: 0.219, markScale: 1.12, ringStroke: 5.2, ringRy: MARK.ringRy },
  { max: Number.POSITIVE_INFINITY, tileInset: 0.0625, tileRadius: 0.219, markScale: 1.0, ringStroke: 4.5, ringRy: MARK.ringRy },
]

/** Every entry the Windows ICO carries, largest first. */
const ICO_SIZES = [256, 128, 64, 48, 40, 32, 24, 20, 16]

/**
 * Select the optical tier that owns an output size.
 * @param size - the raster's edge length in pixels.
 * @returns the tier whose maximum size covers the raster.
 */
function tierFor(size) {
  const tier = TIERS.find(candidate => size <= candidate.max)
  if (tier === undefined) throw new Error(`no icon tier covers ${String(size)} px`)
  return tier
}

/**
 * Compose one size-compensated variant of the ring mark on a 1024 canvas.
 * @param size - the raster size the variant is tuned for.
 * @param options.tile - whether to draw the rounded near-black tile behind the mark.
 * @returns the SVG source for the variant.
 */
function variantSvg(size, { tile }) {
  const { grid, baseScale, ringRx, ringTilt, planetR, ringFrontClipY } = MARK
  const tier = tierFor(size)
  const inset = 1024 * tier.tileInset
  const edge = 1024 - inset * 2
  const radius = 1024 * tier.tileRadius
  const scale = baseScale * tier.markScale
  const half = grid / 2
  const markTransform = `translate(512 512) scale(${scale}) translate(${-half} ${-half})`
  const ring = `<ellipse cx="32" cy="32" rx="${ringRx}" ry="${tier.ringRy}" transform="rotate(${ringTilt} 32 32)" />`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="background" x1="${inset + 88}" y1="${inset + 64}" x2="${1024 - inset - 88}" y2="${1024 - inset - 64}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${TILE_FROM}"/>
      <stop offset="1" stop-color="${TILE_TO}"/>
    </linearGradient>
    <clipPath id="front">
      <rect x="0" y="${ringFrontClipY}" width="${grid}" height="${grid - ringFrontClipY}" />
    </clipPath>
  </defs>
${tile ? `  <rect x="${inset}" y="${inset}" width="${edge}" height="${edge}" rx="${radius}" fill="url(#background)"/>\n` : ''}  <g transform="${markTransform}">
    <g stroke="${GOLD}" stroke-width="${tier.ringStroke}" stroke-linecap="round">
      ${ring}
    </g>
    <circle cx="32" cy="32" r="${planetR}" fill="${GOLD}" />
    <g stroke="${GOLD}" stroke-width="${tier.ringStroke}" stroke-linecap="round" clip-path="url(#front)">
      ${ring}
    </g>
  </g>
</svg>
`
}

/**
 * Render one SVG source to a PNG of the exact output size.
 * @param svgPath - the SVG source to rasterize.
 * @param pngPath - destination PNG path.
 * @param size - the raster's edge length in pixels.
 */
function render(svgPath, pngPath, size) {
  magick(['-background', 'none', '-density', '384', svgPath, '-resize', `${size}x${size}`, '-strip', pngPath])
}

/**
 * Run ImageMagick, failing loudly when it is absent or errors.
 * @param args - the `magick` argument vector.
 */
function magick(args) {
  const result = spawnSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (result.error !== undefined) {
    throw new Error('ImageMagick 7 (`magick`) is required to regenerate the icon artifacts', { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`magick ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'saturn-icon-'))
try {
  const rasters = []
  for (const size of ICO_SIZES) {
    const svgPath = join(workDir, `mark-${size}.svg`)
    const pngPath = join(workDir, `mark-${size}.png`)
    writeFileSync(svgPath, variantSvg(size, { tile: true }))
    render(svgPath, pngPath, size)
    rasters.push(pngPath)
  }
  // ImageMagick's ICO coder writes the full multi-entry directory in the order
  // given, so the largest entry stays the one Windows shows in Explorer.
  magick([...rasters, join(assetsDir, 'icon.ico')])

  const aboutSvg = join(workDir, 'about.svg')
  writeFileSync(aboutSvg, variantSvg(256, { tile: false }))
  render(aboutSvg, join(assetsDir, 'about.png'), 256)

  console.log(`Saturn AI icons: wrote icon.ico (${ICO_SIZES.join(', ')}) and about.png into ${assetsDir}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
