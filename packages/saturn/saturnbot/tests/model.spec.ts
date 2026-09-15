/** Provider failures cannot turn incomplete text into agent actions or lose durable request evidence. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { LoggedBotModel, botModelPrompt } from '../src/model.ts'
import { parseBotConfig } from '../src/config.ts'
import { SaturnBotStore } from '../src/store.ts'
import type { BotModelContext } from '../src/contracts.ts'
import type { BotId } from '../src/types.ts'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

it.each(['developer', 'growth', 'operations', 'finance'] as const)('includes %s delivery criteria in the specialist request', async (role) => {
  const { context } = await setup()
  const prompt = botModelPrompt(context, { id: 'task' as BotId, role, title: 'Useful result', instruction: 'Finish the assigned work.' })
  const body = JSON.parse(prompt.split('Execution context (JSON data):\n\n')[1]!) as { outputQuality: unknown; tools: unknown[] }
  expect(body.outputQuality).toMatchSnapshot()
  expect(body.tools).toEqual([])
})

async function setup(persistent = true): Promise<{
  ctx: Context
  context: BotModelContext
  model: LoggedBotModel
  disposePersistence: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'saturnbot-model-'))
  disposers.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const ctx = new Context()
  const sessions = await ctx.plugin(SessionStore)
  disposers.push(async () => { await sessions.dispose() })
  let disposePersistence = (): Promise<void> => Promise.resolve()
  if (persistent) {
    const storage = await ctx.plugin(JsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    disposePersistence = async () => { await storage.dispose() }
    disposers.push(disposePersistence)
  }
  const llm = await ctx.plugin(LlmRuntime)
  disposers.push(async () => { await llm.dispose() })
  const state = await new SaturnBotStore(join(directory, 'bot')).snapshot()
  const config = parseBotConfig({ provider: 'fixture', model: 'fixture', workspace: directory, goal: 'Triage support.' })
  return { ctx, disposePersistence, model: new LoggedBotModel(ctx), context: { config, state, cycleId: 'fixture' as BotId, branchId: null, observedState: { inbox: 'Untrusted message content.' }, tools: [], signal: new AbortController().signal } }
}

it.each([
  ['invalid JSON', textResponse('not json')],
  ['truncated response', maxTokensResponse('{"summary":"partial"')],
] as const)('rejects %s and persists the terminal failure', async (_name, chunks) => {
  const { ctx, context, model } = await setup()
  const adapter = new MockAdapter([[...chunks]])
  ctx.llm.registerAdapter(['fixture'], adapter)
  await expect(model.plan(context)).rejects.toThrow('SaturnBot model')
  const raw = await ctx.sessionPersistence.readRaw(adapter.requests[0]!.sessionId!)
  if (raw === undefined) throw new Error('Missing durable model record')
  expect(raw.content).toContain('saturnbot/model-request')
  expect(raw.content).toContain('saturnbot/model-error')
  expect(ctx.sessions.get(adapter.requests[0]!.sessionId!)).toBeUndefined()
})

it('refuses provider dispatch when request persistence is unavailable', async () => {
  const { ctx, context, model } = await setup(false)
  const adapter = new MockAdapter([textResponse('{"summary":"idle","tasks":[]}')])
  ctx.llm.registerAdapter(['fixture'], adapter)
  await expect(model.plan(context)).rejects.toThrow('SaturnBot model')
  expect(adapter.requests).toHaveLength(0)
})

it('rejects a complete provider result when its durability listener disappears during the request', async () => {
  const { ctx, context, model, disposePersistence } = await setup()
  let durableRequest = ''
  class DisappearingPersistenceAdapter extends MockAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      durableRequest = (await ctx.sessionPersistence.readRaw(options.sessionId!))?.content ?? ''
      await disposePersistence()
      yield* super.stream(options)
    }
  }
  const adapter = new DisappearingPersistenceAdapter([textResponse('{"summary":"idle","tasks":[]}')])
  ctx.llm.registerAdapter(['fixture'], adapter)
  await expect(model.plan(context)).rejects.toThrow('SaturnBot model')
  expect(durableRequest).toContain('saturnbot/model-request')
  expect(durableRequest).not.toContain('saturnbot/model-result')
  expect(adapter.requests).toHaveLength(1)
  expect(ctx.sessions.get(adapter.requests[0]!.sessionId!)).toBeUndefined()
})

it('records cancellation and bounds model-visible input before a provider request', async () => {
  const { ctx, context, model } = await setup()
  const adapter = new MockAdapter(['hang'])
  ctx.llm.registerAdapter(['fixture'], adapter)
  const controller = new AbortController()
  const pending = model.plan({ ...context, signal: controller.signal })
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await expect.poll(() => adapter.requests.length).toBe(1)
  controller.abort()
  await rejected
  expect((await ctx.sessionPersistence.readRaw(adapter.requests[0]!.sessionId!))?.content).toContain('saturnbot/model-error')
  expect(() => botModelPrompt({ ...context, observedState: { huge: 'x'.repeat(context.config.maxInputBytes) } })).toThrow('maxInputBytes')
})

it('resolves the coordinator route through a connected model router instead of the configured provider', async () => {
  const { ctx, context, model } = await setup()
  const adapter = new MockAdapter([textResponse('{"summary":"idle","tasks":[]}')], { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] })
  ctx.llm.registerAdapter(['fixture', 'routed'], adapter)
  const resolve = vi.fn().mockReturnValue({ provider: 'routed', model: 'routed-model', reasoningEffort: 'high' })
  const dispose = ctx.provide('modelRouter', { resolve })
  try {
    await model.plan(context)
    expect(resolve).toHaveBeenCalledWith('coordinator')
    expect(adapter.requests[0]).toMatchObject({ provider: 'routed', model: 'routed-model', reasoningEffort: 'high' })
    const raw = await ctx.sessionPersistence.readRaw(adapter.requests[0]!.sessionId!)
    expect(raw?.content).toContain('"routed-model"')
  } finally { dispose() }
})

it('resolves the specialist tier for a role task', async () => {
  const { ctx, context, model } = await setup()
  const adapter = new MockAdapter([textResponse('{"summary":"ok","actions":[],"continue":false}')])
  ctx.llm.registerAdapter(['fixture'], adapter)
  const resolve = vi.fn().mockReturnValue({ provider: 'fixture', model: 'fixture' })
  const dispose = ctx.provide('modelRouter', { resolve })
  try {
    await model.propose({ id: 'task' as BotId, role: 'growth', title: 'Draft outreach', instruction: 'Draft one message.' }, context)
    expect(resolve).toHaveBeenCalledWith('specialist')
  } finally { dispose() }
})

it('falls back to the configured provider and model when no router is connected, or when the router fails', async () => {
  const { ctx, context, model } = await setup()
  const adapter = new MockAdapter([textResponse('{"summary":"idle","tasks":[]}'), textResponse('{"summary":"idle","tasks":[]}')])
  ctx.llm.registerAdapter(['fixture'], adapter)
  await model.plan(context)
  expect(adapter.requests[0]).toMatchObject({ provider: 'fixture', model: 'fixture' })
  const dispose = ctx.provide('modelRouter', { resolve: () => { throw new Error('router unavailable') } })
  try {
    await model.plan(context)
    expect(adapter.requests[1]).toMatchObject({ provider: 'fixture', model: 'fixture' })
  } finally { dispose() }
})
