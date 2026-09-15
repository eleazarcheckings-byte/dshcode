/**
 * Independent review: the Lead never grades its own work.
 *
 * `review_definition_of_done` runs a FRESH child agent — its own session, its
 * own system prompt, zero parent context — under the adversarial-reviewer
 * persona, makes it answer in the fixed rubric shape, and mints a countersign
 * token only on PASS. The real subagent runtime and the real spawn backend are
 * used throughout; the model is the only mocked boundary.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ForkProvider from '@deepseek-ai/dsh-subagent-fork-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as Done from '@saturnai/dsh-done'
import { DONE_TOOL } from '@saturnai/dsh-done'
import type { DoneProjection } from '@saturnai/dsh-done'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Review from '../src/index.ts'
import { REVIEW_CRITERIA, REVIEW_TOOL } from '../src/index.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const STATEMENT = 'The review tool mints a countersign only on PASS.'

/** The reviewer child's answer, as the structured-output call it must finish with. */
function reviewerAnswer(verdict: 'PASS' | 'REVISE' | 'REJECT', summary: string) {
  return toolCallResponse('sv-1', 'structured_output', {
    verdict,
    summary,
    scores: REVIEW_CRITERIA.map(criterion => ({
      criterion,
      score: verdict === 'PASS' ? 5 : 2,
      evidence: `weighed ${criterion} against the transcript`,
    })),
  })
}

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  await stop?.()
  stop = undefined
})

/**
 * Boot the real loop, the real subagent runtime, the contract plugin and the
 * reviewer behind one scripted model.
 * @param script - model responses, in order: the Lead's, then each child's.
 * @param config - reviewer plugin configuration under test.
 * @returns the context and the lead agent.
 */
async function setup(script: Script, config: Review.Config = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SpawnProvider, { providerName: 'spawn' })
  await ctx.plugin(ForkProvider, { providerName: 'fork' })
  await ctx.plugin(Done)
  await ctx.plugin(Review, config)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const agent = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  stop = async () => { await ctx.fiber.dispose() }
  return { ctx, agent }
}

/** Drive one user turn to quiescence. */
async function turn(agent: ReturnType<Context['agentLoop']['create']>, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** The model-visible outcome of one tool call, by its call id. */
function resultOf(session: Session, callId: string): { isError: boolean; text: string } {
  const event = session.events.find(entry =>
    entry.type === 'tool/result' && entry.data.message.source.callId === callId)
  if (event?.type !== 'tool/result') throw new Error(`no tool/result logged for ${callId}`)
  const block = event.data.message.content[0]
  return {
    isError: block.isError === true,
    text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'),
  }
}

/** The session's current contract. */
function contractOf(ctx: Context, session: Session): DoneProjection {
  return ctx.sessionProjections.stateOf(session, 'done')?.current ?? null
}

describe('review_definition_of_done', () => {
  it('returns a PASS verdict with a countersign the contract then accepts', async () => {
    let token = ''
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'The mint path is covered by four specs; run_tests showed 37 passed.' }),
      reviewerAnswer('PASS', 'The claim matches the transcript.'),
      () => toolCallResponse('c2', DONE_TOOL, { action: 'prove', evidence: 'independent review: PASS', countersign: token }),
      textResponse('Proven, countersigned.'),
    ])
    await turn(agent, 'State the contract and get it reviewed.')
    const review = resultOf(agent.session, 'rv-1')
    expect(review.isError).toBe(false)
    const payload = JSON.parse(review.text) as { verdict: string; countersign?: string; reviewer: string }
    expect(payload.verdict).toBe('PASS')
    expect(payload.reviewer).toContain('Mars')
    expect(typeof payload.countersign).toBe('string')
    token = payload.countersign ?? ''
    await turn(agent, 'Now record it.')
    const contract = contractOf(ctx, agent.session)
    expect(contract?.status).toBe('proven')
    expect(contract?.proof).toMatchObject({ kind: 'countersign', verdict: 'PASS', token })
  })

  it('keeps the contract stated on REVISE and mints no token', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'It is done, trust me.' }),
      reviewerAnswer('REVISE', 'The claim cites no run.'),
      textResponse('Revising.'),
    ])
    await turn(agent, 'Get it reviewed.')
    const payload = JSON.parse(resultOf(agent.session, 'rv-1').text) as { verdict: string; countersign?: string }
    expect(payload.verdict).toBe('REVISE')
    expect(payload.countersign).toBeUndefined()
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('gives the reviewer a fresh session that never saw the Lead conversation', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'Covered by four specs.' }),
      reviewerAnswer('PASS', 'Checked.'),
      textResponse('Reviewed.'),
    ])
    const seen: string[] = []
    ctx.on('subagent/start', (info) => { seen.push(info.id) })
    await turn(agent, 'A secret the reviewer must never read: hunter2.')
    expect(seen).toHaveLength(1)
    const child = ctx.agents.get(seen[0] as never)
    const transcript = JSON.stringify(child?.session.events ?? [])
    expect(transcript).not.toContain('hunter2')
    expect(child?.session.header.id).not.toBe(agent.session.header.id)
  })

  it('refuses a provider that would seed the reviewer with the Lead context', async () => {
    const { agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'Covered.' }),
      textResponse('Cannot review.'),
    ], { provider: 'fork' })
    await turn(agent, 'Get it reviewed.')
    const refusal = resultOf(agent.session, 'rv-1')
    expect(refusal.isError).toBe(true)
    expect(refusal.text).toContain('fresh')
  })

  it('refuses to review a session with no stated contract', async () => {
    const { agent } = await setup([
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'Everything is fine.' }),
      textResponse('Nothing to review.'),
    ])
    await turn(agent, 'Get it reviewed.')
    const refusal = resultOf(agent.session, 'rv-1')
    expect(refusal.isError).toBe(true)
    expect(refusal.text).toContain('definition of done')
  })
})

describe('registry disposal', () => {
  it('removes the review tool when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SpawnProvider, { providerName: 'spawn' })
    await ctx.plugin(Done)
    const fork = await ctx.plugin(Review)
    expect(ctx.tools.get(REVIEW_TOOL)).toBeDefined()
    await fork.dispose()
    expect(ctx.tools.get(REVIEW_TOOL)).toBeUndefined()
  })
})
