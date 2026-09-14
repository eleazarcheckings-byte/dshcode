/**
 * First Light's durable seal on a real settings file. The gate itself lives in
 * the Client store, but what keeps it closed across a restart is the Host: the
 * seal has to reach the `ui-first-light` section of the real settings file, and
 * a fresh boot against that file has to read it back equal to the version.
 * Coverage elsewhere fakes the wire or stays in the client's memory mode, which
 * cannot prove either hop — so this boots the real `FileSettingsProvider`
 * against a temp document and drives the real `settings.mutate` path.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import FileSettingsProvider from '../../../settings/settings-file/src/index.ts'
import SettingsController from '../src/index.ts'

const NS = 'ui-first-light'

/**
 * The sealed section's shape as the provider stores it. The Client store reads
 * the same three fields (`packages/client/ui-settings-models/src/client/first-light-store.ts`);
 * the two type programs cannot import each other, so the contract is restated.
 */
const FirstLight = z.object({
  complete: z.string(),
  profile: z.object({
    name: z.string(),
    building: z.string(),
    language: z.string(),
  }),
  voice: z.object({ tone: z.string() }),
})

/**
 * The version the seal compares for exact equality. Mirrors
 * `FIRST_LIGHT_VERSION` in `packages/client/ui-settings-models/src/onboarding-copy.ts`;
 * the host aggregate cannot import a Client source file, so the literal is the
 * durable contract the Host actually writes.
 */
const SEALED_VERSION = '2026-09-14.1'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-first-light-seal-'))
  tempDirs.push(dir)
  return dir
}

/** Boot the real file provider and controller over one settings document. */
async function boot(file: string): Promise<{ ctx: Context; controller: SettingsController }> {
  const ctx = new Context()
  await ctx.plugin(FileSettingsProvider, { path: file, watch: false })
  ctx.settings.register(NS, FirstLight)
  await ctx.plugin(SettingsController)
  return { ctx, controller: ctx.settingsController }
}

/** The `ui-first-light` view of one describe answer, or undefined. */
function sectionOf(controller: SettingsController): Record<string, unknown> | undefined {
  return controller.describe().namespaces.find(view => view.ns === NS)?.value as
    | Record<string, unknown>
    | undefined
}

describe('the First Light seal on a real settings file', () => {
  it('writes the seal to disk and reads it back sealed on a fresh boot', async () => {
    const file = join(await tempDir(), 'settings.yaml')

    const first = await boot(file)
    const written = await first.controller.mutate(NS, [
      { op: 'set', path: ['profile'], value: { name: 'Izzy', building: 'brands', language: 'en' } },
      { op: 'set', path: ['voice'], value: { tone: 'direct' } },
      { op: 'set', path: ['complete'], value: SEALED_VERSION },
    ], undefined)
    expect(written.value).toMatchObject({
      complete: SEALED_VERSION,
      profile: { name: 'Izzy', building: 'brands', language: 'en' },
      voice: { tone: 'direct' },
    })
    await first.ctx.fiber.dispose()

    // On disk, not merely in the writing process's memory: an unsealed
    // document is what would replay setup after a restart.
    const text = await readFile(file, 'utf8')
    expect(text).toContain(SEALED_VERSION)
    expect(text).toContain('Izzy')
    expect(text).toContain('direct')

    // A fresh boot is the remount: the gate reads its evidence from this file,
    // so a seal that survived means the sequence cannot re-open.
    const second = await boot(file)
    expect(sectionOf(second.controller)).toEqual({
      complete: SEALED_VERSION,
      profile: { name: 'Izzy', building: 'brands', language: 'en' },
      voice: { tone: 'direct' },
    })
    await second.ctx.fiber.dispose()
  })

  it('leaves a section without the seal unsealed on a fresh boot', async () => {
    const file = join(await tempDir(), 'settings.yaml')
    await writeFile(file, `${NS}:\n  profile:\n    name: Izzy\n`, 'utf8')

    const { ctx, controller } = await boot(file)
    expect(sectionOf(controller)?.complete).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
