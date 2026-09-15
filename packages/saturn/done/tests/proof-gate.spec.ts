/**
 * The proof gate: a definition of done leaves `stated` only on evidence the
 * harness can check for itself.
 *
 * Doctrine under test — "'done' means proven" stops being a self-report. The
 * model may cite a RECEIPT (the id of a tool call in this session whose result
 * was not an error: the run it actually made) or a COUNTERSIGN (the token an
 * independent reviewer minted after grading the work PASS). Prose alone is
 * refused, with the two paths named in the refusal.
 *
 * Every tool call here goes through the real agent loop behind a scripted mock
 * MODEL — the only mocked boundary — so the receipts under test are real
 * `tool/call`/`tool/result` pairs in a real session log.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Done from '../src/index.ts'
import { DONE_TOOL, mintCountersign, statedGuidance } from '../src/index.ts'
import type { DoneProjection, ReviewScore } from '../src/types.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const STATEMENT = 'The proof gate refuses a prose-only proof.'

/** A full-marks rubric: the six criteria an independent reviewer grades. */
const SCORES: ReviewScore[] = [
  { criterion: 'factual_accuracy', score: 5, evidence: 'every claim maps to a command in the transcript' },
  { criterion: 'completeness', score: 5, evidence: 'all three refusal paths covered' },
  { criterion: 'format_compliance', score: 4, evidence: 'matches the rubric shape' },
  { criterion: 'internal_consistency', score: 5, evidence: 'no contradiction between the summary and the scores' },
  { criterion: 'edge_case_handling', score: 4, evidence: 'errored receipts and unknown ids are both refused' },
  { criterion: 'source_quality', score: 5, evidence: 'cited the session log, not the answer' },
]

let disposeCtx: (() => Promise<void>) | undefined
afterEach(async () => {
  await disposeCtx?.()
  disposeCtx = undefined
})

/**
 * Boot the real loop, the real tool registry and the real done plugin behind a
 * scripted model, plus one fixture tool that stands in for a test runner.
 * @param script - the model responses, in order.
 * @returns the context, the lead agent, and the adapter.
 */
async function setup(script: Script) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Done)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  ctx.tools.register(defineContentToolFixture({
    name: 'run_tests',
    description: 'Run the test suite and report what it showed.',
    parameters: { fail: { type: 'boolean', description: 'Report a failing run.' } },
    execute: (args) => {
      if (args.fail === true) throw new Error('2 tests failed')
      return Promise.resolve([{ type: 'text' as const, text: '37 passed' }])
    },
  }))
  const agent = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  disposeCtx = async () => { await ctx.fiber.dispose() }
  return { ctx, agent }
}

/** One agent as this spec drives it: a prompt in, quiescence out. */
interface Driveable {
  followup: (message: ReturnType<typeof createUserMessage>) => void
  whenIdle: () => Promise<unknown>
}

/** Drive one user turn to quiescence. */
async function turn(agent: Driveable, text: string): Promise<void> {
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

describe('prove refuses a proof it cannot check', () => {
  it('refuses a prose-only proof and names both proof paths', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('c2', DONE_TOOL, { action: 'prove', evidence: 'I ran the tests and they passed' }),
      textResponse('Left stated: I have no receipt.'),
    ])
    await turn(agent, 'Close the contract.')
    const refusal = resultOf(agent.session, 'c2')
    expect(refusal.isError).toBe(true)
    expect(refusal.text).toContain('receipt')
    expect(refusal.text).toContain('countersign')
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('refuses a receipt that names no call in this session', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: '37 passed', receipt: { tool_call_id: 'never-ran' },
      }),
      textResponse('No such call.'),
    ])
    await turn(agent, 'Close the contract.')
    expect(resultOf(agent.session, 'c2').isError).toBe(true)
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('refuses a receipt whose tool call ended in an error', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('r1', 'run_tests', { fail: true }),
      toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: 'the suite ran', receipt: { tool_call_id: 'r1' },
      }),
      textResponse('The run failed.'),
    ])
    await turn(agent, 'Close the contract.')
    const refusal = resultOf(agent.session, 'c2')
    expect(refusal.isError).toBe(true)
    expect(refusal.text).toContain('error')
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('refuses a receipt that cites the definition-of-done tool itself', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: 'stated it', receipt: { tool_call_id: 'c1' },
      }),
      textResponse('Circular.'),
    ])
    await turn(agent, 'Close the contract.')
    expect(resultOf(agent.session, 'c2').isError).toBe(true)
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })
})

