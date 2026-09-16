/**
 * Independent review, host half: the one mechanism that keeps "done" from being
 * a thing the worker says about itself.
 *
 * `review_definition_of_done` takes the session's stated contract and the
 * worker's claim about it, and hands both to a FRESH agent — its own session,
 * its own system prompt, none of the caller's conversation or reasoning —
 * wearing the adversarial-reviewer persona. That agent grades the work against
 * the fixed rubric, answers in a schema the seam validates before this package
 * sees it, and returns a verdict with its reasons. On PASS, and only on PASS,
 * the review mints a countersign token into the session log; `prove` accepts
 * that token (and refuses everything the reviewer did not pass).
 *
 * Three properties make this a gate rather than a ritual:
 *
 * - the reviewer must be a provider that does NOT seed the child with the
 *   parent's conversation — a forked reviewer would inherit exactly the
 *   reasoning it is supposed to be independent of, and is refused at the call;
 * - the reviewer cannot touch the contract it grades: the contract tools are
 *   denied in its scope, so it can neither prove the thing nor order its own
 *   review;
 * - every verdict is recorded, not only the passing ones, so a session cannot
 *   quietly re-roll reviews until one comes back green.
 *
 * @module @saturnai/dsh-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRestriction } from '@deepseek-ai/dsh-tools'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the session-projection Context merge (ctx.sessionProjections).
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentProvider, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { DONE_TOOL, mintCountersign } from '@saturnai/dsh-done'
// Type-only: pulls the `done` SessionProjectionMap merge this tool reads.
import type {} from '@saturnai/dsh-done'
import { parseVerdict, REVIEW_CRITERIA, REVIEW_OUTPUT_SCHEMA } from './rubric.ts'
import { REVIEWER_PERSONA, reviewPrompt } from './prompt.ts'


export { CRITERION_QUESTIONS, parseVerdict, REVIEW_CRITERIA, REVIEW_OUTPUT_SCHEMA } from './rubric.ts'
export { REVIEWER_PERSONA, reviewPrompt } from './prompt.ts'
export type { ReviewBrief } from './prompt.ts'
export type { ReviewAnswer, ReviewToolResult } from './types.ts'

/** Model tool name. The contract's refusal text names it, so the spelling is load-bearing. */
export const REVIEW_TOOL = 'review_definition_of_done'

/** How the reviewer identifies itself in the record a reader later sees. */
export const REVIEWER_NAME = 'Mars — adversarial reviewer'

/** The reviewer's own model route, when the deployment pins one. */
export interface ReviewerAgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
  /** Adapter-owned reasoning effort for that route. */
  reasoningEffort: ReturnType<typeof ReasoningEffortId>
}

/** Deployment-owned configuration of the reviewer. */
export interface Config {
  /**
   * Which `ctx.subagents` provider runs the reviewer. It must be one that gives
   * the child a fresh conversation; a context-inheriting provider is refused at
   * the call rather than silently producing a compromised review.
   */
  provider?: string
  /**
   * Model route for the reviewer, when it should differ from the caller's own.
   * A different model is the strongest form of independence this seam can buy:
   * the reviewer then shares neither the context nor the failure modes.
   */
  agentOptions?: ReviewerAgentOptions
  /** Extra tools the reviewer may not use, beyond the contract tools it never gets. */
  denyTools?: string[]
  /** Absolute delegation-depth cap for the reviewer child. */
  maxDepth?: number
}

export const Config: z<Config> = z.object({
  provider: z.string().default('spawn'),
  // Preserve omission: Schemastery's materialized `{}` would look like a
  // pinned-but-empty route rather than "follow the caller's model".
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
  }).default(undefined as unknown as ReviewerAgentOptions),
  denyTools: z.array(z.string()).default([]),
  maxDepth: z.natural().max(Number.MAX_SAFE_INTEGER).default(undefined as unknown as number),
})

/** Services this plugin needs: the delegation seam, the tool registry, and the contract projection. */
export const inject = ['subagents', 'tools', 'sessionProjections']

/**
 * Collect one reviewer run and release it, without letting disposal replace an
 * independent failure.
 * @param run - the published reviewer run.
 * @returns the structured answer the child committed.
 */
