/**
 * The Host half of the onboarding settings namespaces: the real `apply` entry
 * has to register every namespace a Client store binds, because
 * `settings.describe` lists the settings service's REGISTRATIONS. An
 * unregistered namespace is absent from the describe view, so the bound scope
 * derives its terminal `unavailable` state instead of ever answering.
 *
 * This is the seam no other suite covered. `first-light-seal.host.spec.ts`
 * registers `ui-first-light` itself, and every Client store test fakes the
 * describe answer, so the shipped plugin could fail to register the namespace
 * with both suites still green -- which is exactly the defect that shipped a
 * First Light dialog stuck on its "needs the settings document" error branch,
 * with Retry unable to recover. Booting the real entry makes that failure
 * impossible to reintroduce silently.
 *
 * Faces: this file carries the `.client.` marker because the Host aggregate
 * excludes client sources (its `exclude` lists client `src`, and `tsconfig`
 * refuses a program file reached only through an import), so the Host entry of
 * a split client package is reachable solely from the Client program. The
 * subject under test is still the Host half.
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** Every namespace the real Host entry registers, in registration order. */
function bootHostEntry(): { namespace: string; schema: unknown }[] {
  const registrations: { namespace: string; schema: unknown }[] = []
  const settings = {
    register: (namespace: string, schema: unknown): void => {
      registrations.push({ namespace, schema })
    },
  }
  const ctx = {
    inject: (dependencies: string[], run: (settingsCtx: unknown) => void): void => {
      expect(dependencies).toEqual(['settings'])
      run({ settings })
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  return registrations
}

describe('the onboarding settings namespaces on the Host', () => {
  it('registers the First Light namespace the setup sequence binds', () => {
    expect(bootHostEntry().map(entry => entry.namespace)).toEqual([
      'ui-onboarding',
      'ui-first-light',
    ])
  })

  it('declares every durable field First Light writes and reads back', () => {
    const firstLight = bootHostEntry().find(entry => entry.namespace === 'ui-first-light')
    expect(firstLight).toBeDefined()
    const described = JSON.stringify((firstLight!.schema as { toJSON: () => unknown }).toJSON())
    for (const field of ['complete', 'profile', 'name', 'building', 'language', 'voice', 'tone']) {
      expect(described).toContain(`"${field}"`)
    }
  })
})
