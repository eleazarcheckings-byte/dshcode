/**
 * PeakChip — the DeepSeek API pricing-tier lamp, and PeakRail, its seat in
 * the frame's top-right rail.
 *
 * The lamp is frame chrome, not composer chrome: it occupies one
 * `shell.overlay` seat beside the SaturnBot launcher, so it reads the same on
 * the blank hero and inside every session, and it never moves with the
 * composer. It used to sit in the InputBar's trailing row; izzy asked for it
 * at the top of the UI.
 *
 * State: pure client-side UTC clock; no network call, no store.
 * Updates once per minute via `setInterval`.
 *
 * Copy is driven by the `conversation` locale namespace — two keys per locale:
 *   pricing.peak / pricing.offPeak     — chip label (short)
 *   pricing.tooltip.peak / .offPeak    — tooltip with next-switch time
 *
 * A steady status lamp reinforces the label without suggesting agent activity.
 */

import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { isPeakHour, nextTransition, formatTransitionTime } from './deepseek-peak.ts'
import css from './PeakChip.module.css'

// ─── types ───────────────────────────────────────────────────────────────────

export interface PeakChipProps {
  /**
   * The owning seat's locale translate function (conversation namespace).
   * Typed as the bare `Translate` for the dynamic key lookup — the pricing
   * keys are present in the en/zh dictionaries in locales.ts.
   */
  t: Translate
}

/** Full rail-seat props: root overlay runtime and the Conversation locale seat. */
export type PeakRailProps = PropsRuntime<'shell.overlay'> & PropsLocale<'conversation'>

/**
 * Breathing room the rail reserves after its own width, so the Session
 * header's right-aligned utilities stop short of the lamp instead of touching
 * it. Exported for the spec, which asserts the reserved inset exactly.
 */
export const PEAK_RAIL_GAP = 12

/** The frame custom property the Session header adds to its trailing inset. */
const TRAILING_EXTRA = '--dsh-shell-trailing-extra'

// ─── state helpers ───────────────────────────────────────────────────────────

interface PeakState {
  peak: boolean
  nextAt: Date
}

function getState(): PeakState {
  const now = new Date()
  return { peak: isPeakHour(now), nextAt: nextTransition(now).at }
}

/**
 * The SaturnBot dashboard opens as a separate window of the same renderer;
 * it carries no composer and no model, so the lamp stays in the main harness.
 * Same rule as the ambient-motion control.
 */
function isSaturnBotWindow(): boolean {
  return new URLSearchParams(window.location.search).get('saturnbot') === '1'
}

// ─── component ───────────────────────────────────────────────────────────────

/**
 * The pricing-tier chip. Mounts once; updates every 60 s via `setInterval`.
 * `Tooltip` shows the next switch time in UTC.
 *
 * Accessible presentation mirrors Rows' `ActiveScheduleIndicator`: a
 * non-interactive marker is a single named `role="img"` node, never a live
 * region. `role="status"` would re-announce the tier every minute and would
 * collide with the composer's notice strip, which owns that role.
 */
export function PeakChip({ t }: PeakChipProps) {
  const [state, setState] = useState<PeakState>(getState)

  // Re-evaluate every minute; the exact second of the switch is ±60 s,
  // which is accurate enough for a passive pricing nudge.
  useEffect(() => {
    const id = setInterval(() => { setState(getState()) }, 60_000)
    return () => { clearInterval(id) }
  }, [])

  const { peak, nextAt } = state
  const switchTime = formatTransitionTime(nextAt)

  const label = peak ? t('pricing.peak') : t('pricing.offPeak')
  const tooltip = peak
    ? t('pricing.tooltip.peak', { time: switchTime })
    : t('pricing.tooltip.offPeak', { time: switchTime })

  return (
    <Tooltip label={tooltip} side="bottom" delayMs={300}>
      <span
        role="img"
        aria-label={tooltip}
        className={`${css.chip} ${peak ? css.peak : css.offPeak}`}
        // Durable anchor for specs and for the mobile sheet: the hashed
        // CSS-module class is unreachable from outside this package.
        data-peak-chip=""
      >
        <span className={css.dot} aria-hidden />
        <span className={css.label}>{label}</span>
      </span>
    </Tooltip>
  )
}

/**
 * The lamp's seat in the frame's top-right rail (`shell.overlay`).
 *
 * The seat sits at the frame's trailing inset, i.e. immediately left of
 * whatever already owns the corner (the SaturnBot launcher publishes its own
 * width there as `--dsh-shell-trailing-inset`). It then reserves its own
 * measured width plus {@link PEAK_RAIL_GAP} as `--dsh-shell-trailing-extra`
 * on the frame, which the Session header adds to its right padding, so the
 * header utilities (the definition-of-done chip) never slide under the lamp.
 * The two properties are independent, so the seats can mount in any order.
 *
 * @param props - Root overlay runtime and the Conversation locale seat.
 * @returns the lamp for the main harness; nothing in the SaturnBot window.
 */
export function PeakRail({ t }: PeakRailProps) {
  const seat = useRef<HTMLDivElement>(null)
  const [standalone] = useState(isSaturnBotWindow)

  useEffect(() => {
    const node = seat.current
    if (standalone || node === null) return
    const frame = node.closest('[data-shell-overlay]')?.parentElement
    if (frame === null || frame === undefined) return
    const previous = frame.style.getPropertyValue(TRAILING_EXTRA)
    const release = () => {
      if (previous) frame.style.setProperty(TRAILING_EXTRA, previous)
      else frame.style.removeProperty(TRAILING_EXTRA)
    }
    const reserve = () => {
      const width = Math.round(node.getBoundingClientRect().width)
      // No box means the sheet hid the rail (the phone shell does): reserve
      // nothing rather than a bare gap for an invisible lamp.
      if (width === 0) release()
      else frame.style.setProperty(TRAILING_EXTRA, `${width + PEAK_RAIL_GAP}px`)
    }
    reserve()
    // The label changes width at the tier switch and on a locale change, and
    // the sheet can hide the rail at a breakpoint; the reservation follows the
    // seat's box, not a guess about it.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reserve)
    observer?.observe(node)
    return () => {
      observer?.disconnect()
      release()
    }
  }, [standalone])

  if (standalone) return null
  return (
    <div ref={seat} className={css.rail} data-peak-rail="">
      <PeakChip t={t as Translate} />
    </div>
  )
}