async function settleReview(run: SubagentRun): Promise<unknown> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): unknown => {
      if (result.stopReason !== 'completed') {
        throw new Error(
          `the review did not finish (${result.stopReason})`
          + (result.diagnostic === undefined ? '' : `: ${result.diagnostic}`),
        )
      }
      if (result.structured === undefined) {
        throw new Error('the review ended without recording a verdict, so nothing was graded')
      }
      return result.structured
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `the review failed: ${String(execution.reason)}; releasing it also failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * The tools the reviewer is not given: the contract tools, so it cannot prove
 * the thing it is grading or order a review of its own, plus whatever the
 * deployment adds. Names that no registry knows are dropped, because a scoped
 * restriction validates the names it is handed.
 * @param ctx - the runtime context whose registry is consulted.
 * @param extra - deployment-configured additions.
 * @returns the restriction, or undefined when nothing to deny is registered.
 */
function reviewerToolFilter(ctx: Context, extra: readonly string[]): ToolRestriction | undefined {
  const deny = [DONE_TOOL, REVIEW_TOOL, ...extra].filter(name => ctx.tools.get(name) !== undefined)
  return deny.length === 0 ? undefined : { deny }
}

/**
 * Mount independent review: the `review_definition_of_done` tool over the
 * delegation seam and the session's definition of done.
 * @param ctx - host root context.
 * @param config - deployment configuration of the reviewer.
 */
export function apply(ctx: Context, config: Config): void {
  const providerName = config.provider ?? 'spawn'

  ctx.tools.register(defineTool({
    name: REVIEW_TOOL,
    description: 'Put this session\'s definition of done up for independent review. A reviewer that did not do '
      + 'the work — a fresh agent with none of your context — reads the contract and your claim about it, grades '
      + 'it on ' + REVIEW_CRITERIA.join(', ') + ', and returns a verdict of PASS, REVISE or REJECT with its '
      + 'reasons. On PASS it returns a countersign token, which is what `' + DONE_TOOL + '` accepts as proof. '
      + 'Use it when the work is finished and you want it closed: state your claim plainly, including what you '
      + 'ran, and let the review decide. A REVISE or REJECT comes back with what to fix.',
    parameters: {
      claim: {
        type: 'string',
        required: true,
        description: 'What you built and what you ran, in your own words. The reviewer sees only this and the '
          + 'contract, so leave nothing load-bearing out — and claim nothing you did not do.',
      },
      scope: {
        type: 'string',
        description: 'Optional: the files, commands, or outputs worth checking first.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    // A review reads the work; it never writes to the caller's session beyond
    // its own append-only record.
    isConcurrencySafe: () => true,
    // The canonical value is built inline so the anonymous object type carries
    // the implicit index signature the tool-value type requires; its named
    // shape is `ReviewToolResult`.
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new TypeError(`${REVIEW_TOOL} requires a calling agent`)
      const session = agent.session
      const contract = ctx.sessionProjections.stateOf(session, 'done')?.current ?? null
      if (contract === null) {
        throw new TypeError(
          'this session has no definition of done, so there is nothing to review. '
          + `State the contract with \`${DONE_TOOL}\` first.`,
        )
      }
      const provider: SubagentProvider | undefined = ctx.subagents.getProvider(providerName)
      if (provider === undefined) {
        throw new Error(`no subagent provider named "${providerName}" is available, so no reviewer can be run`)
      }
      if (provider.inheritsParentContext) {
        throw new Error(
          `the reviewer must start fresh, and the "${providerName}" provider seeds the child with this `
          + 'conversation — it would inherit the very reasoning it is meant to judge. Configure this plugin '
          + 'with a provider that gives the child its own conversation.',
        )
      }
      const prompt: ContentBlock[] = [{
        type: 'text',
        text: reviewPrompt({
          statement: contract.statement,
          claim: args.claim,
          ...args.scope === undefined ? {} : { scope: args.scope },
        }),
      }]
      const toolFilter = reviewerToolFilter(ctx, config.denyTools ?? [])
      const run = await ctx.subagents.start(providerName, {
        label: 'Review definition of done',
        prompt,
        parent: agent,
        persona: REVIEWER_PERSONA,
        outputSchema: REVIEW_OUTPUT_SCHEMA,
        signal: exec.signal,
        ...config.agentOptions === undefined ? {} : { agentOptions: config.agentOptions },
        ...toolFilter === undefined ? {} : { toolFilter },
        ...config.maxDepth === undefined ? {} : { maxDepth: config.maxDepth },
      })
      const answer = parseVerdict(await settleReview(run))
      const reviewer = `${REVIEWER_NAME} (${providerName})`
      // Every verdict is recorded: a REVISE that left no trace would let a
      // session re-roll reviews until one passed.
      const record = mintCountersign(session, {
        statement: contract.statement,
        verdict: answer.verdict,
        reviewer,
        scores: answer.scores,
        summary: answer.summary,
      })
      return {
        verdict: answer.verdict,
        summary: answer.summary,
        scores: answer.scores.map(score => ({
          criterion: score.criterion,
          score: score.score,
          evidence: score.evidence,
        })),
        reviewer,
        ...answer.verdict === 'PASS' ? { countersign: record.token } : {},
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: 'Independent review',
      kind: 'read',
      rawInput: args.claim,
    }),
  }))
}
