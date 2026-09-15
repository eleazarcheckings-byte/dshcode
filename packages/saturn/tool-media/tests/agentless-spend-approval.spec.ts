// Fix-round-3 regression (Mars F1): SPEC §4's pinned single-argument shape — `ctx.media.generate(req)`
// with NO second `exec` argument — is the exact call SaturnBot's real `creative.generate` site makes
// (`packages/saturn/saturnbot/src/adapters/integrations.ts`, `BotMediaService` in `contracts.ts`), and
// SaturnBot has no `dsh-agent` `Agent` anywhere in its own execution model, so `ctx.approval` (which
// requires one) can never be the route for that caller. This proves the agentless fallback Mars
// required: with no agent, the spend Gate routes through `ctx.userQuestions` instead — carrying the
// same estimated-cost line, firing zero network requests before the human answers, and failing closed
// on both Decline and on no answerer being composed at all — while a caller that DOES supply an agent
// still goes through the preferred `ctx.approval` route untouched (proven in tool-media.spec.ts and
// with-agent.spec.ts already).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'

import * as ToolMedia from '../src/index.ts'
import type { MediaGenerateRequest } from '../src/index.ts'
import { jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function server(handler: Parameters<typeof startMockServer>[0]): Promise<MockServer> {
  const instance = await startMockServer(handler)
  cleanup.push(instance.close)
  return instance
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-media-agentless-'))
  dirs.push(dir)
  return dir
}

/**
 * Boot a composition with NO `@deepseek-ai/dsh-user-approval` plugged at all — matching SaturnBot's
 * real composition (its own `roles`/`effect` central approval, never `ctx.approval`) — plus
 * `UserQuestionService` and one scripted answerer, so the ONLY route a paid call can take is the
 * agentless `ctx.userQuestions` fallback this fix round adds.
 */
type Answerer = (request: AskUserQuestionRequest) => AskUserQuestionAnswer | Promise<AskUserQuestionAnswer>

async function boot(config: ToolMedia.Config, answer: Answerer) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  const seen: AskUserQuestionRequest[] = []
  ctx.on('user-questions/request', (request) => {
    seen.push(request)
    return Promise.resolve(answer(request))
  })
  await ctx.plugin(ToolMedia, config)
  return { ctx, seen }
}

function approveAnswer(id: string): AskUserQuestionAnswer {
  return { answers: [{ id, selected: ['Approve'] }] }
}

function declineAnswer(id: string): AskUserQuestionAnswer {
  return { answers: [{ id, selected: ['Decline'] }] }
}

describe('the agentless spend-approval fallback (ctx.userQuestions, no Agent anywhere)', () => {
  it('a bare ctx.media.generate(req) call — SPEC §4\'s pinned shape verbatim, no exec argument — routes through ctx.userQuestions, with the cost line, before any network request', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    let requestsAtAskTime = -1
    const { ctx, seen } = await boot(
      { gemini: { apiKey: 'sk-test', baseURL: mock.url } },
      (request) => {
        requestsAtAskTime = mock.requests.length
        return approveAnswer(request.questions[0].id)
      },
    )

    const request: MediaGenerateRequest = { kind: 'image', prompt: 'an agentless square', workspace: await workspace() }
    // The pinned shape's own call signature: exactly one argument — no second `exec` at all.
    const job = await ctx.media.generate(request)

    expect(job.status).toBe('done')
    expect(requestsAtAskTime).toBe(0) // zero network requests before the human answered
    expect(mock.requests).toHaveLength(1)
    expect(seen).toHaveLength(1)
    const ask = seen[0]
    if (!ask) throw new Error('expected exactly one ask')
    const question = ask.questions[0]
    if (!question) throw new Error('expected one question in the ask')
    expect(question.detail).toContain('estimated cost')
    expect(question.detail).toContain('$0.067')
    expect(ask.agent).toBeUndefined() // truly agentless — nothing to scope the ask to
  })

  it('declining through ctx.userQuestions fails the call closed with no network request at all', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot(
      { gemini: { apiKey: 'sk-test', baseURL: mock.url } },
      request => declineAnswer(request.questions[0]?.id ?? ''),
    )

    const request: MediaGenerateRequest = { kind: 'image', prompt: 'x', workspace: await workspace() }
    await expect(ctx.media.generate(request)).rejects.toThrow('the user declined this')
    expect(mock.requests).toHaveLength(0)
  })

  it('with no userQuestions answerer composed either, an agentless call still fails closed before the network — never silently spends', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService) // composed, but no answerer registered
    await ctx.plugin(ToolMedia, { gemini: { apiKey: 'sk-test', baseURL: mock.url } })

    const request: MediaGenerateRequest = { kind: 'image', prompt: 'x', workspace: await workspace() }
    // ctx.userQuestions IS composed here, just with no answerer — a distinct fail-closed shape from
    // "no userQuestions service at all" (covered by the no-userQuestions-plugin case in tool-media.spec.ts).
    await expect(ctx.media.generate(request)).rejects.toThrow('failed closed')
    expect(mock.requests).toHaveLength(0)
  })
})
