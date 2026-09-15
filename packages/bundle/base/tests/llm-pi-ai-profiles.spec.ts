/**
 * Real-composition proof for the curated `llm-pi-ai` profiles the base
 * bundle now pre-populates: the exact config parsed out of
 * `cordis.patch.yml` mounts a real `dsh-llm-pi-ai` adapter over a real (in-
 * memory) settings provider, and every curated route actually lists models —
 * catching a typo'd provider id or a malformed hand-declared route the
 * YAML-shape checks in `base.spec.ts` cannot.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'

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

/** The exact `llm-pi-ai` row config the base bundle ships, read straight from the patch file. */
function curatedLlmPiAiConfig(): LlmPiAi.Config {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  const rows = (parsed as { insert?: { id?: string; config?: unknown }[] }[]).flatMap(patch => patch.insert ?? [])
  const row = rows.find(candidate => candidate.id === 'llm-pi-ai')
  if (row === undefined) throw new Error('base patch must mount llm-pi-ai')
  return row.config as LlmPiAi.Config
}

async function harness(config: LlmPiAi.Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(LlmPiAi, config)
  return ctx
}

describe('the base bundle\'s curated llm-pi-ai profiles', () => {
  it('lists models for every keyless catalog route', async () => {
    const ctx = await harness(curatedLlmPiAiConfig())
    for (const route of ['anthropic', 'openai', 'google', 'xai', 'moonshotai', 'zai']) {
      const models = await ctx.llm.listModels(route)
      expect(models.length, route).toBeGreaterThan(0)
    }
    await ctx.fiber.dispose()
  })

  it('lists the declared placeholder model for each hand-declared local route', async () => {
    const ctx = await harness(curatedLlmPiAiConfig())
    expect((await ctx.llm.listModels('ollama-local')).map(model => model.id)).toEqual(['llama3.1'])
    expect((await ctx.llm.listModels('lm-studio-local')).map(model => model.id)).toEqual(['local-model'])
    await ctx.fiber.dispose()
  })

  it('leaves every curated route unauthenticated (configured-but-keyless, never MISSING_CREDENTIAL at mount)', async () => {
    // Mounting alone must not throw: a keyless route only fails a real
    // request, and only then with MISSING_CREDENTIAL — never at composition.
    const ctx = await harness(curatedLlmPiAiConfig())
    for (const route of ['anthropic', 'openai', 'google', 'xai', 'moonshotai', 'zai', 'ollama-local', 'lm-studio-local']) {
      await expect(ctx.llm.listModels(route)).resolves.toBeDefined()
    }
    await ctx.fiber.dispose()
  })
})
