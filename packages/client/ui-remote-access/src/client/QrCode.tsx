/**
 * The pairing code, drawn as one SVG path over a module grid. It is a
 * receipt, not a picture: no gradient, no logo cut out of the middle, no
 * rounding that a scanner has to forgive. The quiet zone is part of the
 * symbol, so it is part of the viewBox.
 */

import { useMemo, type ReactNode } from 'react'
import { encodeQr, qrPathData } from './qr.ts'
import css from './QrCode.module.css'

/** The payload to encode and the label a screen reader hears. */
export interface QrCodeProps {
  /** The text the symbol carries. */
  value: string
  /** Accessible name for the figure. */
  label: string
}

/** The standard's minimum quiet zone, in modules. */
const QUIET = 4

/**
 * Draw one QR symbol.
 * @param props - the payload and its accessible name.
 * @returns the SVG, or null when the payload cannot be encoded.
 */
export function QrCode({ value, label }: QrCodeProps): ReactNode {
  const drawn = useMemo(() => {
    try {
      const matrix = encodeQr(value)
      return { path: qrPathData(matrix), extent: matrix.size + QUIET * 2 }
    } catch {
      // A payload no symbol can carry is a host bug, not a person's problem:
      // the card keeps its address and fingerprint and simply shows no code.
      return undefined
    }
  }, [value])
  if (drawn === undefined) return null
  return (
    <svg
      className={css.code}
      data-testid="remote-qr"
      viewBox={`0 0 ${String(drawn.extent)} ${String(drawn.extent)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className={css.ground} x="0" y="0" width={drawn.extent} height={drawn.extent} />
      <g transform={`translate(${String(QUIET)} ${String(QUIET)})`}>
        <path className={css.modules} d={drawn.path} />
      </g>
    </svg>
  )
}
