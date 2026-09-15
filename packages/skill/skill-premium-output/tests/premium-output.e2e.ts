import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { foldRequestHeader, type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { PREMIUM_OUTPUT_POLICY } from '../src/policy.ts'
import { FIRST_ARTIFACT } from './fixtures/first-artifact.ts'

async function logs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? logs(path) : Promise.resolve(entry.name.endsWith('.jsonl') ? [path] : [])
  }))).flat()
}

describe('premium output through the shipped Headless Loader profile', () => {
  const guides = [
    ['premium-web-experience', 'loaded-web-guide.md'],
    ['purposeful-motion', 'loaded-motion-guide.md'],
    ['premium-deliverables', 'loaded-deliverables-guide.md'],
  ] as const
  const guideCases = guides.flatMap(([guide, snapshot]) => ['native', 'ptc'].map(mode => ({ guide, snapshot, mode })))
  it.each(guideCases)('persists the policy and full $guide result in $mode mode', async ({ guide, snapshot, mode }) => {
    let events: SessionEvent[] = []
    const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
    await runLoaderSmoke({
      label: `premium output ${mode}`, tempDirPrefix: 'dsh-premium-output-',
      binScript: driver, libBinScript: driver,
      configPath: fileURLToPath(new URL('./fixtures/quality.patch.yml', import.meta.url)),
      tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      env: { DSH_TOOLS_MODE: mode, DSH_TELEMETRY_DISABLED: '1', DSH_QUALITY_SCENARIO: 'guide', DSH_QUALITY_GUIDE: guide },
      inspect: async (cwd) => {
        const paths = await logs(join(cwd, '.sessions'))
        expect(paths).toHaveLength(1)
        const lines = (await readFile(paths[0]!, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    const header = foldRequestHeader(events)
    expect(header?.system).toContain(PREMIUM_OUTPUT_POLICY)
    expect(header?.system).toContain('load the relevant available skill')
    expect(header?.config).toMatchObject({ provider: 'quality-mock', model: 'quality-mock' })
    const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    const result = results[0]!.data.message.content.find(block => block.type === 'tool-result')
    expect(result?.isError).toBe(false)
    const body = await readFile(new URL(`../skills/${guide}/SKILL.md`, import.meta.url), 'utf8')
    const visible = result?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    if (mode === 'native') {
      expect(visible).toContain(body)
      const stable = visible.replace(/Base directory for this skill:.*$/m, 'Base directory for this skill: <packaged-skill-directory>')
      await expect(stable).toMatchFileSnapshot(`./expected/${snapshot}`)
    } else {
      expect(visible).toContain(JSON.stringify(body).slice(1, -1))
      expect(header?.tools?.map(tool => tool.name)).toEqual(['run_code'])
    }
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.each(['native', 'ptc'])('retains the first saved artifact after a later response truncates in %s mode', async (mode) => {
    let events: SessionEvent[] = []
    const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
    await runLoaderSmoke({
      label: `premium artifact retention ${mode}`, tempDirPrefix: 'dsh-premium-retention-',
      binScript: driver, libBinScript: driver,
      configPath: fileURLToPath(new URL('./fixtures/quality.patch.yml', import.meta.url)),
      tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      env: { DSH_TOOLS_MODE: mode, DSH_TELEMETRY_DISABLED: '1', DSH_QUALITY_SCENARIO: 'retained-artifact' },
      inspect: async (cwd) => {
        expect(await readFile(join(cwd, 'checkpoint.html'), 'utf8')).toBe(FIRST_ARTIFACT)
        await expect(readFile(join(cwd, 'unfinished.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
        const paths = await logs(join(cwd, '.sessions'))
        expect(paths).toHaveLength(1)
        events = (await readFile(paths[0]!, 'utf8')).trimEnd().split('\n').slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(foldRequestHeader(events)?.system).toContain(PREMIUM_OUTPUT_POLICY)
    const calls = events.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call')
    expect(calls.map(event => event.data.name)).toEqual(mode === 'native' ? ['skill', 'write', 'read'] : ['run_code', 'run_code', 'run_code'])
    const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(3)
    expect(results.every(event => event.data.message.content.some(block => block.type === 'tool-result' && !block.isError))).toBe(true)
    expect(events.filter(event => event.type === 'step/start')).toHaveLength(4)
    const ended = events.filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
    expect(ended.map(event => event.data.reason)).toEqual([{ kind: 'max-tokens' }])
    const messages = events.filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(messages.at(-1)?.data.message.content.some(block => block.type === 'tool-call')).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
