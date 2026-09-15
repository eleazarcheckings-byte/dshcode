/**
 * Multi-task (always-orchestrate) mode, host half. The per-session switch behind
 * the composer's multi-task toggle, and the ONE deployment-owned lever the
 * toggle actually moves.
 *
 * The `orchestrate` projection folds the session log, so resume and fork restore
 * the state: `init` is **active**, matching the standing posture of this harness
 * (`~/.dsh/SATURN-HARNESS-ADDENDUM.md` — always orchestrate), and only an
 * `orchestrate/mode` event turns it off. A user selection made while a turn is
 * open stays pending until the next accepted in-turn pre-step, so the logged
 * state never changes under an in-flight request; the `orchestrate:policy`
 * section reads the pending-or-logged value, exactly the plan-mode shape.
 *
 * Off does not unregister the delegation tools — it changes the guidance the
 * next request reads (and the request tool catalog stays stable, per the
 * plan-mode cache rule). The off text is an explicit session-level override of
 * the standing posture, which is the honest lever: the posture itself lives in
 * the user-global AGENTS.md, which no plugin can retract.
 *
 * @module @saturnai/dsh-orchestrate
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only: pulls the commands Context merge (ctx.commands).
import type {} from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { OrchestrateUnitState } from './types.ts'

export type { OrchestrateProjection, OrchestrateUnitState } from './types.ts'

/** Section name; also the anchor a deployment reads in a prompt dump. */
export const ORCHESTRATE_SECTION = 'orchestrate:policy'

/** Deployment-owned copy. Both strings are required to be non-empty. */
export interface OrchestrateModeConfig {
  /** Rendered as the `orchestrate:policy` section while multi-task mode is on. */
  on?: string
  /** Rendered while multi-task mode is off: the straight-thread override. */
  off?: string
}

const DEFAULT_ON = [
  'Multi-task mode is ON for this session. Coordinate substantial work across independent specialists',
  'while making useful progress yourself. When spawn_teammate is available, use named teammates',
  'for work that needs shared tasks, peer messages, or follow-up. Use one-shot subagents for bounded',
  'work with no continuing coordination. Give each delegation a concrete deliverable, relevant',
  'context, disjoint write scopes, and verification requirements. Acquire file claims when available.',
  'Check progress, unblock dependencies, review the combined result, and wait for required teammates',
  'before the final response. Keep trivial reads, direct edits, and tightly dependent work in the',
  'main thread. Parallel work should reduce the time to a verified result.',
].join('\n')

const DEFAULT_OFF = [
  'Multi-task mode is OFF for this session — the user asked for a single straight thread.',
  'Work with your own tools: read, edit, run, and verify yourself, and state the plan inline instead',
  'of routing it. Do not fan out to subagents and do not start background hands in this session',
  'unless the user asks for exactly that in a message. This session-level instruction overrides the',
  'standing always-orchestrate posture.',
].join('\n')

/**
 * Validate deployment config and fill the defaults.
 * @param config - raw plugin config.
 * @returns a detached, validated config.
 */
export function resolveConfig(config: OrchestrateModeConfig = {}): Required<OrchestrateModeConfig> {
  const unknown = Object.keys(config).filter(key => key !== 'on' && key !== 'off')
  if (unknown.length > 0) {
    throw new Error(`OrchestrateModeConfig has unknown key(s) ${unknown.join(', ')} — config is { on, off }`)
  }
  const on = config.on ?? DEFAULT_ON
  const off = config.off ?? DEFAULT_OFF
  for (const [name, value] of [['on', on], ['off', off]] as const) {
    if (typeof value !== 'string') throw new Error(`OrchestrateModeConfig needs a string \`${name}\``)
    if (value.trim() === '') throw new Error(`OrchestrateModeConfig needs a non-empty \`${name}\``)
  }
  return { on, off }
}

const orchestrateUnitStateSchema: ZodType<OrchestrateUnitState> = zod.object({
  active: zod.boolean(),
  activeAtLastHeader: zod.boolean().nullable(),
}).strict()

/** Wire payload schema of the `orchestrate` projection. */
const orchestrateProjectionSchema: ZodType<{ active: boolean; pending: boolean }> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Logged per-session multi-task state; active on the empty log. */
export const orchestrateProjectionDefinition = {
  key: 'orchestrate',
  stateVersion: 1,
  stateSchema: orchestrateUnitStateSchema,
  // The standing posture: orchestrated unless a log says otherwise.
  init: () => ({ active: true, activeAtLastHeader: null }),
  apply: (state, event) => {
    if (event.type === 'orchestrate/mode') return { ...state, active: event.data.active }
    if (event.type === 'request/header') return { ...state, activeAtLastHeader: state.active }
    return state
  },
  wire: {
    viewSchema: orchestrateProjectionSchema,
    view: (state) => {
      const pending = state.activeAtLastHeader !== null && state.activeAtLastHeader !== state.active
      return { active: state.active, pending }
    },
  },
} satisfies ProjectionDefinition<'orchestrate', OrchestrateUnitState>

