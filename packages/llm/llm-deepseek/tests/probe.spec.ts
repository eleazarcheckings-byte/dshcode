/**
 * First Light probe: the `llm-deepseek` discovery must be a real authenticated
 * request, not a catalog read, and each failure must map onto the honest
 * plain-language answer the model step shows. These tests boot the real
 * `LlmRuntime` + `LlmDeepSeek` composition against a scripted HTTP stand-in, so
 * the assertion is about the wire the product actually sends.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { closeMockServers, mockServer } from './mock-server.ts'

const NS = 'llm-deepseek'
const PROVIDER = 'deepseek-official'

vi.stubGlobal('fetch', fetch)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-probe-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Boot just the runtime and the plugin under test; key resolution rides the stub env. */
async function boot(dir: string, config: object): Promise<Context> {
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, config)
  return ctx
}

describe('first-light deepseek probe', () => {
  it('performs one authenticated chat request and returns the catalog', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'probe-key')
    const dir = await home()
    const server = await mockServer([{ kind: 'sse', events: [] }])
    const ctx = await boot(dir, { baseURL: server.url })

    const models = await ctx.llm.discoverModels(NS, { provider: PROVIDER })

    expect(models).toHaveLength(3)
    expect(server.requests).toHaveLength(1)
    const request = server.requests[0] as { model: string; max_tokens: number; stream: boolean }
    expect(request.model).toMatch(/flash/i)
    expect(request.max_tokens).toBe(1)
    expect(request.stream).toBe(false)
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
  })

  it('prefers a key typed on the request over the stored credential', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'stored-key')
    const dir = await home()
    const server = await mockServer([{ kind: 'sse', events: [] }])
    const ctx = await boot(dir, { baseURL: server.url })

    await ctx.llm.discoverModels(NS, { provider: PROVIDER, apiKey: 'typed-key' })

    expect(server.headers[0]?.authorization).toBe('Bearer typed-key')
  })

  it('maps a rejected key onto INVALID_CREDENTIAL without echoing the key', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'super-secret-key')
    const dir = await home()
    const server = await mockServer([{ kind: 'http-error', status: 401, body: '{}' }])
    const ctx = await boot(dir, { baseURL: server.url })

    const failure = await ctx.llm.discoverModels(NS, { provider: PROVIDER }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'INVALID_CREDENTIAL' })
    expect((failure as Error).message).toContain('API key')
    expect((failure as Error).message).not.toContain('super-secret-key')
  })

  it('maps a rate limit onto RATE_LIMIT', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'probe-key')
    const dir = await home()
    const server = await mockServer([{ kind: 'http-error', status: 429, body: '{}' }])
    const ctx = await boot(dir, { baseURL: server.url })

    await expect(ctx.llm.discoverModels(NS, { provider: PROVIDER }))
      .rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('maps a provider outage onto PROBE_UNAVAILABLE', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'probe-key')
    const dir = await home()
    const server = await mockServer([{ kind: 'http-error', status: 503, body: '{}' }])
    const ctx = await boot(dir, { baseURL: server.url })

    await expect(ctx.llm.discoverModels(NS, { provider: PROVIDER }))
      .rejects.toMatchObject({ code: 'PROBE_UNAVAILABLE' })
  })

  it('maps an unreachable endpoint onto PROBE_UNREACHABLE', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'probe-key')
    const dir = await home()
    const ctx = await boot(dir, { baseURL: 'http://127.0.0.1:9' })

    await expect(ctx.llm.discoverModels(NS, { provider: PROVIDER }))
      .rejects.toMatchObject({ code: 'PROBE_UNREACHABLE' })
  })

  it('refuses before the network when no key can be resolved', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const dir = await home()
    const server = await mockServer([{ kind: 'sse', events: [] }])
    const ctx = await boot(dir, { baseURL: server.url })

    await expect(ctx.llm.discoverModels(NS, { provider: PROVIDER }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(server.requests).toHaveLength(0)
  })
})
