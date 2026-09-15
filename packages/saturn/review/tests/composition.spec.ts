/**
 * Real composition: the proof gate and the independent reviewer booted through
 * the Loader from a cordis.yml, driven by a scripted mock MODEL.
 *
 * Nothing here is hand-wired: the YAML owns order and activation, every entry
 * is the real package, and the assertions read the durable session projection
 * and the model-visible tool results — the two surfaces a shipped deployment
 * actually has.
 *
 * The walk is the doctrine end to end: a prose-only proof is refused, a receipt
 * naming a real non-error tool call flips the contract to proven, and a REVISE
 * verdict from the fresh reviewer leaves a contract stated.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as Done from '@saturnai/dsh-done'
import { DONE_TOOL } from '@saturnai/dsh-done'
import type { DoneProjection } from '@saturnai/dsh-done'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Review from '../src/index.ts'
import { REVIEW_CRITERIA, REVIEW_TOOL } from '../src/index.ts'

const STATEMENT = 'Proof-gated done ships with an independent reviewer.'

let root: string | undefined
const previousHome = process.env.DSH_HOME
afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

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

it('boots the proof-gated composition: prose refused, receipt proven, REVISE left stated', async () => {
  root = await mkdtemp(join(tmpdir(), 'saturn-review-composition-'))
  process.env.DSH_HOME = join(root, '.dsh')
  const ctx = new Context()
  await ctx.plugin(Loader)
  // Builtins preserve the test runner's source module identity. Every entry is
  // the real package; the YAML owns order, dependencies, and activation.
  Object.assign(ctx.loader.builtins, {
    'review-test-sessions': SessionStore,
    'review-test-system-prompt': SystemPrompt,
    'review-test-tools': ToolRuntime,
    'review-test-llm': LlmRuntime,
    'review-test-agents': AgentRegistry,
    'review-test-projections': SessionProjectionRegistry,
    'review-test-agent-loop': AgentLoop,
    'review-test-subagents': SubagentRuntime,
    'review-test-subagent-spawn': SpawnProvider,
    'review-test-fs': LocalFileSystem,
    'review-test-tool-fs': ToolFs,
    'review-test-done': Done,
    'review-test-review': Review,
  })
  const composition = await ctx.plugin(Include, { path: new URL('./fixtures/cordis.yml', import.meta.url).href })
  try {
    const token = ''
    const adapter = new MockAdapter([
      // 1. State the contract.
      toolCallResponse('c1', DONE_TOOL, { action: 'state', statement: STATEMENT }),
      // 2. Claim it done in prose alone — refused.
      toolCallResponse('c2', DONE_TOOL, { action: 'prove', evidence: 'I checked it over and it looks right' }),
      // 3. Actually run something, then cite that call as the receipt.
      toolCallResponse('r1', 'write', { file_path: 'proof.txt', content: 'the run happened\n' }),
      toolCallResponse('c3', DONE_TOOL, {
        action: 'prove', evidence: 'wrote proof.txt', receipt: { tool_call_id: 'r1' },
      }),
      // 4. Amend the contract, then send the new one for independent review.
      toolCallResponse('c4', DONE_TOOL, { action: 'state', statement: 'The reviewer can still send it back.' }),
      toolCallResponse('rv-1', REVIEW_TOOL, { claim: 'Everything is finished.' }),
      reviewerAnswer('REVISE', 'The claim names no run at all.'),
      // 5. Try to prove it with the token the reviewer did not mint.
      () => toolCallResponse('c5', DONE_TOOL, { action: 'prove', evidence: 'reviewed', countersign: token }),
      textResponse('Left stated: the reviewer asked for revisions.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const lead = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' }, { cwd: root })
    lead.followup(createUserMessage({
      content: [{ type: 'text', text: 'Ship it and prove it.' }],
      source: { kind: 'user' },
    }))
    await lead.whenIdle()

    const projection = (): DoneProjection =>
      ctx.sessionProjections.stateOf(lead.session, 'done')?.current ?? null

    // A prose-only proof is refused with both paths named.
    const prose = resultOf(lead.session, 'c2')
    expect(prose.isError).toBe(true)
    expect(prose.text).toContain('receipt')
    expect(prose.text).toContain('countersign')

    // The receipt flips it to proven, with the run recorded as provenance.
    expect(resultOf(lead.session, 'c3').isError).toBe(false)

    // The reviewer sent it back, so the amended contract is still stated.
    const review = JSON.parse(resultOf(lead.session, 'rv-1').text) as { verdict: string; countersign?: string }
    expect(review.verdict).toBe('REVISE')
    expect(review.countersign).toBeUndefined()
    expect(resultOf(lead.session, 'c5').isError).toBe(true)
    expect(projection()?.status).toBe('stated')
    expect(projection()?.proof).toBeUndefined()

    // The proven step really happened before the amendment: the log carries it.
    const proven = lead.session.events.filter(event =>
      event.type === 'done/change' && event.data.next?.status === 'proven')
    expect(proven).toHaveLength(1)
    if (proven[0]?.type !== 'done/change') throw new Error('unreachable')
    expect(proven[0].data.next?.proof).toEqual({ kind: 'receipt', toolCallId: 'r1', toolName: 'write' })
  } finally {
    await composition.dispose()
  }
})
