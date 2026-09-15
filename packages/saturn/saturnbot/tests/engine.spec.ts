import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { SaturnBotEngine } from '../src/engine.ts'
import { SaturnBotStore } from '../src/store.ts'
import { parseBotConfig, parseBotYaml } from '../src/config.ts'
import type { BotModel, BotTool, BotToolContext } from '../src/contracts.ts'
import type { BotConfig, BotCycle, BotId, BotRole } from '../src/types.ts'

const roots: string[] = []
const engines: SaturnBotEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})
const defaultModel: BotModel = {
  plan: async () => ({ summary: 'Review work', tasks: [{ role: 'operations', title: 'Inbox', instruction: 'Review inbox' }] }),
  propose: async () => ({ summary: 'Nothing requires action.', actions: [] }),
}
function tool(name: string, effect: BotTool['effect'], execute: BotTool['execute'], roles: BotRole[] = ['operations']): BotTool {
  return { name, effect, execute, roles, retry: 'never', description: name, input: z.object({}).strict() }
}
async function setup(tools: BotTool[] = [], model: BotModel = defaultModel, config: Partial<BotConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'saturnbot-core-'))
  roots.push(root)
  const store = new SaturnBotStore(root)
  const engine = new SaturnBotEngine({ store, model, tools })
  engines.push(engine)
  await engine.initialize()
  await engine.configure({ workspace: root, goal: 'Improve support', ...config })
  return { root, store, engine }
}
async function run(engine: SaturnBotEngine) { await engine.runNow(); await engine.waitForIdle(); return engine.snapshot() }

describe('strict deployment configuration', () => {
  it('requires setup before enabling and refuses secret values or executable YAML tags', () => {
    expect(() => parseBotConfig({ enabled: true })).toThrow('goal and workspace')
    expect(() => parseBotConfig({ workspace: 'relative' })).toThrow('absolute')
    expect(() => parseBotConfig({ integrations: { email: { token: 'literal-secret' } } })).toThrow()
    expect(() => parseBotConfig({ integrations: { email: { credentialEnv: 'literal-secret' } } })).toThrow()
    expect(() => parseBotConfig({ integrations: { email: { endpoint: 'https://user:pass@example.com' } } })).toThrow()
    expect(() => parseBotYaml('goal: missing version')).toThrow('version')
    expect(() => parseBotYaml('version: 1\ngoal: !execute whoami')).toThrow()
    expect(() => parseBotYaml('version: 1\ngoal: &a hi\nworkspace: *a')).toThrow()
    expect(parseBotYaml('version: 1\nintegrations:\n  email:\n    credentialEnv: GRAPH_TOKEN').integrations.email).toEqual({ credentialEnv: 'GRAPH_TOKEN' })
  })

  it('refuses a literal vercel/cloudflare-pages deploy-hook endpoint; only endpointEnv may resolve the hook URL', () => {
    expect(() => parseBotConfig({ integrations: { vercel: { endpoint: 'https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y' } } })).toThrow('endpointEnv')
    expect(() => parseBotConfig({ integrations: { 'cloudflare-pages': { endpoint: 'https://api.cloudflare.com/hook' } } })).toThrow('endpointEnv')
    expect(parseBotConfig({ integrations: { vercel: { endpointEnv: 'SATURN_VERCEL_DEPLOY_HOOK_URL' } } }).integrations.vercel).toEqual({ endpointEnv: 'SATURN_VERCEL_DEPLOY_HOOK_URL' })
  })
})

describe('deploy-hook secrets never reach the journal', () => {
  it('rejects configuring a literal hook URL before any journal write, and never journals the resolved secret', async () => {
    const { engine, store } = await setup()
    await expect(engine.configure({ integrations: { vercel: { endpoint: 'https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y' } } })).rejects.toThrow('endpointEnv')
    const rejected = await store.events(0)
    expect(JSON.stringify(rejected.events)).not.toContain('hook_y')
    await engine.configure({ integrations: { vercel: { endpointEnv: 'SATURN_VERCEL_DEPLOY_HOOK_URL' } } })
    const accepted = await store.events(0)
    expect(JSON.stringify(accepted.events)).not.toContain('hook_y')
    expect(JSON.stringify(accepted.events)).toContain('SATURN_VERCEL_DEPLOY_HOOK_URL')
  })
})

