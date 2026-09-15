/**
 * PeakChip — composer-dock DeepSeek API pricing-tier indicator.
 *
 * Renders a small capsule chip in the InputBar's trailing control row,
 * adjacent to the model selector. Never sits in the top chrome or nav.
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

import { useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { isPeakHour, nextTransition, formatTransitionTime } from './deepseek-peak.ts'
import css from './PeakChip.module.css'

// ─── types ───────────────────────────────────────────────────────────────────

export interface PeakChipProps {
  /**
   * The owning InputBar's locale translate function (conversation namespace).
   * Cast to `Translate` for the dynamic key lookup — the pricing keys are
   * present in the en/zh dictionaries in locales.ts.
   */
  t: Translate
}

// ─── state helpers ───────────────────────────────────────────────────────────

interface PeakState {
  peak: boolean
  nextAt: Date
}

function getState(): PeakState {
  const now = new Date()
  return { peak: isPeakHour(now), nextAt: nextTransition(now).at }
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
    <Tooltip label={tooltip} side="top" delayMs={300}>
      <span
        role="img"
        aria-label={tooltip}
        className={`${css.chip} ${peak ? css.peak : css.offPeak}`}
      >
        <span className={css.dot} aria-hidden />
        <span className={css.label}>{label}</span>
      </span>
    </Tooltip>
  )
}
