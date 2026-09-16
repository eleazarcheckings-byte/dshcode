import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import {
  agentEvents,
  installModelSelection,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'

/** A stand-in Agent exposing only the two session verbs the hook uses. */
function fakeAgent(messages: unknown[]) {
  const append = vi.fn()
  const agent = {
    session: {
      deriveMessages: () => messages,
      append,
    },
  } as unknown as Agent
  return { agent, append }
}

const TEXT_ONLY = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
const WITH_IMAGE = [{ role: 'user', content: [{ type: 'image', attachment: {} }] }]

/** A router that switches every image-bearing request to `sees-things`. */
function switchingRouter() {
  return {
    resolveForRequest: vi.fn(({ provider, model, messages }: {
      provider: string
      model: string
      messages: readonly { content: readonly { type: string }[] }[]
    }) => Promise.resolve(
      messages.some(message => message.content.some(block => block.type === 'image'))
        ? { provider, model: 'sees-things', switched: true, reason: 'catalog' }
        : { provider, model, switched: false },
    )),
  }
}

async function bench(options: { router?: unknown } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  if (options.router !== undefined) ctx.provide('modelRouter', options.router)
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  const dispose = installModelSelection(ctx, selection)
  return { ctx, selection, dispose }
}

const seed: LlmCallConfig = { provider: 'deepseek-official', model: 'text-only', temperature: 0.2 }

async function dispatch(ctx: Context, agent: Agent, config: LlmCallConfig = seed) {
  return agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve(config),
  )
}

describe('vision routing before dispatch', () => {
  it('changes nothing for a text-only request', async () => {
    const harness = await bench({ router: switchingRouter() })
    const { agent, append } = fakeAgent(TEXT_ONLY)
    await expect(dispatch(harness.ctx, agent)).resolves.toEqual(seed)
    expect(append).not.toHaveBeenCalled()
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('dispatches the switched model when the request carries an image', async () => {
    const harness = await bench({ router: switchingRouter() })
    const { agent, append } = fakeAgent(WITH_IMAGE)
    await expect(dispatch(harness.ctx, agent)).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'sees-things',
      temperature: 0.2,
    })
    expect(append).toHaveBeenCalledWith('model/vision-route', {
      provider: 'deepseek-official',
      model: 'sees-things',
      from: { provider: 'deepseek-official', model: 'text-only' },
      reason: 'catalog',
    })
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('outranks the agent-scoped model selection so the switch actually reaches the wire', async () => {
    const harness = await bench({ router: switchingRouter() })
    harness.selection.current = {
      provider: 'deepseek-official',
      model: 'text-only',
      reasoningEffort: ReasoningEffortId('high'),
    }
    await harness.ctx.systemPrompt.assemble()
    const { agent } = fakeAgent(WITH_IMAGE)
    await expect(dispatch(harness.ctx, agent)).resolves.toMatchObject({ model: 'sees-things' })
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('degrades to today\'s behaviour when no model router is mounted', async () => {
    const harness = await bench()
    const { agent, append } = fakeAgent(WITH_IMAGE)
    await expect(dispatch(harness.ctx, agent)).resolves.toEqual(seed)
    expect(append).not.toHaveBeenCalled()
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('leaves the request alone when the router declines to switch', async () => {
    const router = {
      resolveForRequest: vi.fn(() => Promise.resolve({
        provider: 'deepseek-official', model: 'text-only', switched: false,
      })),
    }
    const harness = await bench({ router })
    const { agent, append } = fakeAgent(WITH_IMAGE)
    await expect(dispatch(harness.ctx, agent)).resolves.toEqual(seed)
    expect(router.resolveForRequest).toHaveBeenCalledTimes(1)
    expect(append).not.toHaveBeenCalled()
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('survives a router that throws, keeping the original route', async () => {
    const router = { resolveForRequest: () => Promise.reject(new Error('catalog offline')) }
    const harness = await bench({ router })
    const { agent } = fakeAgent(WITH_IMAGE)
    await expect(dispatch(harness.ctx, agent)).resolves.toEqual(seed)
    harness.dispose()
    await harness.ctx.fiber.dispose()
  })
})
