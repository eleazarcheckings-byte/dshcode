/**
 * The rubric: the closed set of criteria an independent reviewer grades, the
 * object-rooted schema its answer must satisfy, and the parse that refuses
 * anything else.
 *
 * A reviewer free to choose its own axes is not a gate — it is a second opinion
 * with better manners. The six criteria below are fixed, every one of them must
 * come back scored with the evidence that earned the score, and a missing,
 * duplicated, or invented criterion fails the parse rather than passing quietly
 * with a hole in it.
 *
 * @module @saturnai/dsh-review/rubric
 */

import { z as zod } from 'zod'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ReviewCriterion, ReviewScore } from '@saturnai/dsh-done'
import type { ReviewAnswer } from './types.ts'

/**
 * The criteria, in the order a reviewer reports them. Stable: the order is the
 * order a reader sees on the verdict card, and the order the schema requires.
 */
export const REVIEW_CRITERIA = [
  'factual_accuracy',
  'completeness',
  'format_compliance',
  'internal_consistency',
  'edge_case_handling',
  'source_quality',
] as const satisfies readonly ReviewCriterion[]

/** What each criterion asks of the work, in the words the reviewer reads. */
export const CRITERION_QUESTIONS: Readonly<Record<ReviewCriterion, string>> = {
  factual_accuracy: 'Does every claim in the work match something you can point at? Name the claim that does not.',
  completeness: 'Is the whole definition of done covered, or only the easy half of it?',
  format_compliance: 'Does the result take the shape that was asked for, down to the details that are easy to skip?',
  internal_consistency: 'Do the parts agree with each other, and with the summary given for them?',
  edge_case_handling: 'What happens at the boundaries, on the error path, and on the second run?',
  source_quality: 'Is the evidence a real run or a real artifact, rather than the worker\'s own account of it?',
}

/**
 * The schema the reviewer child must satisfy to finish. Inside the enforced
 * JSON Schema subset (object root, typed properties, closed objects, scalar
 * enums), because the subagent seam validates the child's structured answer
 * against it before this package ever sees the value.
 */
export const REVIEW_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'scores'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['PASS', 'REVISE', 'REJECT'],
      description: 'PASS only when nothing you found would matter to the person relying on this work.',
    },
    summary: {
      type: 'string',
      description: 'One short paragraph: what you checked, and what decided the verdict.',
    },
    scores: {
      type: 'array',
      description: 'One entry per criterion, all six, in the order given.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'score', 'evidence'],
        properties: {
          criterion: { type: 'string', enum: [...REVIEW_CRITERIA] },
          score: { type: 'integer', description: '1 to 5, where 5 means you found no flaw under this criterion.' },
          evidence: { type: 'string', description: 'What you looked at to arrive at that score.' },
        },
      },
    },
  },
}

const scoreSchema = zod.object({
  criterion: zod.enum([...REVIEW_CRITERIA]),
  score: zod.number().int().min(1).max(5),
  evidence: zod.string().trim().min(1).max(400),
}).strict()

const answerSchema = zod.object({
  verdict: zod.enum(['PASS', 'REVISE', 'REJECT']),
  summary: zod.string().trim().min(1).max(1200),
  // Bounded here, covered below: a length check reports "wrong size", while the
  // coverage pass can name the criterion the reviewer actually skipped.
  scores: zod.array(scoreSchema).min(1).max(2 * REVIEW_CRITERIA.length),
}).strict()

/**
 * Check one reviewer answer against the rubric and return it in the rubric's
 * own order.
 *
 * Coverage is checked separately from shape: an answer with six well-formed
 * entries that grades one criterion twice has a hole in it, and the message
 * names the criterion rather than the array index, because that is the thing
 * the reviewer has to fix.
 * @param value - the reviewer's structured answer, however malformed.
 * @returns the normalized answer, ordered by {@link REVIEW_CRITERIA}.
 */
export function parseVerdict(value: unknown): ReviewAnswer {
  const parsed = answerSchema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => `${issue.path.join('.') || 'answer'}: ${issue.message}`).join('; ')
    throw new TypeError(`the review did not come back in the rubric's shape — ${detail}`)
  }
  const byCriterion = new Map<ReviewCriterion, ReviewScore>()
  const duplicated: ReviewCriterion[] = []
  for (const score of parsed.data.scores) {
    if (byCriterion.has(score.criterion)) duplicated.push(score.criterion)
    byCriterion.set(score.criterion, score)
  }
  if (duplicated.length > 0) {
    throw new TypeError(
      `the review graded ${[...new Set(duplicated)].join(', ')} more than once; `
      + 'every criterion is scored exactly once',
    )
  }
  const missing = REVIEW_CRITERIA.filter(criterion => !byCriterion.has(criterion))
  if (missing.length > 0) {
    throw new TypeError(`the review left ${missing.join(', ')} ungraded; every criterion must be scored exactly once`)
  }
  return {
    verdict: parsed.data.verdict,
    summary: parsed.data.summary.trim(),
    scores: REVIEW_CRITERIA.map((criterion) => {
      const score = byCriterion.get(criterion)
      /* v8 ignore next -- the missing check above already covers absence */
      if (score === undefined) throw new TypeError(`the review left ${criterion} ungraded`)
      return { criterion, score: score.score, evidence: score.evidence.trim() }
    }),
  }
}
