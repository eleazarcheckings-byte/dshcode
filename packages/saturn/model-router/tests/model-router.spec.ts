/** Deployment-wide model tiering over a real (in-memory) settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import ModelRouterService, {
  MODEL_ROUTER_SETTINGS_NAMESPACE,
  packageResolvable,
} from '../src/index.ts'

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

async function boot(): Promise<{ ctx: Context; router: ModelRouterService }> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(ModelRouterService, {})
  return { ctx, router: ctx.modelRouter }
}

describe('packageResolvable', () => {
  it('is true when the resolver resolves the specifier', () => {
    const resolver = { resolve: () => '/anywhere/index.js' } as unknown as NodeJS.Require
    expect(packageResolvable(resolver, '@deepseek-ai/dsh-subagent-codex')).toBe(true)
  })

  it('is false when the resolver throws (the package is not installed)', () => {
    const resolver = {
      resolve: () => { throw new Error('Cannot find module') },
    } as unknown as NodeJS.Require
    expect(packageResolvable(resolver, '@deepseek-ai/dsh-subagent-codex')).toBe(false)
  })
})

describe('ModelRouterService', () => {
  it('registers the saturn-model-router namespace with every tier at "default" and harnesses off', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.get(MODEL_ROUTER_SETTINGS_NAMESPACE)).toEqual({
      tiers: { coordinator: 'default', specialist: 'default', bulk: 'default', vision: 'default' },
      externalHarnesses: false,
    })
    await bench.ctx.fiber.dispose()
  })

  it('resolves a "default" tier to the packaged fallback when no agent default model is mounted', async () => {
    const bench = await boot()
    expect(bench.router.resolve('specialist')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    await bench.ctx.fiber.dispose()
  })

  it('follows agentDefaultModel for a "default" tier once one is mounted', async () => {
    const bench = await boot()
    await bench.ctx.plugin(AgentDefaultModelConfig, { provider: 'acme-gateway', model: 'acme-large' })
    expect(bench.router.resolve('coordinator')).toEqual({ provider: 'acme-gateway', model: 'acme-large' })

    await bench.ctx.agentDefaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-think', reasoningEffort: 'high' as never })
    expect(bench.router.resolve('coordinator')).toEqual({ provider: 'acme-gateway', model: 'acme-think', reasoningEffort: 'high' })
    await bench.ctx.fiber.dispose()
  })

  it('an explicit tier override wins over agentDefaultModel and survives a live settings update', async () => {
    const bench = await boot()
    await bench.ctx.plugin(AgentDefaultModelConfig, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await bench.ctx.settings.update(MODEL_ROUTER_SETTINGS_NAMESPACE, {
      tiers: { bulk: { provider: 'llm-pi-ai', model: 'gpt-5-mini', reasoningEffort: 'low' } },
    })
    expect(bench.router.resolve('bulk')).toEqual({ provider: 'llm-pi-ai', model: 'gpt-5-mini', reasoningEffort: 'low' })
    // Untouched tiers stay at 'default' and keep following the agent default model.
    expect(bench.router.resolve('vision')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await bench.ctx.fiber.dispose()
  })

  it('externalHarnessesEnabled and externalHarnessMounted follow the settings toggle, never the toggle alone', async () => {
    const bench = await boot()
    expect(bench.router.externalHarnessesEnabled()).toBe(false)
    // Whatever this environment's real package resolution says, mounting never
    // fires from the toggle alone: it is always `enabled && available`.
    expect(bench.router.externalHarnessMounted('codex')).toBe(false)

    await bench.ctx.settings.update(MODEL_ROUTER_SETTINGS_NAMESPACE, { externalHarnesses: true })
    expect(bench.router.externalHarnessesEnabled()).toBe(true)
    // Real-environment resolution, not an injected fake: whatever this checkout's
    // actual two-stage probe (wrapper package, then its CLI dependency resolved
    // FROM the wrapper) reports is what mounting must agree with — this pins
    // externalHarnessMounted to harnessAvailable's real answer without assuming
    // which way that answer goes. The case where the two stages disagree (wrapper
    // resolves, CLI dependency absent) is covered with injected resolvers in
    // tests/harness-cli-resolution.spec.ts, where the true/false split is fixed
    // and deterministic rather than dependent on what happens to be installed.
    expect(bench.router.externalHarnessMounted('codex')).toBe(bench.router.harnessAvailable('codex'))
    await bench.ctx.fiber.dispose()
  })
})
