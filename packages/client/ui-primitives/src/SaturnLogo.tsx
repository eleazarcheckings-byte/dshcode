import { useId } from 'react'
import type { IconProps } from './icons/props.ts'

/** Native viewBox of the Saturn mark (square user units). */
export const SATURN_LOGO_VIEWBOX = { width: 64, height: 64 }

/** Ring stroke width on the native 64-unit grid, at and above {@link SMALL_EDGE}. */
const MASTER_STROKE = 4.5

/** Ring minor axis on the native grid, at and above {@link SMALL_EDGE}. */
const MASTER_RING_MINOR = 9.5

/** Smallest edge, in px, at which the master geometry rasterizes faithfully. */
const SMALL_EDGE = 20

/** Narrowest stroke, in rendered px, that survives rasterization on any display. */
const MIN_RENDERED_STROKE = 1.6

/**
 * Ring stroke width for a rendered edge.
 *
 * The master geometry is authored for a 64-unit grid, so a fixed unit stroke
 * shrinks with the rendered size: at a 16px edge the master's 4.5 units render
 * at about 1.1px and the ring collapses into a clipped arrowhead. Scaling the
 * stroke keeps the rendered width at or above {@link MIN_RENDERED_STROKE}.
 * @param size - rendered square edge in px.
 * @returns stroke width in native grid units.
 */
function ringStroke(size: number): number {
  return Math.max(MASTER_STROKE, (MIN_RENDERED_STROKE * SATURN_LOGO_VIEWBOX.width) / size)
}

/**
 * Ring minor axis for a rendered edge. The thickened stroke at small edges
 * closes the gap where the ring passes behind the planet's top and in front of
 * its bottom; widening the minor axis reopens both.
 * @param size - rendered square edge in px.
 * @returns minor axis in native grid units.
 */
function ringMinor(size: number): number {
  return size <= SMALL_EDGE ? 11.5 : MASTER_RING_MINOR
}

/**
 * Render the Saturn AI mark: a solid planet with a thin ring tilted 18
 * degrees, passing behind the planet's top and in front of its bottom. Drawn
 * in `currentColor` so it inherits the surrounding theme ink.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the product name for accessibility).
 */
export function SaturnLogo({ size = 24, className }: IconProps) {
  const clipId = useId()
  const stroke = ringStroke(size)
  const minor = ringMinor(size)
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`0 0 ${SATURN_LOGO_VIEWBOX.width} ${SATURN_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={33} width={64} height={31} />
        </clipPath>
      </defs>
      <g stroke="currentColor" strokeWidth={stroke} strokeLinecap="round">
        <ellipse cx={32} cy={32} rx={27} ry={minor} transform="rotate(-18 32 32)" />
      </g>
      <circle cx={32} cy={32} r={15} fill="currentColor" />
      <g stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" clipPath={`url(#${clipId})`}>
        <ellipse cx={32} cy={32} rx={27} ry={minor} transform="rotate(-18 32 32)" />
      </g>
    </svg>
  )
}
