/**
 * Real defect coverage for Mars r1 finding F1: `harnessAvailable()` must gate
 * on the harness's own platform CLI dependency (resolved from INSIDE the
 * subagent package's module graph), not merely on whether the subagent
 * wrapper package itself resolves. A wrapper that resolves but whose CLI
 * dependency failed to install (or was never declared) must still report
 * "not available" — the previous unit test at model-router.spec.ts:103
 * asserted `externalHarnessMounted('codex') === harnessAvailable('codex')`,
 * which is tautological and cannot catch this.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import ModelRouterService, {
  harnessCliResolvable,
} from '../src/index.ts'

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

/** A fake two-stage resolver: `outer` locates a package's manifest, `inner` resolves from inside it. */
function fakeResolver(outerOk: boolean, innerOk: boolean): {
  resolver: NodeJS.Require
  createRequireFn: (path: string) => NodeJS.Require
} {
  const resolver = {
    resolve: (specifier: string) => {
      if (!outerOk) throw new Error(`Cannot find module '${specifier}'`)
      return `/fake/node_modules/${specifier.replace('/package.json', '')}/package.json`
    },
  } as unknown as NodeJS.Require
  const createRequireFn = (_path: string): NodeJS.Require => ({
    resolve: (specifier: string) => {
      if (!innerOk) throw new Error(`Cannot find module '${specifier}' from the subagent package`)
      return `/fake/node_modules/${specifier}/index.js`
    },
  } as unknown as NodeJS.Require)
  return { resolver, createRequireFn }
}

describe('harnessCliResolvable', () => {
  it('is false when the subagent wrapper package itself does not resolve', () => {
    const { resolver, createRequireFn } = fakeResolver(false, true)
    expect(harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-codex', '@openai/codex', createRequireFn)).toBe(false)
  })

  it('is false when the wrapper resolves but its CLI dependency does not — the wrapper-only false positive', () => {
    const { resolver, createRequireFn } = fakeResolver(true, false)
    expect(harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-codex', '@openai/codex', createRequireFn)).toBe(false)
  })

  it('is true only when both the wrapper and its CLI dependency resolve', () => {
    const { resolver, createRequireFn } = fakeResolver(true, true)
    expect(harnessCliResolvable(resolver, '@deepseek-ai/dsh-subagent-codex', '@openai/codex', createRequireFn)).toBe(true)
  })
})

describe('ModelRouterService.externalHarnessMounted — real gate, not the toggle alone', () => {
  // `ctx.plugin(ModelRouterService, config)` only ever forwards `(ctx, config)`
  // to the constructor (vendor/cordis/src/registry.ts `Fiber` construction), so
  // the extra `resolver`/`createRequireFn` test-injection parameters cannot
  // reach the instance through `ctx.plugin`. `Service`'s own constructor
  // (vendor/cordis/src/service.ts) registers the instance on `ctx` directly via
  // `ctx.reflect.provide`, independent of the plugin/fiber machinery, so
  // constructing directly is the correct way to inject these for a test.
  it('stays false with externalHarnesses ON when the wrapper resolves but the CLI dependency does not', async () => {
    const ctx = new Context()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const { resolver, createRequireFn } = fakeResolver(true, false)
    new ModelRouterService(ctx, {}, resolver, createRequireFn)
    await ctx.settings.update('saturn-model-router', { externalHarnesses: true })

    expect(ctx.modelRouter.externalHarnessesEnabled()).toBe(true)
    expect(ctx.modelRouter.harnessAvailable('codex')).toBe(false)
    expect(ctx.modelRouter.externalHarnessMounted('codex')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('mounts with externalHarnesses ON only when both the wrapper and its CLI dependency resolve', async () => {
    const ctx = new Context()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const { resolver, createRequireFn } = fakeResolver(true, true)
    new ModelRouterService(ctx, {}, resolver, createRequireFn)
    await ctx.settings.update('saturn-model-router', { externalHarnesses: true })

    expect(ctx.modelRouter.harnessAvailable('codex')).toBe(true)
    expect(ctx.modelRouter.externalHarnessMounted('codex')).toBe(true)
    await ctx.fiber.dispose()
  })
})
