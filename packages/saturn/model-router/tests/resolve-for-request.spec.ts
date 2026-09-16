/**
 * Per-request vision routing: a request carrying image content is served by an
 * image-capable model, and a text-only request is left exactly as it was.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import ModelRouterService, { MODEL_ROUTER_SETTINGS_NAMESPACE } from '../src/index.ts'
import type { RoutedRequest } from '../src/index.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** One advisory catalog entry, shaped like the fields `resolveForRequest` reads. */
interface FakeModel {
  id: string
  inputModalities?: readonly string[]
}

/** Fixture catalog: two text-only ids, then the first image-capable id. */
const CATALOG: Record<string, FakeModel[]> = {
  'deepseek-official': [
    { id: 'text-a', inputModalities: ['text'] },
    { id: 'text-b', inputModalities: ['text'] },
    { id: 'sees-things', inputModalities: ['text', 'image'] },
    { id: 'sees-things-too', inputModalities: ['text', 'image'] },
  ],
  other: [{ id: 'other-text', inputModalities: ['text'] }],
}

/** Stand-in for the `llm` service's two read-only catalog verbs. */
function fakeLlm(catalog: Record<string, FakeModel[]> = CATALOG) {
  return {
    listModels: (provider: string): Promise<readonly FakeModel[]> =>
      Promise.resolve(catalog[provider] ?? []),
    resolveModelInfo: (provider: string, model: string): Promise<FakeModel> => {
      const found = catalog[provider]?.find(entry => entry.id === model)
      return found === undefined ? Promise.resolve({ id: model }) : Promise.resolve(found)
    },
  }
}

async function boot(options: { llm?: unknown } = {}): Promise<{
  ctx: Context
  router: ModelRouterService
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  if (options.llm !== undefined) ctx.provide('llm', options.llm)
  await ctx.plugin(ModelRouterService, {})
  return { ctx, router: ctx.modelRouter }
}

/** A message list whose only block is text. */
const TEXT_ONLY = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]

/** A message list carrying one image block. */
const WITH_IMAGE = [
  { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', attachment: {} }] },
]

/** A message list whose image is nested inside a tool result. */
const NESTED_IMAGE = [
  {
    role: 'user',
    content: [{
      type: 'tool-result',
      content: [{ type: 'image', attachment: {} }],
    }],
  },
]

function request(overrides: Partial<RoutedRequest> = {}): RoutedRequest {
  return {
    provider: 'deepseek-official',
    model: 'text-a',
    messages: TEXT_ONLY,
    ...overrides,
  } as RoutedRequest
}

describe('ModelRouterService.resolveForRequest()', () => {
  it('leaves a text-only request exactly as it was', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(request())).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'text-a',
      switched: false,
    })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the route when the current model already accepts images', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(
      request({ model: 'sees-things', messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'sees-things',
      switched: false,
    })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the route when the model declares no modalities at all', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(
      request({ model: 'unknown-id', messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'unknown-id',
      switched: false,
    })
    await bench.ctx.fiber.dispose()
  })

  it('switches to the configured vision tier when the current model cannot see', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await bench.ctx.settings.set(MODEL_ROUTER_SETTINGS_NAMESPACE, {
      tiers: {
        coordinator: 'default',
        specialist: 'default',
        bulk: 'default',
        vision: { provider: 'deepseek-official', model: 'sees-things-too', reasoningEffort: 'high' },
      },
      externalHarnesses: false,
    })
    await expect(bench.router.resolveForRequest(
      request({ messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'sees-things-too',
      reasoningEffort: 'high',
      switched: true,
      reason: 'vision-tier',
    })
    await bench.ctx.fiber.dispose()
  })

  it('falls through to the first same-provider image-capable catalog model', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(
      request({ messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'sees-things',
      switched: true,
      reason: 'catalog',
    })
    await bench.ctx.fiber.dispose()
  })

  it('finds a nested tool-result image the same way', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(
      request({ messages: NESTED_IMAGE }),
    )).resolves.toMatchObject({ model: 'sees-things', switched: true })
    await bench.ctx.fiber.dispose()
  })

  it('leaves the route untouched when the provider has no image-capable model', async () => {
    const bench = await boot({ llm: fakeLlm() })
    await expect(bench.router.resolveForRequest(
      request({ provider: 'other', model: 'other-text', messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'other',
      model: 'other-text',
      switched: false,
    })
    await bench.ctx.fiber.dispose()
  })

  it('never throws when no llm service is mounted', async () => {
    const bench = await boot()
    await expect(bench.router.resolveForRequest(
      request({ messages: WITH_IMAGE }),
    )).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'text-a',
      switched: false,
    })
    await bench.ctx.fiber.dispose()
  })
})
