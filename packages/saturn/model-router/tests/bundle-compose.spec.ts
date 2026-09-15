/**
 * Static composition proof: the base bundle mounts this package and the
 * curated `llm-pi-ai` profiles, the web bundle gates the two native harness
 * provider rows on the exact check this package exposes, and the `cordis`
 * preset's tool rows gate on the same check. These are YAML-shape
 * assertions (parse + `!!js` interpolation) rather than a real package
 * mount, mirroring `packages/bundle/base/tests/base.spec.ts` and
 * `packages/preset/agent-presets/tests/shipped-root.spec.ts`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'

interface PatchRow {
  id?: string
  name?: string
  disabled?: unknown
  config?: unknown
}

const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BASE_PATCH = join(PACKAGES_ROOT, 'bundle', 'base', 'cordis.patch.yml')
const WEB_APP_PATCH = join(PACKAGES_ROOT, 'bundle', 'web-app', 'cordis.patch.yml')
const CORDIS_PRESET = join(PACKAGES_ROOT, 'preset', 'agent-presets', 'presets', 'cordis', 'agent.cordis.yml')

/** Flatten a patch file's `insert` blocks and nested `cordis:group` configs (bare top-level rows too) into one row list. */
function rowsOf(parsed: unknown): PatchRow[] {
  if (!Array.isArray(parsed)) throw new TypeError('patch file must parse to a list')
  const rows: PatchRow[] = []
  const visit = (entries: unknown[]): void => {
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue
      const candidate = entry as { insert?: PatchRow[]; config?: unknown } & PatchRow
      if (Array.isArray(candidate.insert)) {
        visit(candidate.insert)
        continue
      }
      rows.push(candidate)
      if (Array.isArray(candidate.config)) visit(candidate.config)
    }
  }
  visit(parsed)
  return rows
}

async function loadRows(path: string): Promise<PatchRow[]> {
  const source = await readFile(path, 'utf8')
  return rowsOf(yaml.load(source, { schema: entryListSchema }))
}

function findRow(rows: PatchRow[], id: string): PatchRow | undefined {
  return rows.find(row => row.id === id)
}

describe('base bundle: model-router + curated llm-pi-ai profiles', () => {
  it('mounts @saturnai/dsh-model-router', async () => {
    const rows = await loadRows(BASE_PATCH)
    expect(findRow(rows, 'model-router')).toMatchObject({ name: '@saturnai/dsh-model-router' })
  })

  it('pre-populates six keyless catalog routes and two hand-declared local routes', async () => {
    const rows = await loadRows(BASE_PATCH)
    const piAi = findRow(rows, 'llm-pi-ai')
    expect(piAi).toMatchObject({ name: '@deepseek-ai/dsh-llm-pi-ai' })
    const providers = (piAi?.config as { providers?: Record<string, unknown> } | undefined)?.providers
    expect(providers).toBeDefined()
    const catalogRoutes = ['anthropic', 'openai', 'google', 'xai', 'moonshotai', 'zai']
    for (const route of catalogRoutes) {
      expect(providers, route).toHaveProperty(route)
      // Keyless by omission: no apiKeyEnv, so the route defers to pi-ai's own
      // provider-native ambient discovery instead of failing as unconfigured.
      expect(providers![route], route).not.toHaveProperty('apiKeyEnv')
    }
    for (const route of ['ollama-local', 'lm-studio-local']) {
      const profile = providers![route] as { api?: string; baseURL?: string; models?: unknown[] }
      expect(profile, route).toMatchObject({ api: 'openai-completions' })
      expect(typeof profile.baseURL, route).toBe('string')
      expect(Array.isArray(profile.models) && profile.models.length > 0, route).toBe(true)
    }
  })
})

describe('web bundle: native harness providers self-hide behind the router', () => {
  it('gates subagent-codex and subagent-claude-code on externalHarnessMounted', async () => {
    const rows = await loadRows(WEB_APP_PATCH)
    for (const [id, packageName, harness] of [
      ['subagent-codex', '@deepseek-ai/dsh-subagent-codex', 'codex'],
      ['subagent-claude-code', '@deepseek-ai/dsh-subagent-claude-code', 'claude-code'],
    ] as const) {
      const row = findRow(rows, id)
      if (row === undefined) throw new Error(`web-app bundle must mount ${id}`)
      expect(row.name, id).toBe(packageName)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      // Absent modelRouter (a composition that omits it): stays hidden, never throws.
      expect(interpolate({ get: () => undefined }, { __jsExpr: expression }), `${id}: no modelRouter`).toBe(true)
      // modelRouter present but the check false: still hidden.
      expect(
        interpolate({ get: () => ({ externalHarnessMounted: () => false }) }, { __jsExpr: expression }),
        `${id}: mounted() false`,
      ).toBe(true)
      // modelRouter present and the check true for THIS harness only: mounts.
      expect(
        interpolate({
          get: () => ({ externalHarnessMounted: (name: string) => name === harness }),
        }, { __jsExpr: expression }),
        `${id}: mounted() true`,
      ).toBe(false)
    }
  })
})

describe('cordis preset: native harness tool rows follow the same gate', () => {
  it('gates tool-subagent-codex and tool-subagent-claude-code on externalHarnessMounted, not a hardcoded true', async () => {
    const rows = await loadRows(CORDIS_PRESET)
    for (const [id, harness] of [
      ['tool-subagent-codex', 'codex'],
      ['tool-subagent-claude-code', 'claude-code'],
    ] as const) {
      const row = findRow(rows, id)
      if (row === undefined) throw new Error(`cordis preset must carry ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression, not a literal true`)
      expect(
        interpolate({
          get: () => ({ externalHarnessMounted: (name: string) => name === harness }),
        }, { __jsExpr: expression }),
        `${id}: mounted() true`,
      ).toBe(false)
      expect(
        interpolate({ get: () => undefined }, { __jsExpr: expression }),
        `${id}: no modelRouter`,
      ).toBe(true)
    }
  })
})