describe('prove accepts a receipt', () => {
  it('records the tool call that proved it as provenance', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('r1', 'run_tests', {}),
      toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: 'run_tests: 37 passed', receipt: { tool_call_id: 'r1' },
      }),
      textResponse('Proven.'),
    ])
    await turn(agent, 'Close the contract.')
    expect(resultOf(agent.session, 'c2').isError).toBe(false)
    const contract = contractOf(ctx, agent.session)
    expect(contract?.status).toBe('proven')
    expect(contract?.evidence).toBe('run_tests: 37 passed')
    expect(contract?.proof).toEqual({ kind: 'receipt', toolCallId: 'r1', toolName: 'run_tests' })
  })

  it('drops the proof when the statement is amended', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      toolCallResponse('r1', 'run_tests', {}),
      toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: '37 passed', receipt: { tool_call_id: 'r1' },
      }),
      toolCallResponse('c3', DONE_TOOL, { action: 'state', statement: 'A different contract entirely.' }),
      textResponse('Amended.'),
    ])
    await turn(agent, 'Close the contract, then change it.')
    const contract = contractOf(ctx, agent.session)
    expect(contract?.status).toBe('stated')
    expect(contract?.proof).toBeUndefined()
  })
})

describe('prove accepts a countersign', () => {
  /**
   * The token is only known after the contract is stated, so the second model
   * response is computed at call time from the mint the test performs between
   * the two turns.
   * @param token - reads the minted token when the model is asked the second time.
   * @returns the script: state the contract, then prove it with that token.
   */
  function countersignScript(token: () => string): Script {
    return [
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      textResponse('Stated. Sending it for review.'),
      () => toolCallResponse('c2', DONE_TOOL, {
        action: 'prove', evidence: 'independent review: PASS', countersign: token(),
      }),
      textResponse('Proven.'),
    ]
  }

  it('records the reviewer and the rubric a PASS token carries', async () => {
    let token = ''
    const { ctx, agent } = await setup(countersignScript(() => token))
    await turn(agent, 'State the contract.')
    const record = mintCountersign(agent.session, {
      statement: STATEMENT,
      verdict: 'PASS',
      reviewer: 'Mars — adversarial reviewer (spawn)',
      scores: SCORES,
      summary: 'The refusal paths are all exercised.',
    })
    token = record.token
    await turn(agent, 'Now prove it.')
    expect(resultOf(agent.session, 'c2').isError).toBe(false)
    const contract = contractOf(ctx, agent.session)
    expect(contract?.status).toBe('proven')
    expect(contract?.proof).toEqual({
      kind: 'countersign',
      token: record.token,
      reviewer: 'Mars — adversarial reviewer (spawn)',
      verdict: 'PASS',
      scores: SCORES,
      summary: 'The refusal paths are all exercised.',
    })
  })

  it('refuses a token minted against a different statement', async () => {
    let token = ''
    const { ctx, agent } = await setup(countersignScript(() => token))
    await turn(agent, 'State the contract.')
    token = mintCountersign(agent.session, {
      statement: 'Some other contract the reviewer actually graded.',
      verdict: 'PASS',
      reviewer: 'Mars — adversarial reviewer (spawn)',
      scores: SCORES,
    }).token
    await turn(agent, 'Now prove it.')
    expect(resultOf(agent.session, 'c2').isError).toBe(true)
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('refuses a token whose verdict was not PASS', async () => {
    let token = ''
    const { ctx, agent } = await setup(countersignScript(() => token))
    await turn(agent, 'State the contract.')
    token = mintCountersign(agent.session, {
      statement: STATEMENT,
      verdict: 'REVISE',
      reviewer: 'Mars — adversarial reviewer (spawn)',
      scores: SCORES,
    }).token
    await turn(agent, 'Now prove it.')
    const refusal = resultOf(agent.session, 'c2')
    expect(refusal.isError).toBe(true)
    expect(refusal.text).toContain('REVISE')
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })

  it('refuses a token this session never minted', async () => {
    const { ctx, agent } = await setup(countersignScript(() => 'saturn-countersign:00000000-0000-4000-8000-000000000000'))
    await turn(agent, 'State the contract.')
    await turn(agent, 'Now prove it.')
    expect(resultOf(agent.session, 'c2').isError).toBe(true)
    expect(contractOf(ctx, agent.session)?.status).toBe('stated')
  })
})

describe('the stated guidance', () => {
  it('names both proof paths and refuses prose', () => {
    const text = statedGuidance(STATEMENT)
    expect(text).toContain('receipt')
    expect(text).toContain('countersign')
    expect(text).toContain('review_definition_of_done')
  })
})

describe('the human path', () => {
  it('records /done prove as a human attestation, not a machine-checked proof', async () => {
    const { ctx, agent } = await setup([
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      textResponse('Stated.'),
    ])
    await ctx.plugin(CommandRuntime)
    await turn(agent, 'State the contract.')
    const execution = await ctx.commands.execute(
      agent,
      '/done prove I watched the suite go green myself',
      [],
      new AbortController().signal,
    )
    expect(execution?.result.kind).toBe('success')
    const contract = contractOf(ctx, agent.session)
    expect(contract?.status).toBe('proven')
    expect(contract?.proof).toEqual({ kind: 'human' })
  })
})

describe('registry disposal', () => {
  it('removes the tool when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    const fork = await ctx.plugin(Done)
    expect(ctx.tools.get(DONE_TOOL)).toBeDefined()
    await fork.dispose()
    expect(ctx.tools.get(DONE_TOOL)).toBeUndefined()
  })
})
