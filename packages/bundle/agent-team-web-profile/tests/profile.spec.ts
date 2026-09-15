/** The Web bundle must carry one parseable Team Client layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('Agent Teams Web profile bundle', () => {
  it('declares a publishable parseable layer containing the Team UI', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    // A release member: publishable, never private, with public access stated
    // explicitly because the dsh family shares one publish path.
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@saturnai/dsh-client-ui-agent-team': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as { insert?: { id?: string; name?: string }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([
      { id: 'ui-agent-team', name: '@saturnai/dsh-client-ui-agent-team' },
    ])
    // The shipped Web bundle owns the same id, so a stock Web profile must not
    // also add this layer: the Loader rejects a repeated explicit id.
    const shippedWebPatch = resolve(root, '..', 'web-app', 'cordis.patch.yml')
    expect(readFileSync(shippedWebPatch, 'utf8')).toContain("name: '@saturnai/dsh-client-ui-agent-team'")
  })
})