describe('durable cycles', () => {
  it('uses recorded read results to decide the next bounded proposal', async () => {
    const read = vi.fn(async () => ({ summary: 'Read incoming request', data: { subject: 'Address change' } }))
    const draft = vi.fn<BotTool['execute']>(async input => ({ summary: 'Saved relevant reply', data: input }))
    const tools = [tool('read', 'read', read), { ...tool('draft', 'draft', draft), input: z.object({ subject: z.string() }).strict() }]
    const propose = vi.fn<BotModel['propose']>(async (_task, context) => {
      const execution = z.object({ proposalRound: z.number(), remainingActions: z.number() }).parse(context.observedState.execution)
      const round = execution.proposalRound
      if (round === 1) return { summary: 'Read the request before drafting.', actions: [{ tool: 'read', input: {} }], continue: true }
      expect(context.observedState.branchResults).toEqual([{ tool: 'read', summary: 'Read incoming request', data: { subject: 'Address change' } }])
      expect(execution.remainingActions).toBe(1)
      const results = z.array(z.object({ data: z.object({ subject: z.string() }) })).parse(context.observedState.branchResults)
      return { summary: 'Drafted an address-change reply.', actions: [{ tool: 'draft', input: { subject: results[0]!.data.subject } }] }
    })
    const { engine } = await setup(tools, { ...defaultModel, propose }, { maxActionsPerTask: 2 })
    const state = await run(engine)
    expect(propose).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledOnce()
    expect(draft).toHaveBeenCalledWith({ subject: 'Address change' }, expect.any(Object))
    expect(state.cycles[0]?.branches[0]?.nextAction).toBe(2)
    expect(state.cycles[0]?.branches[0]?.rounds).toBe(2)
    expect(state.cycles[0]?.branches[0]?.status).toBe('completed')
    expect(state.messages.filter(message => message.role === 'operations').map(message => ({ sender: message.sender, content: message.content }))).toMatchInlineSnapshot(`
      [
        {
          "content": "Read the request before drafting.",
          "sender": "agent",
        },
        {
          "content": "Drafted an address-change reply.",
          "sender": "agent",
        },
      ]
    `)
  })

  it('resumes continuation after a restarted approval without repeating earlier actions', async () => {
    const read = vi.fn(async () => ({ summary: 'Read request', data: { subject: 'Support' } }))
    const send = vi.fn(async () => ({ summary: 'Accepted by mail service', data: { accepted: true } }))
    const tools = [tool('read', 'read', read), tool('send', 'email', send)]
    const propose = vi.fn<BotModel['propose']>(async (_task, context) => {
      const round = z.object({ proposalRound: z.number() }).parse(context.observedState.execution).proposalRound
      if (round === 1) return { summary: 'Review request', actions: [{ tool: 'read', input: {} }], continue: true }
      if (round === 2) return { summary: 'Ask to send', actions: [{ tool: 'send', input: {} }], continue: true }
      const results = z.array(z.object({ tool: z.string() })).parse(context.observedState.branchResults)
      expect(results.map(result => result.tool)).toEqual(['read', 'send'])
      return { summary: 'Mail service accepted the approved reply.', actions: [] }
    })
    const model = { ...defaultModel, propose }
    const { engine, root } = await setup(tools, model, { maxActionsPerTask: 2 })
    const waiting = await run(engine)
    expect(waiting.cycles[0]?.branches[0]?.continue).toBe(true)
    await engine.dispose()
    const restarted = new SaturnBotEngine({ store: new SaturnBotStore(root), model, tools }); engines.push(restarted)
    await restarted.initialize()
    await restarted.approve(waiting.approvals[0]!.id, true); await restarted.waitForIdle()
    expect(read).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce()
    const state = await restarted.snapshot()
    expect(state.cycles[0]?.branches[0]?.rounds).toBe(3)
    expect(state.cycles[0]?.branches[0]?.status).toBe('completed')
  })

  it('halts empty continuation and action-limit loops before further effects', async () => {
    const empty = await setup([], { ...defaultModel, propose: async () => ({ summary: 'Keep thinking', actions: [], continue: true }) })
    expect((await run(empty.engine)).cycles[0]?.branches[0]?.error).toContain('must perform an action')
    const read = vi.fn(async () => ({ summary: 'Read' }))
    const repeated = await setup([tool('read', 'read', read)], { ...defaultModel, propose: async () => ({ summary: 'Keep reading', actions: [{ tool: 'read', input: {} }], continue: true }) }, { maxActionsPerTask: 1 })
    const state = await run(repeated.engine)
    expect(read).toHaveBeenCalledOnce()
    expect(state.cycles[0]?.branches[0]?.error).toContain('total configured action limit')
  })

  it('rejects oversized cumulative state before admitting another effect', async () => {
    const execute = vi.fn(async () => ({ summary: 'Saved isolated artifact' }))
    const tools = [{ ...tool('draft', 'draft', execute), input: z.object({ text: z.string() }).strict() }]
    const { engine } = await setup(tools, { ...defaultModel, propose: async () => ({ summary: 'Large artifact', actions: [{ tool: 'draft', input: { text: 'a'.repeat(600_000) } }], continue: true }) }, { maxInputBytes: 1_048_576 })
    const state = await run(engine)
    expect(execute).toHaveBeenCalledOnce()
    expect(state.cycles[0]?.branches[0]?.actions).toHaveLength(1)
    expect(state.cycles[0]?.branches[0]?.error).toContain('1 MiB execution-state limit')
    expect(state.cycles[0]?.branches[0]?.status).toBe('failed')
  })

  it('evaluates allowed read feeds before the planner and provides exact JSON tool parameters', async () => {
    const feed = { ...tool('inbox', 'read', async () => ({ summary: 'Unread support', data: { count: 2 } }), ['orchestrator', 'operations']), evaluationInput: {} }
    const plan = vi.fn<BotModel['plan']>(async (context) => {
      expect(context.observedState.inbox).toEqual({ summary: 'Unread support', data: { count: 2 } })
      expect(context.tools[0]!.parameters).toMatchObject({ type: 'object' })
      return { summary: 'Wait for user context.', tasks: [] }
    })
    const { engine, root } = await setup([feed], { ...defaultModel, plan })
    const state = await run(engine)
    expect(plan).toHaveBeenCalledOnce()
    expect(state.cycles[0]?.status).toBe('completed')
    expect(state.cycles[0]?.branches).toHaveLength(0)
    expect(state.reports.map(report => report.title)).toEqual(expect.arrayContaining(['Cycle report', expect.stringContaining('Daily digest')]))
    expect(await readFile(join(root, 'reports', `${state.cycles[0]!.startedAt.slice(0, 10)}.md`), 'utf8')).toContain('Wait for user context.')
  })

  it('retries safe tools twice, redacts errors, and lets another branch finish', async () => {
    vi.stubEnv('SATURN_TEST_TOKEN', 'private-api-credential')
    const failure = vi.fn(async () => { throw new Error('Bearer private-api-credential upstream failed') })
    const succeeded = vi.fn(async () => ({ summary: 'Campaign draft stored' }))
    const tools = [{ ...tool('inbox', 'read', failure), retry: 'safe' as const }, tool('draft', 'draft', succeeded, ['growth'])]
    const model: BotModel = {
      plan: async () => ({ summary: 'Two branches', tasks: [{ role: 'operations', title: 'Support', instruction: 'Review support' }, { role: 'growth', title: 'Draft', instruction: 'Write copy' }] }),
      propose: async task => ({ summary: `Propose ${task.role}`, actions: [{ tool: task.role === 'operations' ? 'inbox' : 'draft', input: {} }] }),
    }
    const { engine, root } = await setup(tools, model, { integrations: { email: { credentialEnv: 'SATURN_TEST_TOKEN' } } })
    const state = await run(engine)
    expect(failure).toHaveBeenCalledTimes(2)
    expect(succeeded).toHaveBeenCalledOnce()
    expect(state.cycles[0]?.branches.map(branch => branch.status)).toEqual(['failed', 'completed'])
    expect(state.alerts[0]?.message).toContain('[redacted]')
    expect(await readFile(join(root, 'events.jsonl'), 'utf8')).not.toContain('private-api-credential')
    const facts = (await engine.events()).events.filter(event => event.type === 'trace').map(event => ({ kind: event.trace.kind, tool: event.trace.tool ?? null, attempt: event.trace.attempt ?? null }))
    expect(facts.filter(fact => fact.tool === 'inbox')).toEqual([
      { kind: 'tool-start', tool: 'inbox', attempt: 1 }, { kind: 'tool-error', tool: 'inbox', attempt: 1 },
      { kind: 'tool-start', tool: 'inbox', attempt: 2 }, { kind: 'tool-error', tool: 'inbox', attempt: 2 },
    ])
  })

  it('rejects role escalation and malformed proposals before any action executes', async () => {
    const allowed = vi.fn(async () => ({ summary: 'Read' }))
    const denied = vi.fn(async () => ({ summary: 'Sent' }))
    const tools = [tool('read', 'read', allowed), tool('deploy', 'deploy', denied, ['developer'])]
    const { engine } = await setup(tools, { ...defaultModel, propose: async () => ({ summary: 'Escalate', actions: [{ tool: 'read', input: {} }, { tool: 'deploy', input: {} }] }) })
    const state = await run(engine)
    expect(state.cycles[0]?.branches[0]?.error).toContain('not allowed')
    expect(allowed).not.toHaveBeenCalled()
    expect(denied).not.toHaveBeenCalled()
    const current = state.config
    await expect(engine.configure({ roles: { ...current.roles, operations: { ...current.roles.operations, tools: ['deploy'] } } })).rejects.toThrow('cannot be granted')
  })

  it('persists approvals and resumes them once after a fresh engine starts', async () => {
    const send = vi.fn(async () => ({ summary: 'Sent once' }))
    const tools = [tool('email.send', 'email', send)]
    const model: BotModel = { ...defaultModel, propose: async () => ({ summary: 'Reply ready', actions: [{ tool: 'email.send', input: {} }] }) }
    const { engine, root } = await setup(tools, model)
    const state = await run(engine)
    const approval = state.approvals[0]!
    expect(send).not.toHaveBeenCalled()
    expect(state.status).toBe('awaiting-approval')
    await expect(engine.configure({ autoDispatchEmail: true })).rejects.toThrow('pending cycle')
    await engine.dispose()
    const restarted = new SaturnBotEngine({ store: new SaturnBotStore(root), model, tools }); engines.push(restarted)
    await restarted.initialize()
    await restarted.approve(approval.id, true); await restarted.waitForIdle()
    expect(send).toHaveBeenCalledOnce()
    expect((await restarted.snapshot()).approvals[0]?.status).toBe('consumed')
    await expect(restarted.approve(approval.id, true)).rejects.toThrow('no longer pending')
    const events = (await restarted.events()).events
    const consumed = events.findIndex(event => event.type === 'approval' && event.approval.status === 'consumed')
    const dispatched = events.findIndex(event => event.type === 'trace' && event.trace.kind === 'tool-start' && event.trace.tool === 'email.send')
    expect(consumed).toBeLessThan(dispatched)
  })

  it('never retries an uncertain external send and does not replay it after restart', async () => {
    const send = vi.fn(async () => { throw new Error('Connection lost after send request') })
    const tools = [tool('email.send', 'email', send)]
    const model: BotModel = { ...defaultModel, propose: async () => ({ summary: 'Reply', actions: [{ tool: 'email.send', input: {} }] }) }
    const { engine, root } = await setup(tools, model, { autoDispatchEmail: true })
    await run(engine); expect(send).toHaveBeenCalledOnce()
    await engine.dispose()
    const restarted = new SaturnBotEngine({ store: new SaturnBotStore(root), model, tools }); engines.push(restarted)
    await restarted.initialize()
    expect(send).toHaveBeenCalledOnce()
    expect((await restarted.snapshot()).cycles[0]?.status).toBe('failed')
  })

  it('requires the exact validated stage before opening a publication approval', async () => {
    const publish = vi.fn(async () => ({ summary: 'PR created' }))
    const tools = [tool('stage', 'stage', async () => ({ summary: 'Staged', stage: { path: '/stage', revision: 'rev-1' } }), ['developer']), tool('validate', 'validate', async () => ({ summary: 'Checked', validatedRevision: 'rev-1' }), ['developer']), tool('pr', 'pr', publish, ['developer'])]
    const model: BotModel = { ...defaultModel, propose: async () => ({ summary: 'Change ready', actions: [{ tool: 'stage', input: {} }, { tool: 'validate', input: {} }, { tool: 'pr', input: {} }] }) }
    const { engine } = await setup(tools, model, { validationCommands: [['node', '--version']] })
    await engine.message('developer', 'Fix the bug'); await engine.waitForIdle()
    const state = await engine.snapshot()
    expect(state.approvals[0]?.stage?.revision).toBe('rev-1')
    expect(publish).not.toHaveBeenCalled()
    await engine.approve(state.approvals[0]!.id, true); await engine.waitForIdle()
    expect(publish).toHaveBeenCalledOnce()

    const invalid = await setup(tools, { ...model, propose: async () => ({ summary: 'Skip checks', actions: [{ tool: 'stage', input: {} }, { tool: 'pr', input: {} }] }) }, { validationCommands: [['node', '--version']] })
    await invalid.engine.message('developer', 'Publish unchecked'); await invalid.engine.waitForIdle()
    expect((await invalid.engine.snapshot()).cycles[0]?.branches[0]?.error).toContain('successful configured validation')
    expect((await invalid.engine.snapshot()).approvals).toHaveLength(0)
    expect(publish).toHaveBeenCalledOnce()
  })

  it('rejects overlapping messages, preserves the standing goal, and pauses without cancelling work', async () => {
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { finish = resolve })
    let signal!: AbortSignal
    const execute = async (_input: unknown, context: BotToolContext) => { signal = context.signal; entered(); await gate; return { summary: 'Saved draft' } }
    const tools = [tool('draft', 'draft', execute)]
    const { engine, root } = await setup(tools, { ...defaultModel, propose: async () => ({ summary: 'Drafting your reply', actions: [{ tool: 'draft', input: {} }] }) }, { enabled: true })
    await engine.message('operations', 'Draft a warm reply'); await started
    await expect(engine.message('operations', 'A duplicate')).rejects.toThrow('already running')
    const peer = new SaturnBotEngine({ store: new SaturnBotStore(root), model: defaultModel, tools }); engines.push(peer)
    await expect(peer.initialize()).rejects.toThrow('already running')
    const paused = await engine.pause()
    expect(paused.config.enabled).toBe(false)
    expect(paused.status).toBe('running')
    expect(signal.aborted).toBe(false)
    finish(); await engine.waitForIdle()
    const final = await engine.snapshot()
    expect(final.config.goal).toBe('Improve support')
    expect(final.messages.filter(message => message.sender === 'user').map(message => message.content)).toEqual(['Draft a warm reply'])
    expect(final.messages.find(message => message.role === 'operations' && message.sender === 'agent')?.content).toBe('Drafting your reply')
    expect(final.cycles[0]?.status).toBe('completed')
  })

  it('awaits tool cancellation and leaves no busy lease after cancel', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    let settled = false
    const tools = [tool('wait', 'read', async (_input, context) => {
      entered()
      await new Promise<void>((resolve) =>{  context.signal.addEventListener('abort', () => { setTimeout(() => { settled = true; resolve() }, 20) }, { once: true }) })
      return { summary: 'Stopped' }
    })]
    const { engine, store } = await setup(tools, { ...defaultModel, propose: async () => ({ summary: 'Waiting', actions: [{ tool: 'wait', input: {} }] }) })
    await engine.runNow(); await started
    await engine.cancel()
    expect(settled).toBe(true)
    expect((await engine.snapshot()).cycles[0]?.status).toBe('interrupted')
    const release = await store.acquireLease(); await release()
  })

  it('recovers an interrupted tool start without replaying an effect', async () => {
    const execute = vi.fn(async () => ({ summary: 'Effect' }))
    const { engine, store, root } = await setup([tool('send', 'email', execute)])
    const cycle: BotCycle = { id: 'cycle-crash' as BotId, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', plan: 'Crash', branches: [{ id: 'branch-crash' as BotId, task: { id: 'task-crash' as BotId, role: 'operations', title: 'Send', instruction: 'Send' }, status: 'running', summary: '', actions: [{ tool: 'send', input: {} }], nextAction: 0, continue: false, rounds: 1, stage: null, validatedRevision: null, error: null }] }
    const release = await store.acquireLease()
    await store.append({ type: 'cycle', cycle })
    await store.append({ type: 'trace', trace: { cycleId: cycle.id, branchId: cycle.branches[0]!.id, kind: 'tool-start', tool: 'send', summary: 'Dispatch send' } })
    await release(); await engine.dispose()
    const restarted = new SaturnBotEngine({ store: new SaturnBotStore(root), model: defaultModel, tools: [tool('send', 'email', execute)] }); engines.push(restarted)
    await restarted.initialize()
    expect((await restarted.snapshot()).cycles[0]?.branches[0]?.status).toBe('interrupted')
    expect(execute).not.toHaveBeenCalled()
  })

  it('invalidates pending approval after a deliberate YAML policy edit', async () => {
    const tools = [tool('send', 'email', async () => ({ summary: 'Sent' }))]
    const model: BotModel = { ...defaultModel, propose: async () => ({ summary: 'Ready', actions: [{ tool: 'send', input: {} }] }) }
    const { engine, root, store } = await setup(tools, model)
    await run(engine); await engine.dispose()
    const yaml = await readFile(store.configPath, 'utf8')
    await writeFile(store.configPath, yaml.replace('autoDispatchEmail: false', 'autoDispatchEmail: true'))
    const restarted = new SaturnBotEngine({ store: new SaturnBotStore(root), model, tools }); engines.push(restarted)
    await restarted.initialize()
    const state = await restarted.snapshot()
    expect(state.approvals[0]?.status).toBe('interrupted')
    expect(state.cycles[0]?.status).toBe('interrupted')
  })
})

