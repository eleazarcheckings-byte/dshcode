/**
 * Definition of done, host half: the session-scoped completion contract behind
 * the composer's DoD strip.
 *
 * Every piece of work this harness undertakes should carry one short, visible
 * statement of what is being built and how we will know it is finished. This
 * package owns that contract:
 *
 * - the `done` projection folds the session log, so the statement survives
 *   resume and fork (whole-value `done/change`, log-only, non-surface);
 * - the `done:policy` system-prompt section turns the standing doctrine
 *   ("'Done' means proven … missing evidence is NOT_ASSESSED") into an
 *   instruction the model reads on every request, and states a definition of
 *   done first when the session has none;
 * - the `/done` command gives the human direct control with no model turn;
 * - the `set_definition_of_done` tool is how the model authors and proves it.
 *
 * A definition of done is a *contract*, not a progress bar: `stated` is the
 * promise, `proven` requires the evidence that met it. Amending the statement
 * always resets it to `stated`, because a changed contract must be proven on
 * its own terms.
 *
 * And `proven` is not a word the worker may simply write about itself. The
 * `prove` action takes only evidence a third party can re-check: a RECEIPT —
 * the id of a tool call in this session whose result was not an error, the run
 * that actually happened — or a COUNTERSIGN — the token an independent
 * reviewer minted after grading the work against the rubric and passing it.
 * Prose alone is refused and the contract stays stated. The one exception is
 * the human at the `/done` command: a person attesting their own work is the
 * principal, not a worker grading itself, and their attestation is recorded as
 * exactly that.
 *
 * @module @saturnai/dsh-done
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
// Type-only: pulls the commands Context merge (ctx.commands).
import type {} from '@deepseek-ai/dsh-commands'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
// Value import: defineTool; type-only pulls the tools Context merge (ctx.tools).
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CountersignRecord, DoneProjection, DoneProof, DoneState, DoneUnitState } from './types.ts'

export type {
  CountersignRecord, DoneProjection, DoneProof, DoneState, DoneStatus, DoneUnitState,
  ReviewCriterion, ReviewScore, ReviewVerdict,
} from './types.ts'

/** Section name; also the anchor a deployment reads in a prompt dump. */
export const DONE_SECTION = 'done:policy'

/** Model tool name; the section names it, so both live here together. */
export const DONE_TOOL = 'set_definition_of_done'

/**
 * The reviewer tool a countersign comes from. Named here because the guidance
 * and the refusal must tell the model where to get a proof; the tool itself is
 * owned by `@saturnai/dsh-review`, which mints tokens through
 * {@link mintCountersign} and is composed independently.
 */
export const REVIEW_TOOL = 'review_definition_of_done'

/** Prefix of every countersign token, so a cited token is recognizable on sight. */
const COUNTERSIGN_PREFIX = 'saturn-countersign:'

/**
 * What the model is told when it claims a contract is met without naming
 * anything that can be re-checked. Both paths are spelled out, because a
 * refusal that does not say what would work is just an obstacle.
 */
export const PROOF_REFUSAL = [
  'A definition of done is not proven by describing the proof.',
  'Cite one of two things and try again:',
  '`receipt`: the `tool_call_id` of a call you made in THIS session whose result was not an error — the test',
  'run, the build, the smoke check you actually performed; or',
  `\`countersign\`: the token \`${REVIEW_TOOL}\` returns after an independent reviewer grades the work PASS.`,
  'If you have neither, the honest move is to leave the contract stated and say what remains unproven.',
].join('\n')

/** Longest statement the domain admits — a definition of done is 1–2 sentences, not a plan. */
const MAX_STATEMENT = 400

/** Longest evidence citation the domain admits — the proof, cited, not re-argued. */
const MAX_EVIDENCE = 240

/**
 * Doctrine the section carries while no definition of done is stated: the
 * `always` default. A fresh or resumed session is told to state one first.
 */
const ABSENT = [
  'Definition of done: this session has none yet.',
  'Before substantive work — anything past a trivial read or a one-line edit — state one first, in one or two',
  'sentences: what you are building, and how we will know it is finished. Record it with the',
  `\`${DONE_TOOL}\` tool (action "state"). Write it concrete enough that someone else could falsify it, and`,
  'keep it to a single confident thought, not a task list.',
].join('\n')

