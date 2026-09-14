/**
 * The setup profile's user-global memory mirror: idempotent block replacement
 * on a real file, plus the Remote verb's validation and refusal paths.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import {
  PROFILE_MEMORY_BEGIN, PROFILE_MEMORY_END,
  applyProfileMemoryBlock, profileMemoryPath, renderProfileMemoryBlock, writeProfileMemory,
} from '../src/profile-memory.ts'
import type { ProfileMemoryFacts } from '../src/types.ts'

/** Document path the provider reports; a fresh value per test. */
let documentPath: string | undefined

/** A provider that reports the local document the mirror writes beside. */
class DocumentSettings extends MemorySettings {
  override get documentPath(): string | undefined {
    return documentPath
  }
}

const FACTS: ProfileMemoryFacts = {
  name: 'Izzy',
  building: 'a clothing brand',
  language: 'English',
  tone: 'direct',
  consultDesignBrain: true,
}

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-profile-memory-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  documentPath = undefined
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function boot(): Promise<SettingsController> {
  const ctx = new Context()
  await ctx.plugin(DocumentSettings, {})
  return new SettingsController(ctx)
}

describe('the replaceable block', () => {
  it('renders identity and preferences inside its own markers', () => {
    const block = renderProfileMemoryBlock(FACTS)
    expect(block.startsWith(`${PROFILE_MEMORY_BEGIN}\n`)).toBe(true)
    expect(block.trimEnd().endsWith(PROFILE_MEMORY_END)).toBe(true)
    expect(block).toContain('- Name: Izzy')
    expect(block).toContain('- Consult the design brain before inventing UI: yes')
  })

  it('is idempotent: applying the same block twice changes nothing', () => {
    const block = renderProfileMemoryBlock(FACTS)
    const once = applyProfileMemoryBlock(undefined, block)
    const twice = applyProfileMemoryBlock(once, block)
    expect(twice).toBe(once)
  })

  it('appends after hand-written instructions exactly once', () => {
    const block = renderProfileMemoryBlock(FACTS)
    const first = applyProfileMemoryBlock('# House rules\n\nBe brief.\n', block)
    expect(first.startsWith('# House rules\n\nBe brief.\n\n')).toBe(true)
    const second = applyProfileMemoryBlock(first, block)
    expect(second).toBe(first)
    expect(second.match(new RegExp(PROFILE_MEMORY_BEGIN, 'g'))).toHaveLength(1)
  })

  it('replaces a stale block in place and keeps what the user wrote around it', () => {
    const older = renderProfileMemoryBlock({ ...FACTS, name: 'Old Name' })
    const existing = `# House rules\n\n${older}\n## Later notes\n\nkeep me\n`
    const next = applyProfileMemoryBlock(existing, renderProfileMemoryBlock(FACTS))
    expect(next).toContain('# House rules')
    expect(next).toContain('## Later notes')
    expect(next).toContain('keep me')
    expect(next).toContain('- Name: Izzy')
    expect(next).not.toContain('Old Name')
    expect(next.match(new RegExp(PROFILE_MEMORY_BEGIN, 'g'))).toHaveLength(1)
    expect(next.match(new RegExp(PROFILE_MEMORY_END, 'g'))).toHaveLength(1)
  })

  it('creates the file beside the settings document and rewrites it in place', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.yaml')
    await writeFile(file, 'ui-first-light: {}\n', 'utf8')
    expect(profileMemoryPath(file)).toBe(join(dir, 'AGENTS.md'))

    const first = await writeProfileMemory(file, FACTS)
    expect(first.path).toBe(join(dir, 'AGENTS.md'))
    expect(await readFile(first.path, 'utf8')).toContain('- Name: Izzy')

    const second = await writeProfileMemory(file, { ...FACTS, name: 'Eleazar' })
    const text = await readFile(second.path, 'utf8')
    expect(text).toContain('- Name: Eleazar')
    expect(text).not.toContain('- Name: Izzy')
    expect(text.match(new RegExp(PROFILE_MEMORY_BEGIN, 'g'))).toHaveLength(1)
    // The settings document itself is untouched: memory is a mirror, never a
    // second writer of the configuration file.
    expect(await readFile(file, 'utf8')).toBe('ui-first-light: {}\n')
  })
})

describe('the settings.writeProfileMemory verb', () => {
  it('writes the block and reports the path it wrote', async () => {
    const dir = await tempDir()
    documentPath = join(dir, 'settings.yaml')
    const controller = await boot()
    const written = await controller.writeProfileMemory(FACTS)
    expect(written.path).toBe(join(dir, 'AGENTS.md'))
    expect(await readFile(written.path, 'utf8')).toContain('- Building: a clothing brand')
  })

  it('refuses a blank required field instead of rendering "undefined"', async () => {
    documentPath = join(await tempDir(), 'settings.yaml')
    const controller = await boot()
    await expect(controller.writeProfileMemory({ ...FACTS, name: '   ' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('says why a deployment with no local document cannot hold a profile', async () => {
    documentPath = undefined
    const controller = await boot()
    const raised = await controller.writeProfileMemory(FACTS).then(
      () => undefined,
      (error: unknown) => error,
    )
    const failure = remoteErrorOf(raised)
    expect(failure?.code).toBe('gateway/internal')
    expect(failure?.message).toContain('no memory file')
  })
})
