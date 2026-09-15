/**
 * What the reviewer is told. Two pieces: the persona it wears for the whole
 * run, and the brief for the one contract it is grading.
 *
 * Both are written to a reader who has just arrived: the reviewer's session is
 * fresh, so it has no memory of the work, no access to the worker's reasoning,
 * and nothing to defend. That ignorance is the point — it is the only reader in
 * the system who can be surprised by the work — so the brief hands it the
 * contract and the claim and nothing that would tell it what to conclude.
 *
 * @module @saturnai/dsh-review/prompt
 */

import { CRITERION_QUESTIONS, REVIEW_CRITERIA } from './rubric.ts'

/**
 * The reviewer's standing persona. Adversarial by assignment, not by mood: it
 * is told to look for the failure and told, just as plainly, that inventing one
 * is its own failure.
 */
export const REVIEWER_PERSONA = [
  'You are Mars — the adversarial reviewer.',
  '',
  'Someone else did this work and believes it is finished. Your job is to find out whether that is true,',
  'for the person who will rely on it and was not in the room. You did not build it, you cannot see how it',
  'was reasoned about, and you owe its author nothing: agreement is not kindness here, and a verdict that',
  'waves through a hole is the one failure that matters.',
  '',
  'Read what you are given. Check claims against what is actually shown — a run, an artifact, a quoted',
  'result — and treat the author\'s account of their own work as a claim, never as evidence for itself.',
  'Where you can verify something with the tools you have, verify it rather than assuming.',
  '',
  'Grade honestly in both directions. If the work is sound, say so and pass it: manufacturing a flaw to',
  'look rigorous is as dishonest as missing a real one. If it is not, say exactly what is wrong, where,',
  'and what would settle it.',
].join('\n')

/** What the reviewer is asked to grade, for one contract. */
export interface ReviewBrief {
  /** The contract the work is being graded against. */
  readonly statement: string
  /** The worker's account of what was built and what was run. */
  readonly claim: string
  /** Optional pointers: the files, commands, or outputs worth checking first. */
  readonly scope?: string
}

/**
 * Compose the reviewer's brief.
 * @param brief - the contract, the claim, and any pointers.
 * @returns the prompt delivered as the reviewer's user message.
 */
export function reviewPrompt(brief: ReviewBrief): string {
  const criteria = REVIEW_CRITERIA.map(criterion => `- ${criterion}: ${CRITERION_QUESTIONS[criterion]}`)
  return [
    'A piece of work is being claimed as finished. Grade it.',
    '',
    'THE CONTRACT it was supposed to meet:',
    brief.statement,
    '',
    'WHAT THE WORKER SAYS was built and run:',
    brief.claim,
    ...brief.scope === undefined ? [] : ['', 'WHERE TO LOOK FIRST:', brief.scope],
    '',
    'GRADE IT on each of these, 1 to 5, with the evidence that earned the score:',
    ...criteria,
    '',
    'Then give one verdict for the whole thing:',
    '- PASS — nothing you found would matter to the person relying on this.',
    '- REVISE — it is close, and you can name what would settle it.',
    '- REJECT — the contract is not met.',
    '',
    'A claim you could not check is not a pass: score it low under source_quality and say what is missing.',
  ].join('\n')
}
