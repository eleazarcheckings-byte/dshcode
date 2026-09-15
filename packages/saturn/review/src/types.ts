/**
 * Pure types of the independent-review domain: what a reviewer returns and
 * what the tool hands back to the agent that asked for the review. The durable
 * vocabulary (the verdict words, the criterion set, the scored line, the
 * countersign record) is owned by `@saturnai/dsh-done`, because the session log
 * and the `done` projection are where it has to survive.
 *
 * @module @saturnai/dsh-review/types
 */

import type { ReviewScore, ReviewVerdict } from '@saturnai/dsh-done'

/** One reviewer's complete answer, after it has been checked against the rubric. */
export interface ReviewAnswer {
  /** The overall judgement. */
  readonly verdict: ReviewVerdict
  /** The reviewer's account of that judgement, in its own words. */
  readonly summary: string
  /** One scored line per criterion, in the rubric's own order. */
  readonly scores: readonly ReviewScore[]
}

/** What the review tool returns to the agent that asked for the review. */
export interface ReviewToolResult extends ReviewAnswer {
  /** Who graded it: the reviewer persona and the backend that ran it. */
  readonly reviewer: string
  /** Present only on PASS: the token `set_definition_of_done` accepts as proof. */
  readonly countersign?: string
}
