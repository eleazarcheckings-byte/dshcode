/** Real Loader + durable settings + production MCP transport, with only the remote server scripted. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { stringify } from 'yaml'
import { afterEach, expect, it } from 'vitest'
import DesignBrain from '../src/index.ts'
import { startBrainFixture } from './http-fixture.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function harness(options: { profileDisabled?: boolean; timeout?: number } = {}) {
  const fixture = await startBrainFixture()
  cleanup.push(fixture.close)
  const directory = await mkdtemp(join(tmpdir(), 'saturn-design-brain-'))
  cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const ctx = new Context()
  const loader = ctx.plugin(Loader)
  await loader
  cleanup.push(async () => { await loader.dispose() })
  Object.assign(ctx.loader.builtins, { 'brain-tools': Tools, 'brain-prompt': SystemPrompt, 'brain-settings': SettingsFile, 'brain-connector': DesignBrain, 'brain-include': Include, 'brain-mcp': mcpClient })
  const path = join(directory, 'cordis.yml')
  const settings = join(directory, 'settings.yaml')
  const rows = [
    { id: 'prompt', name: 'cordis:brain-prompt' },
    { id: 'tools', name: 'cordis:brain-tools' },
    { id: 'settings', name: 'cordis:brain-settings', config: { path: settings, watch: false } },
    { id: 'brain', name: 'cordis:brain-connector', config: { endpoint: fixture.url, connectTimeoutMs: options.timeout ?? 2000 } },
    ...(options.profileDisabled === undefined ? [] : [{ id: 'existing-saturn', name: options.profileDisabled ? '@deepseek-ai/dsh-mcp-client' : 'cordis:brain-mcp', disabled: options.profileDisabled, config: { serverName: 'saturnai', transport: 'streamable-http', url: `${fixture.url}?private=value` } }]),
  ]
  await writeFile(path, stringify(rows))
  const boot = async () => {
    await ctx.loader.root.update([{ id: 'composition', name: 'cordis:brain-include', config: { path: pathToFileURL(path).href } }])
    await ctx.loader.await()
    const mounted = ctx.loader.resolve('composition').fiber!
    cleanup.push(async () => { await mounted.dispose() })
    return mounted
  }
  const mounted = await boot()
  return { ctx, fixture, path, settings, mounted, boot }
}

it('keeps fresh profiles offline, connects real tools, dispatches, persists opt-in across reboot, and removes tools on opt-out', async () => {
  const h = await harness()
  expect(h.fixture.requests).toBe(0)
  expect(h.ctx.designBrain.status().state).toBe('disabled')
  expect((await h.ctx.systemPrompt.assemble()).sections.some(section => section.name === 'saturn:design-brain' && section.text.length > 0)).toBe(false)
  // A fresh, never-opted-in profile registers no tool at all — not even design_study_references —
  // so it never pays a tool-schema token cost for a feature it hasn't turned on.
  expect(h.ctx.tools.schemas()).toEqual([])
  const connected = await h.ctx.designBrain.connect()
  expect(connected).toMatchObject({ state: 'connected', enabled: true, source: 'managed', issue: 'none', tools: ['mcp__saturnai__compose', 'mcp__saturnai__review'] })
  // design_study_references registers alongside the mcp__saturnai__ tools once opted in, and is
  // torn down with them on disconnect below — it tracks the same opt-in state, not a separate one.
  expect(h.ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([...connected.tools, 'design_study_references'].sort())
  const result = await h.ctx.tools.execute({ callId: ToolCallId('brain-fixture'), name: 'mcp__saturnai__compose', arguments: {}, signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(result.content).toEqual([{ type: 'text', text: 'Executed compose' }])
  expect(h.fixture.calls).toEqual(['compose'])
  const prompt = (await h.ctx.systemPrompt.assemble()).sections.find(section => section.name === 'saturn:design-brain')
  expect(prompt).toMatchSnapshot()
  const restrictedKey = {}
  const restricted = createScope(h.ctx, restrictedKey)
  await restricted.ctx.inject(['tools'], (ctx) => { ctx.tools.restrict({ allow: [] }) })
  expect((await h.ctx.systemPrompt.assemble({ scope: restrictedKey })).sections.find(section => section.name === 'saturn:design-brain')?.text).toBe('')
  await restricted.dispose()
  expect(await readFile(h.settings, 'utf8')).toContain('enabled: true')
  await h.mounted.dispose()
  await h.boot()
  expect(h.ctx.designBrain.status().state).toBe('connected')
  expect(await h.ctx.designBrain.disconnect()).toMatchObject({ state: 'disabled', enabled: false, tools: [] })
  // design_study_references is torn down with the mcp__saturnai__ tools on opt-out.
  expect(h.ctx.tools.schemas()).toEqual([])
  expect((await h.ctx.systemPrompt.assemble()).sections.some(section => section.name === 'saturn:design-brain' && section.text.length > 0)).toBe(false)
  expect(await readFile(h.settings, 'utf8')).toContain('enabled: false')
})

it('reports incomplete tool catalogs honestly and allows a real retry', async () => {
  const h = await harness()
  h.fixture.mode = 'partial'
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'unavailable', issue: 'incomplete-tools', tools: ['mcp__saturnai__compose'] })
  h.fixture.mode = 'ready'
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'connected' })
})

it.each(['hang', 'hang-initialized', 'hang-list'] as const)('bounds a stalled %s handshake stage, cleans it up, and retries without duplicate namespace ownership', async (mode) => {
  const h = await harness({ timeout: 150 })
  h.fixture.mode = mode
  const before = Date.now()
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'unavailable', issue: 'timeout', tools: [] })
  expect(Date.now() - before).toBeLessThan(1500)
  h.fixture.mode = 'ready'
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'connected' })
})

it('preserves an independently disabled profile row without connecting, duplicating, or exposing URL query data', async () => {
  const h = await harness({ profileDisabled: true })
  const original = await readFile(h.path, 'utf8')
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'unavailable', source: 'profile', issue: 'profile-disabled', endpoint: h.fixture.url })
  await expect(h.ctx.designBrain.disconnect()).rejects.toThrow('managed by your profile')
  expect(h.fixture.requests).toBe(0)
  expect(await readFile(h.path, 'utf8')).toBe(original)
  expect([...h.ctx.loader.entries()].filter(entry => entry.options.id === 'existing-saturn')).toHaveLength(1)
})

it('reuses an active profile MCP connection without mounting or changing another row', async () => {
  const h = await harness({ profileDisabled: false })
  const before = await readFile(h.path, 'utf8')
  const requests = h.fixture.requests
  expect(await h.ctx.designBrain.connect()).toMatchObject({ state: 'connected', source: 'profile', tools: ['mcp__saturnai__compose', 'mcp__saturnai__review'] })
  expect(h.fixture.requests).toBe(requests)
  expect(await readFile(h.path, 'utf8')).toBe(before)
  await expect(h.ctx.designBrain.disconnect()).rejects.toThrow('managed by your profile')
})

it('quiesces a pending handshake during owner disposal within the configured deadline', async () => {
  const h = await harness({ timeout: 150 })
  h.fixture.mode = 'hang'
  const connecting = h.ctx.designBrain.connect()
  await expect.poll(() => h.fixture.requests).toBeGreaterThan(0)
  const before = Date.now()
  const rejected = expect(connecting).rejects.toThrow('connector is closed')
  await h.mounted.dispose()
  await rejected
  expect(Date.now() - before).toBeLessThan(1500)
})