/**
 * Doctrine the section carries while the contract is stated but unproven:
 * the striving half, and the exact bar for calling it proven.
 */
export function statedGuidance(statement: string): string {
  return [
    'Definition of done (stated, not yet proven):',
    `"${statement}"`,
    'Strive against that contract. Prove it the way you would for a colleague: run the thing — the tests,',
    'the smoke check, the command itself — and cite what you ran and what it showed. Then set status',
    `"proven" through \`${DONE_TOOL}\` with a one-line \`evidence\` citation AND the proof it stands on:`,
    '`receipt` — the `tool_call_id` of that run, a call in this session whose result was not an error — or',
    `\`countersign\` — the token \`${REVIEW_TOOL}\` returns once an independent reviewer grades the work PASS.`,
    'Your own account of the work is not a proof and is refused. Missing evidence is NOT_ASSESSED and never',
    'counts as green: if you cannot prove it, say so plainly and leave it stated.',
  ].join('\n')
}

/**
 * Doctrine the section carries once the contract is proven: the standing law
 * that settled work is not reopened, and that a changed contract loses its
 * proof.
 */
export function provenGuidance(statement: string, evidence: string, proof?: DoneProof): string {
  return [
    'Definition of done (PROVEN):',
    `"${statement}"`,
    `Evidence: ${evidence}`,
    ...proof === undefined ? [] : [`Proof: ${proofSentence(proof)}`],
    'The contract is met — do not reopen work that already satisfies it. If new work changes what "done"',
    `means, amend the definition first through \`${DONE_TOOL}\`; amending resets it to "stated", and the new`,
    'contract must be proven on its own terms.',
  ].join('\n')
}

/** One line naming what a proven contract stands on, for the prompt and the command. */
export function proofSentence(proof: DoneProof): string {
  switch (proof.kind) {
    case 'receipt':
      return `the \`${proof.toolName}\` call ${proof.toolCallId} in this session, which did not error`
    case 'countersign':
      return `${proof.reviewer} graded it ${proof.verdict} (countersign ${proof.token})`
    case 'human':
      return 'the person who owns the work attested it directly'
  }
}

/** Render the section body for one session's current contract (or its absence). */
export function guidance(current: DoneProjection): string {
  if (current === null) return ABSENT
  return current.status === 'proven'
    ? provenGuidance(current.statement, current.evidence ?? '', current.proof)
    : statedGuidance(current.statement)
}

/**
 * Normalize one statement: non-empty after trimming, bounded, single-line
 * prose (an embedded newline would break the strip's one-or-two-line promise).
 */
function resolveStatement(value: string): string {
  if (typeof value !== 'string') throw new TypeError('a definition of done needs a statement string')
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  if (collapsed.length === 0) throw new TypeError('a definition of done statement cannot be empty')
  if (collapsed.length > MAX_STATEMENT) {
    throw new TypeError(`a definition of done statement must be at most ${MAX_STATEMENT} characters`)
  }
  return collapsed
}

/** Normalize one evidence citation; a proven contract without one is refused. */
function resolveEvidence(value: string): string {
  if (typeof value !== 'string') throw new TypeError('proving a definition of done needs an evidence string')
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  if (collapsed.length === 0) {
    throw new TypeError('proving a definition of done requires the evidence that met it')
  }
  if (collapsed.length > MAX_EVIDENCE) {
    throw new TypeError(`definition-of-done evidence must be at most ${MAX_EVIDENCE} characters`)
  }
  return collapsed
}

/** Longest reviewer identity and per-criterion evidence line the durable record admits. */
const MAX_REVIEWER = 200
const MAX_SCORE_EVIDENCE = 400
/** Longest reviewer summary the durable record admits — an account, not a report. */
const MAX_SUMMARY = 1200

const reviewVerdictSchema = zod.union([
  zod.literal('PASS'),
  zod.literal('REVISE'),
  zod.literal('REJECT'),
])

const reviewScoreSchema = zod.object({
  criterion: zod.union([
    zod.literal('factual_accuracy'),
    zod.literal('completeness'),
    zod.literal('format_compliance'),
    zod.literal('internal_consistency'),
    zod.literal('edge_case_handling'),
    zod.literal('source_quality'),
  ]),
  score: zod.number().int().min(1).max(5),
  evidence: zod.string().min(1).max(MAX_SCORE_EVIDENCE),
}).strict()

