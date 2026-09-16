/**
 * Quiet composer-rail session usage: real token-meter totals, no bar.
 * Cost is omitted — there is no USD table on this surface, and DeepSeek
 * peak/off-peak pricing is the PeakChip's job when that engine is selected.
 */

import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `tokenUsage` projection key merge.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { sessionTokenUsage } from './session-usage.ts'
import css from './UsageChip.module.css'

export interface UsageChipProps {
  useProjection: UseProjection
  /** The owning bar's locale seat. */
  t: ComposerBarProps['t']
}

/**
 * Format a token count the same way the context panel does.
 * @param value - token count.
 * @param t - Conversation locale seat with compact-number templates.
 */
function formatTokens(value: number, t: ComposerBarProps['t']): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * Compact in/out chip for the composer trailing row.
 * @param props - session projections and locale.
 * @returns the chip, or nothing until real usage exists.
 */
export function UsageChip({ useProjection, t }: UsageChipProps) {
  const usage = useProjection('tokenUsage')
  const figures = sessionTokenUsage(usage)
  if (figures === null) return null
  const input = formatTokens(figures.input, t)
  const output = formatTokens(figures.output, t)
  const label = t('usage.aria', { input, output })
  const tooltip = t('usage.tooltip', { input, output })
  return (
    <Tooltip label={tooltip} side="top" delayMs={200}>
      <span aria-label={tooltip} className={css.chip} data-usage-chip="">
        {label}
      </span>
    </Tooltip>
  )
}
