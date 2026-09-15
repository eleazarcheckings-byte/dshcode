/**
 * The multi-task policy the Lead reads: it coordinates the work and then hands
 * the result to someone else to grade.
 *
 * The first law of this harness is writer ≠ reviewer. A policy that tells the
 * same Lead to "review the combined result" is self-review with extra steps, so
 * the shipped copy names the independent reviewer instead — and the assembled
 * prompt, not just the constant, is what these tests read.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Orchestrate from '../src/index.ts'
import { ORCHESTRATE_SECTION, resolveConfig } from '../src/index.ts'

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  await stop?.()
  stop = undefined
})

/** Boot the real loop with the orchestrate policy mounted. */
async function setup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Orchestrate)
  const agent = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  stop = async () => { await ctx.fiber.dispose() }
  return { ctx, agent }
}

describe('the multi-task policy', () => {
  it('sends the combined result to an independent reviewer instead of grading it', () => {
    const { on } = resolveConfig()
    expect(on).toContain('review_definition_of_done')
    expect(on).toMatch(/never (?:grade|review)/iu)
    // The line the audit found: the Lead reviewing its own team's work.
    expect(on).not.toContain('review the combined result')
  })

  it('reaches the model through the assembled prompt', async () => {
    const { ctx, agent } = await setup()
    const assembly = await ctx.systemPrompt.assemble({ agent })
    const section = assembly.sections.find(entry => entry.name === ORCHESTRATE_SECTION)
    expect(section?.text).toContain('review_definition_of_done')
  })

  it('keeps the straight-thread override free of delegation instructions', () => {
    const { off } = resolveConfig()
    expect(off).not.toContain('review_definition_of_done')
    expect(off).toContain('single straight thread')
  })
})