const doneProofSchema = zod.union([
  zod.object({
    kind: zod.literal('receipt'),
    toolCallId: zod.string().min(1).max(200),
    toolName: zod.string().min(1).max(200),
  }).strict(),
  zod.object({
    kind: zod.literal('countersign'),
    token: zod.string().min(1).max(200),
    reviewer: zod.string().min(1).max(MAX_REVIEWER),
    verdict: reviewVerdictSchema,
    scores: zod.array(reviewScoreSchema).min(1).max(12),
    summary: zod.string().min(1).max(MAX_SUMMARY).optional(),
  }).strict(),
  zod.object({ kind: zod.literal('human') }).strict(),
])

const countersignRecordSchema = zod.object({
  token: zod.string().min(1).max(200),
  statement: zod.string().min(1).max(MAX_STATEMENT),
  verdict: reviewVerdictSchema,
  reviewer: zod.string().min(1).max(MAX_REVIEWER),
  scores: zod.array(reviewScoreSchema).min(1).max(12),
  summary: zod.string().min(1).max(MAX_SUMMARY).optional(),
  at: zod.number().int().nonnegative(),
}).strict()

const doneStateSchema: ZodType<DoneState> = zod.object({
  statement: zod.string().min(1).max(MAX_STATEMENT),
  status: zod.union([zod.literal('stated'), zod.literal('proven')]),
  evidence: zod.string().min(1).max(MAX_EVIDENCE).optional(),
  proof: doneProofSchema.optional(),
  at: zod.number().int().nonnegative(),
}).strict().superRefine((state, context) => {
  if (state.status === 'proven' && state.evidence === undefined) {
    context.addIssue({ code: 'custom', message: 'a proven definition of done must carry its evidence' })
  }
  if (state.status === 'stated' && state.evidence !== undefined) {
    context.addIssue({ code: 'custom', message: 'evidence is present exactly when the definition of done is proven' })
  }
  if (state.status === 'proven' && state.proof === undefined) {
    context.addIssue({ code: 'custom', message: 'a proven definition of done must name the proof its evidence stands on' })
  }
  if (state.status === 'stated' && state.proof !== undefined) {
    context.addIssue({ code: 'custom', message: 'a proof is present exactly when the definition of done is proven' })
  }
}) as unknown as ZodType<DoneState>

const doneUnitStateSchema: ZodType<DoneUnitState> = zod.object({
  current: doneStateSchema.nullable(),
}).strict()

/**
 * Canonical tool output: the contract as the model last wrote it. Built inline
 * so the anonymous object type carries the implicit index signature the
 * tool-value type requires.
 */
function toolPayload(current: DoneProjection) {
  return {
    definitionOfDone: current === null ? null : {
      statement: current.statement,
      status: current.status,
      ...current.evidence === undefined ? {} : { evidence: current.evidence },
      ...current.proof === undefined ? {} : { proof: proofSentence(current.proof) },
    },
  }
}

/**
 * Logged per-session definition of done, whole-value replace. `init` is `null`
 * — no contract is stated until one is written — and only a `done/change`
 * event moves it.
 */
export const doneProjectionDefinition = {
  key: 'done',
  // v2: a proven contract carries the `proof` its evidence stands on. A v1
  // snapshot recorded a proof-less `proven`, which this fold no longer admits.
  stateVersion: 2,
  stateSchema: doneUnitStateSchema,
  init: () => ({ current: null }),
  apply: (state, event) => {
    if (event.type !== 'done/change') return state
    return { current: event.data.next }
  },
  wire: {
    viewSchema: doneStateSchema.nullable(),
    view: state => state.current,
  },
} satisfies ProjectionDefinition<'done', DoneUnitState>

/**
 * Resolve one RECEIPT: the id of a tool call this session really made, whose
 * result was not an error.
 *
 * The session log is the authority — not the caller's account of it — so the
 * call is looked up by the id the model cited, and its own recorded result
 * decides. Two cases are refused beyond "no such call": a call that ended in an
 * error (a failed run proves nothing), and a call to one of the contract tools
 * themselves (stating or reviewing a contract is not a run of the work).
 * @param session - the session whose log is searched.
 * @param toolCallId - the call id the model cited.
 * @returns the resolved receipt provenance.
 */
