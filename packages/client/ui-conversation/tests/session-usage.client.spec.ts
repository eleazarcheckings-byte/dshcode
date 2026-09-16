import { describe, expect, it } from 'vitest'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { sessionTokenUsage } from '../src/client/skeleton/session-usage.ts'

const empty: TokenUsageProjection = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

describe('sessionTokenUsage', () => {
  it('returns null while the projection is absent or still zero', () => {
    expect(sessionTokenUsage(undefined)).toBeNull()
    expect(sessionTokenUsage(empty)).toBeNull()
  })

  it('folds the four disjoint buckets into input, output, and total', () => {
    expect(sessionTokenUsage({
      uncachedInputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
    })).toEqual({ input: 125, output: 40, total: 165 })
  })
})
