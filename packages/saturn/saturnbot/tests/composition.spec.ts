/** Real Loader, Session persistence, SQLite, and tool dispatch; only the provider is scripted. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it } from 'vitest'
import { stringify } from 'yaml'
import SaturnBotService from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it('boots the shipped host services, persists the request before dispatch, executes a role tool, and replays its report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saturnbot-composition-'))
  cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const ctx = new Context()
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    'bot-test-sessions': SessionStore, 'bot-test-persistence': JsonlPersistence,
    'bot-test-subprocess': LocalSubprocess, 'bot-test-llm': LlmRuntime, 'bot-test-host': SaturnBotService,
  })
  const path = join(directory, 'cordis.yml')
  await writeFile(path, stringify([
    { id: 'sessions', name: 'cordis:bot-test-sessions' },
    { id: 'persistence', name: 'cordis:bot-test-persistence', config: { root: join(directory, 'sessions'), compression: 'none' } },
    { id: 'subprocess', name: 'cordis:bot-test-subprocess' },
    { id: 'llm', name: 'cordis:bot-test-llm' },
    { id: 'saturnbot', name: 'cordis:bot-test-host', config: { dataDirectory: join(directory, 'bot') } },
  ]))
  const composition = await ctx.plugin(Include, { path: pathToFileURL(path).href })
  cleanup.push(async () => { await composition.dispose() })
  const durableBeforeDispatch: string[] = []
  const deliveredQuality: unknown[] = []
  class DurableAdapter extends MockAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const raw = await ctx.sessionPersistence.readRaw(options.sessionId!)
      if (raw === undefined) throw new Error('Request was not durably stored before dispatch')
      expect(raw.content).toContain('saturnbot/model-request')
      expect(raw.content).not.toContain('saturnbot/model-result')
      const request = ctx.sessions.get(options.sessionId!)?.events.find(event => event.type === 'saturnbot/model-request')
      if (request?.type !== 'saturnbot/model-request') throw new Error('Missing request projection')
      expect(JSON.stringify(options.messages)).toContain(JSON.stringify(request.data.prompt).slice(1, -1))
      const body = JSON.parse(request.data.prompt.split('Execution context (JSON data):\n\n')[1]!) as { outputQuality: unknown }
      deliveredQuality.push({ role: request.data.role, criteria: body.outputQuality })
      yield* super.stream(options)
    }
  }
  const adapter = new DurableAdapter([
    (options) => {
      const session = ctx.sessions.get(options.sessionId!)
      const request = session?.events.find(event => event.type === 'saturnbot/model-request')
      expect(request?.type).toBe('saturnbot/model-request')
      if (request?.type === 'saturnbot/model-request') durableBeforeDispatch.push(request.data.prompt)
      return textResponse(JSON.stringify({ summary: 'Retain the approved support focus.', tasks: [{ role: 'operations', title: 'Remember support focus', instruction: 'Save the support focus in durable memory.' }] }))
    },
    [
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'PRIVATE_FIXTURE_REASONING' },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'PRIVATE_FIXTURE_REASONING' } },
      ...textResponse(JSON.stringify({ summary: 'Store the support focus for future cycles.', actions: [{ tool: 'memory.write', input: { key: 'support-focus', value: 'Help users finish onboarding.' } }] })),
    ],
  ])
  ctx.llm.registerAdapter(['fixture'], adapter)
  const initial = await ctx.saturnbot.snapshot()
  expect(initial.status).toBe('needs-setup')
  expect(initial.config.enabled).toBe(false)
  await ctx.saturnbot.configure({
    workspace: directory, goal: 'Improve onboarding support.', provider: 'fixture', model: 'fixture',
    allowedTools: ['memory.search', 'memory.write'],
  })
  const accepted = await ctx.saturnbot.runNow()
  expect(accepted.activeCycle).not.toBeNull()
  await expect.poll(async () => (await ctx.saturnbot.snapshot()).cycles[0]?.status).toBe('completed')
  expect(await ctx.saturnbot.memory('support-focus')).toMatchObject([{ key: 'support-focus', value: 'Help users finish onboarding.' }])
  expect(adapter.requests).toHaveLength(2)
  expect(deliveredQuality).toMatchSnapshot('role delivery criteria recorded before provider dispatch')
  expect(durableBeforeDispatch[0]).toContain('Improve onboarding support.')
  for (const request of adapter.requests) {
    const raw = await ctx.sessionPersistence.readRaw(request.sessionId!)
    if (raw === undefined) throw new Error('Missing durable model record')
    expect(raw.content).toContain('saturnbot/model-request')
    expect(raw.content).toContain('saturnbot/model-result')
    expect(raw.content).toContain('Execution context (JSON data)')
    expect(raw.content).not.toContain('PRIVATE_FIXTURE_REASONING')
  }
  const state = await ctx.saturnbot.snapshot()
  expect(state.firstRun).toEqual({ goal: 'Improve onboarding support.', workspace: directory, provider: 'fixture', credentials: [] })
  expect(state.integrationCatalog.map(entry => entry.name)).toEqual(expect.arrayContaining(['telegram', 'shopify', 'vercel', 'cloudflare-pages']))
  expect(state.reports).toHaveLength(2)
  expect(state.messages.some(message => message.role === 'operations' && message.sender === 'agent')).toBe(true)
  const report = state.reports[0]!
  expect(await readFile(join(directory, 'bot', 'reports', `${report.date}.md`), 'utf8')).toContain('Remember support focus')
  expect((await ctx.saturnbot.events(0)).events.some(event => event.type === 'trace' && event.trace.kind === 'tool-result' && event.trace.tool === 'memory.write')).toBe(true)
  expect(state.cycles.map(cycle => ({ status: cycle.status, plan: cycle.plan, branches: cycle.branches.map(branch => ({ role: branch.task.role, status: branch.status, actions: branch.actions.map(action => action.tool) })) })) ).toMatchInlineSnapshot(`
    [
      {
        "branches": [
          {
            "actions": [
              "memory.write",
            ],
            "role": "operations",
            "status": "completed",
          },
        ],
        "plan": "Retain the approved support focus.",
        "status": "completed",
      },
    ]
  `)
  await composition.dispose()
  const reboot = await ctx.plugin(Include, { path: pathToFileURL(path).href })
  cleanup.push(async () => { await reboot.dispose() })
  expect((await ctx.saturnbot.snapshot()).reports[0]?.id).toBe(report.id)
  expect(await ctx.saturnbot.memory('support-focus')).toHaveLength(1)
})