describe('report channel delivery', () => {
  it('invokes a registered non-inbox delivery on cycle settlement, and only alerts when the channel has no delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'saturnbot-report-'))
    roots.push(root)
    const store = new SaturnBotStore(root)
    const delivered: { title: string; markdown: string }[] = []
    const engine = new SaturnBotEngine({
      store, model: defaultModel, tools: [],
      reportDeliveries: { telegram: async (_config, report) => { delivered.push(report) } },
    })
    engines.push(engine)
    await engine.initialize()
    await engine.configure({ workspace: root, goal: 'Improve support', reportChannel: 'telegram' })
    await run(engine)
    expect(delivered).toHaveLength(1)
    const settled = await engine.snapshot()
    expect(settled.alerts.some(alert => alert.message.includes('is not configured'))).toBe(false)

    await engine.configure({ reportChannel: 'unregistered-channel' })
    await run(engine)
    const after = await engine.snapshot()
    expect(after.alerts.some(alert => alert.message.includes('"unregistered-channel" is not configured by this runtime'))).toBe(true)
    expect(delivered).toHaveLength(1)
  })

  it('keeps the inbox report when a configured delivery throws, and alerts with a bounded message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'saturnbot-report-fail-'))
    roots.push(root)
    const store = new SaturnBotStore(root)
    const engine = new SaturnBotEngine({
      store, model: defaultModel, tools: [],
      reportDeliveries: { telegram: async () => { throw new Error('Telegram report delivery returned HTTP 500.') } },
    })
    engines.push(engine)
    await engine.initialize()
    await engine.configure({ workspace: root, goal: 'Improve support', reportChannel: 'telegram' })
    await run(engine)
    const settled = await engine.snapshot()
    expect(settled.reports.length).toBeGreaterThan(0)
    expect(settled.alerts.some(alert => alert.message.includes('delivery failed'))).toBe(true)
  })
})
