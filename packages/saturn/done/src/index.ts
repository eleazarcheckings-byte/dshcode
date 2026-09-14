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
 * @module @saturnai/dsh-done
 */

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
import type { DoneProjection, DoneState, DoneUnitState } from './types.ts'

export type { DoneProjection, DoneState, DoneStatus, DoneUnitState } from './types.ts'

/** Section name; also the anchor a deployment reads in a prompt dump. */
export const DONE_SECTION = 'done:policy'

/** Model tool name; the section names it, so both live here together. */
export const DONE_TOOL = 'set_definition_of_done'

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
    'the smoke check, the command itself — and cite what you ran and what it showed. Only then set status',
    `"proven" with a one-line \`evidence\` citation through \`${DONE_TOOL}\`. Missing evidence is NOT_ASSESSED`,
    'and never counts as green: if you cannot prove it, say so plainly and leave it stated.',
  ].join('\n')
}

/**
 * Doctrine the section carries once the contract is proven: the standing law
 * that settled work is not reopened, and that a changed contract loses its
 * proof.
 */
export function provenGuidance(statement: string, evidence: string): string {
  return [
    'Definition of done (PROVEN):',
    `"${statement}"`,
    `Evidence: ${evidence}`,
    'The contract is met — do not reopen work that already satisfies it. If new work changes what "done"',
    `means, amend the definition first through \`${DONE_TOOL}\`; amending resets it to "stated", and the new`,
    'contract must be proven on its own terms.',
  ].join('\n')
}

/** Render the section body for one session's current contract (or its absence). */
export function guidance(current: DoneProjection): string {
  if (current === null) return ABSENT
  return current.status === 'proven'
    ? provenGuidance(current.statement, current.evidence ?? '')
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

const doneStateSchema: ZodType<DoneState> = zod.object({
  statement: zod.string().min(1).max(MAX_STATEMENT),
  status: zod.union([zod.literal('stated'), zod.literal('proven')]),
  evidence: zod.string().min(1).max(MAX_EVIDENCE).optional(),
  at: zod.number().int().nonnegative(),
}).strict().superRefine((state, context) => {
  if (state.status === 'proven' && state.evidence === undefined) {
    context.addIssue({ code: 'custom', message: 'a proven definition of done must carry its evidence' })
  }
  if (state.status === 'stated' && state.evidence !== undefined) {
    context.addIssue({ code: 'custom', message: 'evidence is present exactly when the definition of done is proven' })
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
  stateVersion: 1,
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

/** Services this plugin needs; the command registry and the tool registry attach optionally below. */
export const inject = ['sessionProjections', 'systemPrompt']

const USAGE = 'Usage: /done [<statement>|edit <statement>|prove <evidence>|clear]'
  + '\nPrefix a statement with "-- " to keep it literal when it begins with one of those words.'

/** Render the human-facing view without exposing fold internals. */
function renderDone(title: string, current: DoneProjection): string {
  if (current === null) return title
  const evidence = current.status === 'proven' ? [`Evidence: ${current.evidence ?? ''}`] : []
  return [
    title,
    `Status: ${current.status}`,
    `Statement: ${current.statement}`,
    ...evidence,
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
  const prove = (session: Session, evidence: string): DoneProjection => {
    const current = currentOf(session)
    if (current === null) {
      throw new TypeError('there is no definition of done to prove; state one first')
    }
    return commit(session, { statement: current.statement, status: 'proven', evidence: resolveEvidence(evidence), at: 0 })
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
            return { kind: 'success', text: renderDone('Definition of done proven', prove(session, input.slice(5).trim())) }
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
        + 'returns it to unproven). action "prove" marks the current contract met and REQUIRES the one-line evidence '
        + 'that met it — the command you ran and what it showed; if you have not actually run the thing, leave it '
        + 'stated rather than claiming proof. action "clear" removes it. Keep the statement to a single confident '
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
          return Promise.resolve(toolPayload(prove(session, args.evidence)))
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