export function resolveReceiptProof(session: Session, toolCallId: string): DoneProof {
  const cited = toolCallId.trim()
  if (cited === '') throw new TypeError('a receipt needs the `tool_call_id` of the call that proved it')
  let name: string | undefined
  for (const event of session.events) {
    if (event.type === 'tool/call' && event.data.callId === cited) name = event.data.name
  }
  if (name === undefined) {
    throw new TypeError(
      `no tool call \`${cited}\` exists in this session, so it cannot prove anything. `
      + `Cite the id of a call you actually made, or get a countersign through \`${REVIEW_TOOL}\`.`,
    )
  }
  if (name === DONE_TOOL || name === REVIEW_TOOL) {
    throw new TypeError(
      `\`${name}\` records the contract; it does not run the work. `
      + 'Cite the run itself — the tests, the build, the smoke check — or a countersign.',
    )
  }
  const result = [...session.events].reverse().find(event =>
    event.type === 'tool/result' && event.data.message.source.callId === cited)
  if (result?.type !== 'tool/result') {
    throw new TypeError(`the call \`${cited}\` has no recorded result yet, so it proves nothing.`)
  }
  if (result.data.message.content[0].isError === true) {
    throw new TypeError(
      `the call \`${cited}\` (\`${name}\`) ended in an error, so it proves nothing. `
      + 'Fix the work, run it again, and cite the run that passed.',
    )
  }
  return { kind: 'receipt', toolCallId: cited, toolName: name }
}

/**
 * Resolve one COUNTERSIGN: a token an independent reviewer minted in this
 * session, for this exact contract, on a PASS.
 *
 * The statement is part of the check, not decoration: a review grades one
 * wording of the contract, so a token stops being a proof the moment the
 * contract is amended.
 * @param session - the session whose log is searched.
 * @param token - the token the model cited.
 * @param statement - the contract statement the token must have graded.
 * @returns the resolved countersign provenance.
 */
export function resolveCountersignProof(session: Session, token: string, statement: string): DoneProof {
  const cited = token.trim()
  if (cited === '') throw new TypeError(`a countersign needs the token \`${REVIEW_TOOL}\` returned`)
  let record: CountersignRecord | undefined
  for (const event of session.events) {
    if (event.type === 'done/countersign' && event.data.record.token === cited) record = event.data.record
  }
  if (record === undefined) {
    throw new TypeError(
      `no review in this session minted the countersign \`${cited}\`. `
      + `Run \`${REVIEW_TOOL}\` and cite the token it returns.`,
    )
  }
  if (record.verdict !== 'PASS') {
    throw new TypeError(
      `that review returned ${record.verdict}, not PASS, so it is not a proof. `
      + 'Address what the reviewer raised and ask for a fresh review.',
    )
  }
  if (record.statement !== statement) {
    throw new TypeError(
      'that countersign graded a different definition of done, so it does not cover this one. '
      + `The reviewer read: "${record.statement}".`,
    )
  }
  return {
    kind: 'countersign',
    token: record.token,
    reviewer: record.reviewer,
    verdict: record.verdict,
    scores: record.scores,
    ...record.summary === undefined ? {} : { summary: record.summary },
  }
}

/** What a reviewer supplies when recording its verdict; the token and timestamp are minted here. */
export type CountersignInput = Omit<CountersignRecord, 'token' | 'at'>

/**
 * Record one independent review in the session log and mint its token.
 *
 * Every verdict is recorded, not just the passing ones: a REVISE that left no
 * trace would let a session quietly re-roll reviews until one passed. Only a
 * PASS token resolves as a proof ({@link resolveCountersignProof}).
 * @param session - the session the review belongs to.
 * @param input - the reviewer identity, verdict, rubric and summary.
 * @returns the durable record, including the minted token.
 */
export function mintCountersign(session: Session, input: CountersignInput): CountersignRecord {
  const record: CountersignRecord = {
    token: `${COUNTERSIGN_PREFIX}${randomUUID()}`,
    statement: resolveStatement(input.statement),
    verdict: input.verdict,
    reviewer: input.reviewer.trim(),
    scores: input.scores,
    ...input.summary === undefined ? {} : { summary: input.summary },
    at: Date.now(),
  }
  const checked = countersignRecordSchema.safeParse(record)
  if (!checked.success) {
    throw new TypeError(
      `a countersign record must carry a reviewer, a verdict and its rubric: ${checked.error.message}`,
    )
  }
  session.append('done/countersign', { record })
  return record
}