/** Turn-boundary state, owned by the agent loop; absent when that row is not composed. */
interface TurnBoundaryState {
  openTurnStartSeq: number | null
}

/** What a toggle request did to the logged state. */
export type OrchestrateSetResult = 'committed' | 'queued' | 'noop'

/** Services this plugin needs; the commands registry is optional and injected below. */
export const inject = ['sessionProjections', 'systemPrompt']

/**
 * Mount logged multi-task mode: the projection unit, the `orchestrate:policy`
 * section, and the `/orchestrate` command.
 * @param ctx - host root context.
 * @param config - deployment copy for both section bodies.
 */
export function apply(ctx: Context, config: OrchestrateModeConfig = {}): void {
  const guidance = resolveConfig(config)

  /** Latest selection per session awaiting the next accepted in-turn pre-step. */
  const pendingIntents = new WeakMap<Session, boolean>()

  const stateOf = (session: Session): OrchestrateUnitState => {
    const state = ctx.sessionProjections.stateOf(session, 'orchestrate')
    if (state === undefined) throw new Error('orchestrate: the orchestrate session projection is not registered')
    return state
  }

  /** Read the turn boundary through an erased key: an uncomposed row reads undefined, never throws. */
  const turnBoundaryOf = (session: Session): TurnBoundaryState | undefined => (
    ctx.sessionProjections.stateOf.bind(ctx.sessionProjections) as unknown as (
      session: Session,
      key: string,
    ) => unknown
  )(session, 'turnBoundary') as TurnBoundaryState | undefined

  const loggedActive = (session: Session): boolean => stateOf(session).active

  /** The effective target: a queued selection wins over the logged state. */
  const targetOf = (session: Session): boolean => pendingIntents.get(session) ?? loggedActive(session)

  /**
   * Apply a selection: immediately when no turn is open, otherwise queued for
   * the next accepted pre-step so an in-flight request keeps its policy.
   */
  const set = (agent: Agent, active: boolean): OrchestrateSetResult => {
    const session = agent.session
    if (active === targetOf(session)) {
      pendingIntents.delete(session)
      return 'noop'
    }
    const boundary = turnBoundaryOf(session)
    if (boundary !== undefined && boundary.openTurnStartSeq !== null) {
      pendingIntents.set(session, active)
      return 'queued'
    }
    session.append('orchestrate/mode', { active })
    pendingIntents.delete(session)
    return 'committed'
  }

  // Pre-step is outside Session.append publication, so it can append the
  // log-only mode event inside an open turn without re-entering the session.
  // A failed append stays pending for a later accepted in-turn pre-step, and
  // policy can never block the step.
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    const wanted = pendingIntents.get(agent.session)
    if (decision.kind === 'reject' || signal.aborted || wanted === undefined) return decision
    if (wanted !== loggedActive(agent.session)) {
      try {
        agent.session.append('orchestrate/mode', { active: wanted })
      } catch (error) {
        ctx.logger.warn('dsh-orchestrate: failed to append multi-task mode at step start: %o', error)
        return decision
      }
    }
    pendingIntents.delete(agent.session)
    return decision
  })

  ctx.systemPrompt.section({
    name: ORCHESTRATE_SECTION,
    // Right after the plan policy: both are collaboration-stance guidance.
    order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') + 10,
    text: (context) => {
      if (context.agent === undefined) return ''
      return targetOf(context.agent.session) ? guidance.on : guidance.off
    },
  })

  ctx.sessionProjections.register(orchestrateProjectionDefinition)

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'orchestrate',
      description: 'Turn multi-task (always-orchestrate) mode on or off for this session',
      input: { hint: '[on|off]' },
      handler: ({ agent, rawInput }) => {
        const argument = rawInput.trim().toLowerCase()
        if (argument !== '' && argument !== 'on' && argument !== 'off') {
          return { kind: 'error', text: 'Usage: /orchestrate [on|off]' }
        }
        const target = argument === '' ? !targetOf(agent.session) : argument === 'on'
        const label = target ? 'Multi-task on.' : 'Multi-task off.'
        switch (set(agent, target)) {
          case 'committed':
            return { kind: 'success', text: label }
          case 'queued':
            return {
              kind: 'success',
              text: `${label.replace(/\.$/, '')} (applies from the next step).`,
            }
          case 'noop':
            return { kind: 'success', text: target ? 'Multi-task already on.' : 'Multi-task already off.' }
        }
      },
    })
  })
}
