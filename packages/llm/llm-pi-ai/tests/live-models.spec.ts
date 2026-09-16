/**
 * Live model listings for declared routes (`modelsEndpoint: true`) — the
 * Hugging Face router in particular: mapping, cache and fallback, routing
 * suffixes, the router error map, and the guarantee that the token travels
 * only in the Authorization header.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile } from '../src/config.ts'
import {
  describeLiveModel,
  isRoutableModelId,
  LIVE_MODEL_TTL_MS,
  LiveModelCache,
  mapModelListing,
  mergeLiveModels,
  routerFailure,
  routerFailureKind,
  splitRoutedModelId,
  withRoutingSuffix,
} from '../src/live-models.ts'
import type { LiveModel } from '../src/live-models.ts'
import { assemble } from './assemble.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

const listing: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/hf-router-models.json', import.meta.url), 'utf8'),
)

const TOKEN = 'hf_fixtureTokenNeverReal0000'
const ROUTER = 'https://router.huggingface.co/v1'

const expectedLive: LiveModel[] = [
  {
    id: 'openai/gpt-oss-120b',
    contextWindow: 131072,
    input: ['text'],
    tools: true,
    providers: ['groq', 'cerebras'],
  },
  {
    id: 'Qwen/Qwen2.5-VL-7B-Instruct',
    contextWindow: 32768,
    input: ['text', 'image'],
    tools: false,
    providers: ['hyperbolic'],
  },
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    input: ['text'],
    tools: true,
    providers: ['nebius'],
  },
]

const SEEDS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
  { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct' },
  { id: 'deepseek-ai/DeepSeek-V3.1' },
]

function hfProfile(overrides: Partial<PiAiProviderProfile> = {}): PiAiProviderProfile {
  return {
    displayName: 'Hugging Face',
    api: 'openai-completions',
    baseURL: ROUTER,
    apiKeyEnv: 'PI_TEST_KEY',
    modelsEndpoint: true,
    models: SEEDS.map(seed => ({ ...seed })),
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubEnv('PI_TEST_KEY', TOKEN)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

describe('mapModelListing', () => {
  it('keeps models with a live provider and maps them to model info exactly', () => {
    expect(mapModelListing(listing)).toEqual(expectedLive)
  })

  it('refuses a body that is not a model listing', () => {
    expect(() => mapModelListing({ nope: true })).toThrow(LlmError)
  })

  it('keeps a plain OpenAI-compatible entry (no providers array) as text-only', () => {
    expect(mapModelListing({ data: [{ id: 'local-model', context_length: 4096 }] }))
      .toEqual([{ id: 'local-model', contextWindow: 4096, input: ['text'], tools: false, providers: [] }])
  })
})

describe('describeLiveModel', () => {
  it('summarizes context, tools, and live providers in one parseable line', () => {
    expect(describeLiveModel(expectedLive[0]!)).toBe('131K context · tools · via groq, cerebras')
    expect(describeLiveModel(expectedLive[1]!)).toBe('33K context · via hyperbolic')
    expect(describeLiveModel(expectedLive[2]!)).toBe('tools · via nebius')
  })
})

describe('routing suffix', () => {
  it('appends a chosen policy or provider to a bare org/name id', () => {
    expect(withRoutingSuffix('org/name', 'cheapest')).toBe('org/name:cheapest')
    expect(withRoutingSuffix('org/name', 'preferred')).toBe('org/name:preferred')
    expect(withRoutingSuffix('org/name', 'groq')).toBe('org/name:groq')
  })

  it('leaves fastest (the router default) bare', () => {
    expect(withRoutingSuffix('org/name', 'fastest')).toBe('org/name')
    expect(withRoutingSuffix('org/name', undefined)).toBe('org/name')
  })

  it('sends a typed id that already carries a suffix as-is', () => {
    expect(withRoutingSuffix('org/name:groq', 'cheapest')).toBe('org/name:groq')
    expect(splitRoutedModelId('org/name:groq')).toEqual({ base: 'org/name', suffix: 'groq' })
    expect(splitRoutedModelId('org/name')).toEqual({ base: 'org/name', suffix: undefined })
  })

  it('rejects ids that are not org/name[:suffix]', () => {
    for (const bad of ['gpt-4o', 'org/', '/name', 'org/name:', 'a b/c', 'org/name/extra', '']) {
      expect(isRoutableModelId(bad), bad).toBe(false)
      expect(() => withRoutingSuffix(bad, 'cheapest'), bad).toThrow(LlmError)
    }
    expect(isRoutableModelId('meta-llama/Llama-3.1-8B-Instruct:fastest')).toBe(true)
  })
})

describe('router error map', () => {
  it('maps the actionable statuses to stable kinds', () => {
    expect(routerFailureKind(401)).toBe('unauthorized')
    expect(routerFailureKind(402)).toBe('credits')
    expect(routerFailureKind(403)).toBe('gated')
    expect(routerFailureKind(404)).toBe('notFound')
    expect(routerFailureKind(429)).toBe('rateLimited')
    expect(routerFailureKind(400)).toBeUndefined()
    expect(routerFailureKind(500)).toBeUndefined()
  })

  it('tags the message with the kind the client localizes, and keeps the status', () => {
    const credits = routerFailure(402)
    expect(credits.message.startsWith('[huggingface:credits]')).toBe(true)
    expect(credits.message).toContain('https://huggingface.co/settings/billing')
    expect(credits.failure.status).toBe(402)
    expect(routerFailure(401).message.startsWith('[huggingface:unauthorized]')).toBe(true)
    expect(routerFailure(403).message.startsWith('[huggingface:gated]')).toBe(true)
    expect(routerFailure(404).message.startsWith('[huggingface:notFound]')).toBe(true)
    expect(routerFailure(429).message.startsWith('[huggingface:rateLimited]')).toBe(true)
    const other = routerFailure(418, 'short and stout')
    expect(other.message).toContain('short and stout')
    expect(other.message.startsWith('[huggingface:')).toBe(false)
  })
})

describe('LiveModelCache', () => {
  function cache(fetchImpl: typeof fetch, now: { value: number }, onFailure = vi.fn()) {
    return {
      onFailure,
      cache: new LiveModelCache({ fetch: fetchImpl, now: () => now.value, onFailure }),
    }
  }
  const source = (apiKey: string | undefined = TOKEN) => ({ baseURL: ROUTER, apiKey: () => Promise.resolve(apiKey) })

  it('fetches {baseURL}/models with the token only in the Authorization header', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(200, listing)))
    const { cache: live } = cache(fetchSpy, { value: 0 })
    const before = live.generation
    await live.refresh('huggingface', source())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe(`${ROUTER}/models`)
    expect(String(url)).not.toContain(TOKEN)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(live.models('huggingface')).toEqual(expectedLive)
    expect(live.generation).toBeGreaterThan(before)
    expect(live.describe('huggingface', 'openai/gpt-oss-120b:cheapest')).toBe('131K context · tools · via groq, cerebras')
  })

  it('serves the cached list for ten minutes, then refreshes', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(200, listing)))
    const now = { value: 1_000 }
    const { cache: live } = cache(fetchSpy, now)
    expect(LIVE_MODEL_TTL_MS).toBe(600_000)
    await live.refresh('huggingface', source())
    now.value += LIVE_MODEL_TTL_MS - 1
    await live.refresh('huggingface', source())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    now.value += 2
    await live.refresh('huggingface', source())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good list when a later fetch fails or comes back empty, and never reports the token', async () => {
    const responses = [
      jsonResponse(200, listing),
      jsonResponse(500, { error: `upstream echoed Bearer ${TOKEN}` }),
      jsonResponse(200, { data: [] }),
    ]
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(responses.shift()!))
    const now = { value: 0 }
    const { cache: live, onFailure } = cache(fetchSpy, now)
    await live.refresh('huggingface', source())
    const generation = live.generation
    now.value += LIVE_MODEL_TTL_MS + 1
    await live.refresh('huggingface', source())
    now.value += LIVE_MODEL_TTL_MS + 1
    await live.refresh('huggingface', source())
    expect(live.models('huggingface')).toEqual(expectedLive)
    expect(live.generation).toBe(generation)
    expect(onFailure).toHaveBeenCalledTimes(2)
    for (const call of onFailure.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(TOKEN)
      expect(String((call[1] as Error).message)).not.toContain(TOKEN)
    }
  })

  it('reports a 401 through the router error map', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(401, { error: 'Invalid credentials' })))
    const { cache: live, onFailure } = cache(fetchSpy, { value: 0 })
    await live.refresh('huggingface', source())
    expect(live.models('huggingface')).toBeUndefined()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect((onFailure.mock.calls[0]![1] as Error).message.startsWith('[huggingface:unauthorized]')).toBe(true)
  })

  it('makes no call at all while no token exists', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(200, listing)))
    const { cache: live, onFailure } = cache(fetchSpy, { value: 0 })
    // Spelled out: `source(undefined)` would take the parameter default (the token).
    await live.refresh('huggingface', { baseURL: ROUTER, apiKey: () => Promise.resolve(undefined) })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
    expect(live.models('huggingface')).toBeUndefined()
  })
})

describe('mergeLiveModels', () => {
  it('serves the seeds alone when no live list exists', () => {
    expect(mergeLiveModels(SEEDS, undefined)).toEqual(SEEDS)
  })

  it('puts seeds first, fills their unset fields from the live entry, then appends the rest', () => {
    expect(mergeLiveModels([...SEEDS, { id: 'Qwen/Qwen2.5-VL-7B-Instruct:cheapest' }], expectedLive)).toEqual([
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 131072, input: ['text'] },
      { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct' },
      { id: 'deepseek-ai/DeepSeek-V3.1' },
      { id: 'Qwen/Qwen2.5-VL-7B-Instruct:cheapest', contextWindow: 32768, input: ['text', 'image'] },
      { id: 'Qwen/Qwen2.5-VL-7B-Instruct', contextWindow: 32768, input: ['text', 'image'] },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', input: ['text'] },
    ])
  })
})

describe('resolveProfiles with modelsEndpoint', () => {
  it('materializes the live list into the route, image input only where the router says so', () => {
    const route = resolveProfiles({ huggingface: hfProfile() }, provider => provider === 'huggingface' ? expectedLive : undefined)
      .get('huggingface')!
    const models = route.piProvider.getModels()
    expect(models.map(model => model.id)).toEqual([
      ...SEEDS.map(seed => seed.id),
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
    ])
    const byId = new Map(models.map(model => [model.id, model]))
    expect(byId.get('openai/gpt-oss-120b')?.contextWindow).toBe(131072)
    expect(byId.get('Qwen/Qwen2.5-VL-7B-Instruct')?.input).toEqual(['text', 'image'])
    expect(byId.get('meta-llama/Llama-3.1-8B-Instruct')?.input).toEqual(['text'])
  })

  it('falls back to the seeds when discovery has nothing', () => {
    const route = resolveProfiles({ huggingface: hfProfile() }, () => undefined).get('huggingface')!
    expect(route.piProvider.getModels().map(model => model.id)).toEqual(SEEDS.map(seed => seed.id))
  })

  it('refuses the flag on a protocol with no readable listing', () => {
    expect(() => resolveProfiles({ gw: hfProfile({ api: 'anthropic-messages' }) }))
      .toThrow(/modelsEndpoint/)
  })
})

describe('PiAiAdapter with a live route', () => {
  function adapter(refresh = vi.fn(() => Promise.resolve())) {
    const live = new LiveModelCache({ fetch: () => Promise.resolve(jsonResponse(200, listing)) })
    const providers = { huggingface: hfProfile() }
    const instance = new PiAiAdapter({
      profiles: () => resolveProfiles(providers, provider => live.models(provider)),
      resolveApiKey: () => Promise.resolve(TOKEN),
      auth: memoryAuth(),
      liveModels: {
        refresh: async (provider) => {
          await refresh(provider)
          await live.refresh(provider, { baseURL: ROUTER, apiKey: () => Promise.resolve(TOKEN) })
        },
        describe: (provider, model) => live.describe(provider, model),
      },
    })
    return { instance, refresh }
  }

  it('refreshes before listing and describes live models', async () => {
    const { instance, refresh } = adapter()
    const models = await instance.listModels('huggingface')
    expect(refresh).toHaveBeenCalledWith('huggingface')
    const gpt = models.find(model => model.id === 'openai/gpt-oss-120b')
    expect(gpt?.description).toBe('131K context · tools · via groq, cerebras')
    expect(models.find(model => model.id === 'Qwen/Qwen2.5-VL-7B-Instruct')?.inputModalities).toEqual(['text', 'image'])
    expect(gpt?.inputModalities).toEqual(['text'])
  })

  it('resolves a suffixed id from its base model and a typed unlisted id from route defaults', async () => {
    const { instance } = adapter()
    await instance.listModels('huggingface')
    const suffixed = await instance.resolveModel('huggingface', 'openai/gpt-oss-120b:cheapest')
    expect(suffixed.id).toBe('openai/gpt-oss-120b:cheapest')
    expect(suffixed.context.contextWindow).toBe(131072)
    const typed = await instance.resolveModel('huggingface', 'someorg/unlisted-model:groq')
    expect(typed.id).toBe('someorg/unlisted-model:groq')
    expect(typed.inputModalities).toEqual(['text'])
    await expect(instance.resolveModel('huggingface', 'not-an-id')).rejects.toMatchObject({ failure: { code: 'UNKNOWN_MODEL' } })
  })
})

describe('llm-pi-ai plugin with a live route', () => {
  it('lists the router models through the seam and maps a 402 on the chat call', async () => {
    const server = await mockServer([
      { status: 200, body: JSON.stringify(listing) },
      { status: 402, body: JSON.stringify({ error: 'You have exceeded your monthly included credits' }) },
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { huggingface: hfProfile({ baseURL: `${server.url}/v1` }) } })
    const models = await ctx.llm.listModels('huggingface')
    expect(models.map(model => model.id)).toContain('meta-llama/Llama-3.1-8B-Instruct')
    expect(server.paths[0]).toBe('/v1/models')
    expect(server.headers[0]?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(server.paths[0]).not.toContain(TOKEN)

    const result = await assemble(ctx, { provider: 'huggingface', model: 'openai/gpt-oss-120b:cheapest', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error' })
    const failure = (result.finish as { failure: { message: string } }).failure
    expect(failure.message.startsWith('[huggingface:credits]')).toBe(true)
    expect((server.requests[1] as { model?: string }).model).toBe('openai/gpt-oss-120b:cheapest')
  })
})
