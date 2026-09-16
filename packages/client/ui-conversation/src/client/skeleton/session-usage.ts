/**
 * Real session token totals from the token-meter `tokenUsage` projection.
 * Returns nothing until a provider has reported at least one token — never a
 * placeholder bar.
 */

import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'

/** Disjoint prompt-side plus decode totals for one session log. */
export interface SessionTokenUsage {
  /** Uncached input plus cache read/write. */
  input: number
  /** Provider-reported output (reasoning already included). */
  output: number
  /** Sum of the four disjoint buckets. */
  total: number
}

/**
 * Fold durable token-meter buckets into display totals.
 * @param usage - session `tokenUsage` projection, or absent.
 * @returns totals, or null when the capability is absent or still zero.
 */
export function sessionTokenUsage(
  usage: TokenUsageProjection | undefined,
): SessionTokenUsage | null {
  if (usage === undefined) return null
  const input = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const output = usage.outputTokens
  const total = input + output
  if (total === 0) return null
  return { input, output, total }
}
