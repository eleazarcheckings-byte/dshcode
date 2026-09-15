/**
 * The rubric: the fixed six criteria an independent reviewer grades, the
 * object-rooted schema the reviewer child must satisfy to finish, and the
 * parse that refuses anything else.
 *
 * A reviewer that may invent its own criteria is not a gate, so the criterion
 * set is closed and the parse rejects a missing, duplicated, or unknown one.
 */

import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { REVIEW_CRITERIA, REVIEW_OUTPUT_SCHEMA, parseVerdict } from '../src/rubric.ts'

/** One complete, well-formed reviewer answer. */
function verdict(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'PASS',
    summary: 'The contract is met: the suite runs and the refusals are covered.',
    scores: REVIEW_CRITERIA.map(criterion => ({
      criterion,
      score: 4,
      evidence: `checked ${criterion} against the transcript`,
    })),
    ...over,
  }
}

describe('the rubric', () => {
  it('grades exactly the six doctrine criteria', () => {
    expect(REVIEW_CRITERIA).toEqual([
      'factual_accuracy',
      'completeness',
      'format_compliance',
      'internal_consistency',
      'edge_case_handling',
      'source_quality',
    ])
  })

  it('publishes an object-rooted schema inside the enforced subset', () => {
    expect(() => { assertObjectJsonSchema(REVIEW_OUTPUT_SCHEMA) }).not.toThrow()
  })
})

describe('parseVerdict', () => {
  it('accepts a complete answer and returns it normalized', () => {
    const parsed = parseVerdict(verdict())
    expect(parsed.verdict).toBe('PASS')
    expect(parsed.scores).toHaveLength(6)
    expect(parsed.scores[0]).toEqual({
      criterion: 'factual_accuracy',
      score: 4,
      evidence: 'checked factual_accuracy against the transcript',
    })
  })

  it('refuses an answer that skips a criterion', () => {
    const scores = REVIEW_CRITERIA.slice(1).map(criterion => ({ criterion, score: 5, evidence: 'ok' }))
    expect(() => parseVerdict(verdict({ scores }))).toThrow(/factual_accuracy/u)
  })

  it('refuses a duplicated criterion', () => {
    const scores = REVIEW_CRITERIA.map(() => ({ criterion: 'completeness', score: 5, evidence: 'ok' }))
    expect(() => parseVerdict(verdict({ scores }))).toThrow(/completeness/u)
  })

  it('refuses a score outside 1-5', () => {
    const scores = REVIEW_CRITERIA.map(criterion => ({ criterion, score: 6, evidence: 'ok' }))
    expect(() => parseVerdict(verdict({ scores }))).toThrow()
  })

  it('refuses an unknown verdict word', () => {
    expect(() => parseVerdict(verdict({ verdict: 'LGTM' }))).toThrow()
  })

  it('refuses a score with no evidence', () => {
    const scores = REVIEW_CRITERIA.map(criterion => ({ criterion, score: 5, evidence: '   ' }))
    expect(() => parseVerdict(verdict({ scores }))).toThrow()
  })

  it('refuses a non-object answer', () => {
    expect(() => parseVerdict('PASS')).toThrow()
  })
})