/** Services this plugin needs; the command registry and the tool registry attach optionally below. */
export const inject = ['sessionProjections', 'systemPrompt']

const USAGE = 'Usage: /done [<statement>|edit <statement>|prove <evidence>|clear]'
  + '\nPrefix a statement with "-- " to keep it literal when it begins with one of those words.'

/** Render the human-facing view without exposing fold internals. */
function renderDone(title: string, current: DoneProjection): string {
  if (current === null) return title
  const evidence = current.status === 'proven' ? [`Evidence: ${current.evidence ?? ''}`] : []
  const proof = current.proof === undefined ? [] : [`Proof: ${proofSentence(current.proof)}`]
  return [
    title,
    `Status: ${current.status}`,
    `Statement: ${current.statement}`,
    ...evidence,
    ...proof,
    '',
    `Commands: ${current.status === 'proven'
      ? '/done <statement>, /done clear'
      : '/done prove <evidence>, /done <statement>, /done clear'}`,
  ].join('\n')
}

/**
 * Mount the definition of done: the projection unit, the `done:policy`
 * section, the `/done` command, and the `set_definition_of_done` tool.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  /** The session's durable contract, or null while none is stated. */
  const currentOf = (session: Session): DoneProjection => (
    ctx.sessionProjections.stateOf(session, 'done')?.current ?? null
  )

  /**
   * Commit one whole-value replacement. The timestamp never moves backwards
   * across wall-clock adjustment, so a replayed log keeps a monotonic `at`.
   */
  const commit = (session: Session, next: DoneState | null): DoneProjection => {
    const previous = currentOf(session)
    const at = Math.max(Date.now(), previous?.at ?? 0)
    const value = next === null ? null : { ...next, at }
    session.append('done/change', { next: value })
    return value
  }

  /** State (or re-state) the contract; a changed statement is never still proven. */
  const state = (session: Session, statement: string): DoneProjection =>
    commit(session, { statement: resolveStatement(statement), status: 'stated', at: 0 })

  /** Prove the current contract with its evidence, or fail loudly if none is stated. */
  const prove = (session: Session, evidence: string, proof: DoneProof): DoneProjection => {
    const current = currentOf(session)
    if (current === null) {
      throw new TypeError('there is no definition of done to prove; state one first')
    }
    return commit(session, {
      statement: current.statement,
      status: 'proven',
      evidence: resolveEvidence(evidence),
      proof,
      at: 0,
    })
  }

  ctx.systemPrompt.section({
    name: DONE_SECTION,
    // Right after the multi-task policy: both are standing collaboration law.
    order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') + 12,
    text: (context) => {
      if (context.agent === undefined) return ''
      return guidance(currentOf(context.agent.session))
    },
  })

  ctx.sessionProjections.register(doneProjectionDefinition)

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'done',
      description: 'state, prove, or clear this session\'s definition of done',
      input: { hint: '[<statement>|prove <evidence>|clear]' },
      handler: (invocation: CommandInvocation): CommandResult => {
        const input = invocation.rawInput.trim()
        const control = input.toLowerCase()
        const session = invocation.agent.session
        const current = currentOf(session)
        try {
          if (input.length === 0) {
            return current === null
              ? { kind: 'success', text: `No definition of done is set.\n${USAGE}` }
              : { kind: 'success', text: renderDone('Definition of done', current) }
          }
          // `--` escapes the control words: everything after it is the statement
          // itself, so a wording may open with "clear", "prove", or "edit" — the
          // display component always writes through this form.
          if (input.startsWith('-- ')) {
            const literal = input.slice(3).trim()
            if (literal === '') return { kind: 'error', text: `A statement is required.\n${USAGE}` }
            return {
              kind: 'success',
              text: renderDone(current === null ? 'Definition of done set' : 'Definition of done amended', state(session, literal)),
            }
          }
          if (control === 'clear') {
            if (current === null) return { kind: 'success', text: 'No definition of done to clear.' }
            commit(session, null)
            return { kind: 'success', text: 'Definition of done cleared.' }
          }
          if (control === 'prove') {
            return { kind: 'error', text: `Proving needs the evidence that met it.\n${USAGE}` }
          }
          if (/^prove(?=\s)/iu.test(input)) {
            // The person owning the work is the principal, not a worker grading
            // itself: their attestation is admitted, and recorded as human.
            return {
              kind: 'success',
              text: renderDone(
                'Definition of done proven',
                prove(session, input.slice(5).trim(), { kind: 'human' }),
              ),
            }
          }
          if (control === 'edit') {
            return { kind: 'error', text: `Amending needs a replacement statement.\n${USAGE}` }
          }
          const statement = /^edit(?=\s)/iu.test(input) ? input.slice(4).trim() : input
          return {
            kind: 'success',
            text: renderDone(current === null ? 'Definition of done set' : 'Definition of done amended', state(session, statement)),
          }
        } catch (error: unknown) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  })

  // The tool child activates only when a tool registry is composed; without it
  // the model still reads the section, it simply cannot author the contract.
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: DONE_TOOL,
      description: 'Record this session\'s definition of done: the one- or two-sentence contract for what is being '
        + 'built and how we will know it is finished. action "state" sets or amends the statement (amending always '
        + 'returns it to unproven). action "prove" marks the current contract met; it REQUIRES the one-line evidence '
        + 'that met it AND a proof that evidence can be checked against — either `receipt`, the tool_call_id of a '
        + 'call you made in this session whose result was not an error (the test run, the build, the smoke check), '
        + `or \`countersign\`, the token \`${REVIEW_TOOL}\` returns once an independent reviewer grades the work `
        + 'PASS. Your own account of the work is not accepted as proof: if you have not run it and it has not been '
        + 'reviewed, leave the contract stated. action "clear" removes it. Keep the statement to a single confident '
        + 'thought, not a task list.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['state', 'prove', 'clear'],
          description: 'state | prove | clear',
        },
        statement: {
          type: 'string',
          description: 'The one- or two-sentence definition of done; required with action state.',
        },
        evidence: {
          type: 'string',
          description: 'One line: what you ran and what it showed; required with action prove.',
        },
        receipt: {
          type: 'object',
          additionalProperties: false,
          description: 'Proof by run: the call you made whose result proves the contract. Use with action prove.',
          properties: {
            tool_call_id: {
              type: 'string',
              required: true,
              description: 'The id of that tool call in this session; its result must not be an error.',
            },
          },
        },
        countersign: {
          type: 'string',
          description: `Proof by review: the token \`${REVIEW_TOOL}\` returned on PASS. Use with action prove.`,
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new TypeError(`${DONE_TOOL} requires a calling agent`)
        const session = agent.session
        if (args.action === 'clear') {
          return Promise.resolve(toolPayload(commit(session, null)))
        }
        if (args.action === 'prove') {
          if (args.evidence === undefined) {
            throw new TypeError('proving a definition of done requires the evidence that met it')
          }
          const receipt = args.receipt?.tool_call_id
          const countersign = args.countersign
          if (receipt === undefined && countersign === undefined) throw new TypeError(PROOF_REFUSAL)
          if (receipt !== undefined && countersign !== undefined) {
            throw new TypeError('cite ONE proof: either the receipt of the run, or the reviewer\'s countersign.')
          }
          const current = currentOf(session)
          if (current === null) {
            throw new TypeError('there is no definition of done to prove; state one first')
          }
          const proof = receipt === undefined
            ? resolveCountersignProof(session, countersign ?? '', current.statement)
            : resolveReceiptProof(session, receipt)
          return Promise.resolve(toolPayload(prove(session, args.evidence, proof)))
        }
        if (args.statement === undefined) {
          throw new TypeError('stating a definition of done requires the statement')
        }
        return Promise.resolve(toolPayload(state(session, args.statement)))
      },
      presentCall: (args): GenericCallView => ({
        card: 'generic',
        title: args.action === 'prove'
          ? 'Prove definition of done'
          : args.action === 'clear' ? 'Clear definition of done' : 'State definition of done',
        kind: args.action === 'prove' ? 'read' : 'other',
        ...args.action === 'state' && args.statement !== undefined ? { rawInput: args.statement } : {},
      }),
    }))
  })
}
