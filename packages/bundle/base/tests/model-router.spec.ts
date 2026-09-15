/**
 * Composition-level proof for SPEC §3 C6 items the base bundle owns:
 * `@saturnai/dsh-model-router` is mounted, and a fresh install's permission
 * default is `workspace-write` + `ask` (with `danger-full-access` staying an
 * explicit user choice, never a default).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

interface PatchRow {
  id?: string
  name?: string
  disabled?: unknown
  config?: unknown
}

function baseRows(): PatchRow[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  return (parsed as { insert?: PatchRow[] }[]).flatMap(patch => patch.insert ?? [])
}

describe('dsh-base bundle: model-router', () => {
  it('mounts @saturnai/dsh-model-router', () => {
    const row = baseRows().find(candidate => candidate.id === 'model-router')
    expect(row).toMatchObject({ name: '@saturnai/dsh-model-router' })
  })
})

describe('dsh-base bundle: fresh-install permission default', () => {
  it('pins sandbox-policy to workspace-write unless DSH_PERMISSION_MODE overrides it', () => {
    const row = baseRows().find(candidate => candidate.id === 'sandbox-policy')
    const expression = ((row?.config as { mode?: { __jsExpr?: string } } | undefined)?.mode)?.__jsExpr
    if (expression === undefined) throw new TypeError('sandbox-policy.config.mode must be a !!js expression')
    expect(evaluate({ process: { env: {} } }, expression)).toBe('workspace-write')
    expect(evaluate({ process: { env: { DSH_PERMISSION_MODE: 'danger-full-access' } } }, expression)).toBe('danger-full-access')
  })

  it('pins approval to ask unless the mode is explicitly danger-full-access', () => {
    const row = baseRows().find(candidate => candidate.id === 'approval')
    const expression = ((row?.config as { policy?: { __jsExpr?: string } } | undefined)?.policy)?.__jsExpr
    if (expression === undefined) throw new TypeError('approval.config.policy must be a !!js expression')
    expect(evaluate({ process: { env: {} } }, expression)).toBe('ask')
    expect(evaluate({ process: { env: { DSH_PERMISSION_MODE: 'workspace-write' } } }, expression)).toBe('ask')
    // danger-full-access is reachable only by an explicit deployment env var —
    // never the default a fresh install starts at.
    expect(evaluate({ process: { env: { DSH_PERMISSION_MODE: 'danger-full-access' } } }, expression)).toBe('never')
  })
})
