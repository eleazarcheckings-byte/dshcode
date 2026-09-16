/**
 * The Gates: the policy layer that decides, before a tool runs, whether its
 * consequence is one a human has to own. Credentials, money, anything that
 * becomes public, anything that reaches a real person, an identity change, and
 * the handful of effects nothing can undo stop here and reach the user;
 * everything else is delegated onward untouched, which is what lets a session
 * hold full file and shell access without the dangerous acts riding along.
 *
 * The policy is data (see `./roster.ts`), the classification is pure (see
 * `./policy.ts`), and this module is the only part that touches the runtime:
 * one `tools/pre-execute` listener that turns a classification into a
 * {@link PreToolDecision} the tool registry already knows how to honour.
 * @module @saturnai/dsh-gates
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
// The approval seam is consumed opportunistically through `ctx.get`; this
// type-only import brings its Context augmentation without a runtime edge.
import type {} from '@deepseek-ai/dsh-user-approval'
import { carriesSandboxEscalation, classify, compilePolicy, Config } from './policy.ts'
import type { CompiledPolicy } from './policy.ts'
import type { GateMatch } from './types.ts'

export const name = 'saturn-gates'
// The registry owns the waterfall this plugin listens on; mounting without it
// would arm a policy nothing consults.
export const inject = ['tools']

// The plugin surface a deployment consumes: the validated config, and the
// vocabulary a config author needs to write one rule.
export { Config } from './policy.ts'
export type { GateAction, GateClass, GateRule } from './types.ts'

/** The opening every reason shares, so one line tells the model which rule spoke. */
function header(match: GateMatch): string {
  return `Gate: ${match.class} — ${match.reason} (rule ${match.ruleId})`
}

/** What the model reads when the call is going to the user for a decision. */
function askReason(match: GateMatch): string {
  return `${header(match)} The user decides this one before it runs.`
}

/** What the model reads when the class is one no in-session approval can buy. */
function denyReason(match: GateMatch): string {
  return `${header(match)} This one is not available from inside a session and there is no way around it: if the user wants it, they run it themselves.`
}

/**
 * What the model reads when the deployment answers every approval with a
 * rejection. Naming the exact setting matters: without it the model reports a
 * refusal the user never made and has no way to trace.
 */
function policyDisabledReason(match: GateMatch): string {
  return `${header(match)} This one needs the user's approval, but approval prompts are disabled by the danger-full-access preset, which rejects every request automatically. Tell the user to switch permission.defaultPreset to full-access-gated, then try again.`
}

/** What the model reads when nothing in this deployment can carry a question to a human. */
function noChannelReason(match: GateMatch): string {
  return `${header(match)} This one needs the user's approval and this session has no approval channel, so it cannot run here.`
}

/**
 * The approval policy this call would resolve under: the session's own
 * override if it set one, otherwise the deployment default. Read BEFORE
 * asking, because an ask under `never` is answered `rejected` without anyone
 * seeing it — the model would be told the user refused something the user was
 * never shown.
 * @param ctx - the plugin context whose approval seam is consulted.
 * @param exec - the pending call, whose agent owns the session being read.
 * @returns the effective policy, or `undefined` when there is no seam or no session to read.
 */
function effectiveApprovalPolicy(ctx: Context, exec: ToolExecution): 'ask' | 'never' | undefined {
  const approval = ctx.get('approval')
  if (approval === undefined) return undefined
  const session = exec.agent?.session
  if (session === undefined) return 'ask'
  return approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}

/**
 * Decide one classified call.
 *
 * A `deny` class answers immediately and asks nobody. Otherwise the call is
 * routed to the user as an `ask`, which the tool registry resolves through the
 * approval seam — this plugin never calls that seam itself, so one call
 * produces one question. The two closed paths (no seam, policy `never`) become
 * denials that say which one happened instead of a bare refusal.
 * @param ctx - the plugin context whose approval seam is consulted.
 * @param exec - the pending call.
 * @param match - the rule that claimed it.
 * @returns the decision handed back to the tool registry.
 */
function decide(ctx: Context, exec: ToolExecution, match: GateMatch): PreToolDecision {
  if (match.action === 'deny') return { kind: 'deny', reason: denyReason(match) }
  const policy = effectiveApprovalPolicy(ctx, exec)
  if (policy === undefined) return { kind: 'deny', reason: noChannelReason(match) }
  if (policy === 'never') return { kind: 'deny', reason: policyDisabledReason(match) }
  return { kind: 'ask', reason: askReason(match) }
}

/**
 * Attach the Gate to the tool waterfall.
 *
 * Composition rules this listener keeps, both load-bearing:
 *
 * 1. A call nothing claims is DELEGATED with `next()`, so every other listener
 *    on the waterfall still governs it. The Gate narrows nothing it does not
 *    claim.
 * 2. A claimed call is answered WITHOUT delegating. The Gate is mounted ahead
 *    of the Claude Code hook bridge deliberately, and a claimed call is
 *    already going to a human; letting a later listener raise a second
 *    decision for the same call would put two questions in front of the user
 *    for one action.
 * 3. A shell call that already carries its own `sandbox_permissions`
 *    escalation is delegated even when a rule claims it, because that call's
 *    own body resolves one approval before it executes anything. Abstaining
 *    keeps the count at one question — and nothing runs unapproved either way,
 *    since an escalating call that is refused, unanswerable, or agent-less
 *    fails before the command runs. A `deny` class is decided before this,
 *    so an escalation request can never buy a pass.
 * @param ctx - plugin context; the listener is scoped to it and disposed with it.
 * @param config - validated {@link Config}; a rule it cannot compile fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const policy: CompiledPolicy = compilePolicy(config)

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const match = classify(policy, exec)
    if (match === undefined) return next()
    if (match.action !== 'deny' && policy.deferToSandboxEscalation && carriesSandboxEscalation(policy, exec)) {
      // The one path where the Gate claims a call and says nothing to the
      // human: the escalation's own prompt is the single question, and it
      // names the sandbox change rather than this class. Logged so the class
      // is at least on the record for whoever reads the trail afterwards.
      ctx.logger.info(`gate ${match.class}: deferred to the call's own sandbox escalation "${exec.name}" (rule ${match.ruleId})`)
      return next()
    }
    const decision = decide(ctx, exec, match)
    ctx.logger.info(`gate ${match.class}: ${decision.kind} "${exec.name}" (rule ${match.ruleId})`)
    return decision
  })
}
