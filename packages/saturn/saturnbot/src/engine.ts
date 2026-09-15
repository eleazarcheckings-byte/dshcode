/** Durable, permission-checked business cycles with independent specialist branches. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { BOT_ROLES, botToolResultSchema, parseBotConfig } from './config.ts'
import { SaturnBotAgent, SaturnBotOrchestrator } from './agents.ts'
import { BotBusyError, SaturnBotStore } from './store.ts'
import type { BotModel, BotModelContext, BotTool, BotToolResult } from './contracts.ts'
import type { BotApproval, BotBranch, BotConfig, BotCycle, BotEventPage, BotId, BotJson, BotRole, BotSnapshot, BotTask, ToolProposal } from './types.ts'

/** One report-channel delivery: send an already-composed digest, or throw with a safe message. */
export type BotReportDelivery = (config: BotConfig, report: { title: string; markdown: string }) => Promise<void>
/** Required adapters; no network or shell implementation is hidden in the engine. */
export interface BotEngineOptions {
  store: SaturnBotStore
  model: BotModel
  tools: readonly BotTool[]
  /** Environment secrets are redacted from; defaults to `process.env`. */
  environment?: Readonly<NodeJS.ProcessEnv>
  /** Non-inbox `reportChannel` deliveries, keyed by channel name. */
  reportDeliveries?: Readonly<Record<string, BotReportDelivery>>
}
const freshId = (): BotId => randomUUID() as BotId
const timestamp = (): string => new Date().toISOString()

/** Remove credential fields, configured environment values, and bearer tokens from observable facts. */
function redacted(value: unknown, config: BotConfig, environment: Readonly<NodeJS.ProcessEnv>): BotJson {
  const secrets = Object.values(config.integrations)
    .map(item => item.credentialEnv === undefined ? undefined : environment[item.credentialEnv])
    .filter((item): item is string => item !== undefined && item.length > 3)
  const clean = (item: unknown, depth: number): BotJson => {
    if (depth > 20) return '[depth limit]'
    if (typeof item === 'string') {
      let text = item.replace(/Bearer\s+[A-Z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      for (const secret of secrets) text = text.split(secret).join('[redacted]')
      return text.slice(0, 16_000)
    }
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'number') return Number.isFinite(item) ? item : null
    if (Array.isArray(item)) return item.slice(0, 200).map(value => clean(value, depth + 1))
    if (typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 200).map(([key, value]) => [key, /authorization|password|secret|token|api[-_]?key/i.test(key) ? '[redacted]' : clean(value, depth + 1)]))
    return null
  }
  return clean(value, 0)
}

/** Abort on timeout and await the adapter's cancellation settlement before returning. */
async function bounded<T>(signal: AbortSignal, milliseconds: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort(new Error('SaturnBot operation timed out')) }, milliseconds)
  timer.unref()
  const combined = AbortSignal.any([signal, timeout.signal])
  try {
    combined.throwIfAborted()
    const result = await operation(combined)
    combined.throwIfAborted()
    return result
  } finally { clearTimeout(timer) }
}

/** One host's execution coordinator; the store lease also excludes other hosts on this directory. */
export class SaturnBotEngine {
  private readonly tools = new Map<string, BotTool>()
  private readonly schemas = new Map<string, BotJson>()
  private readonly planner: SaturnBotOrchestrator
  private running: Promise<void> | null = null
  private controller: AbortController | null = null
  private initializing: Promise<void> | null = null
  private disposed = false
  private nextRunAt: string | null = null
  private readonly store: SaturnBotStore
  private readonly environment: Readonly<NodeJS.ProcessEnv>

  constructor(private readonly options: BotEngineOptions) {
    this.store = options.store
    this.environment = options.environment ?? process.env
    this.planner = new SaturnBotOrchestrator(options.model)
    for (const tool of options.tools) {
      if (this.tools.has(tool.name)) throw new Error(`Duplicate SaturnBot tool ${tool.name}`)
      if (tool.evaluationInput !== undefined && tool.effect !== 'read') throw new Error(`Evaluation tool ${tool.name} must be read-only`)
      this.tools.set(tool.name, tool)
      this.schemas.set(tool.name, z.toJSONSchema(tool.input) as BotJson)
    }
  }

  /** Load configuration and mark crash-interrupted effects without replaying them. */
  async initialize(): Promise<void> {
    this.initializing ??= this.boot()
    return this.initializing
  }
  private async boot(): Promise<void> {
    const release = await this.store.acquireLease()
    try {
      let state = await this.store.snapshot()
      const yaml = await this.store.readConfiguration()
      const changed = yaml !== null && JSON.stringify(yaml) !== JSON.stringify(state.config)
      if (changed) {
        this.validateBindings(yaml)
        await this.store.append({ type: 'configured', config: yaml })
      } else if (state.cursor === 0) {
        const roles = Object.fromEntries(BOT_ROLES.map(role => [role, {
          tools: [...this.tools.values()].filter(tool => tool.roles.includes(role)).map(tool => tool.name),
        }]))
        const config = parseBotConfig({ allowedTools: [...this.tools.keys()], roles })
        await this.store.writeConfiguration(config)
      }
      state = await this.store.snapshot()
      this.validateBindings(state.config)
      for (const cycle of state.cycles) {
        const decidedBranches = new Set(state.approvals.filter(approval => approval.cycleId === cycle.id && approval.status === 'approved').map(approval => approval.branchId))
        if (cycle.status !== 'running' && !(cycle.status === 'awaiting-approval' && (changed || decidedBranches.size > 0))) continue
        for (const branch of cycle.branches) if (branch.status === 'running' || branch.status === 'planning' || ((changed || decidedBranches.has(branch.id)) && branch.status === 'awaiting-approval')) {
          branch.status = 'interrupted'; branch.error = changed ? 'Configuration changed at boot. Review the new policy before starting fresh work.' : 'The previous process stopped during execution. Effects were not replayed.'
        }
        cycle.status = cycle.branches.some(branch => branch.status === 'awaiting-approval') ? 'awaiting-approval' : 'interrupted'
        cycle.finishedAt = cycle.status === 'interrupted' ? timestamp() : null
        await this.store.append({ type: 'cycle', cycle })
        await this.alert(cycle.id, null, 'Recovered an interrupted cycle; inspect its last tool-start before retrying work.')
      }
      for (const approval of state.approvals) {
        const branch = state.cycles.find(cycle => cycle.id === approval.cycleId)?.branches.find(branch => branch.id === approval.branchId)
        if (approval.status === 'approved' || (approval.status === 'pending' && (changed || branch?.status !== 'awaiting-approval'))) await this.store.append({ type: 'approval', approval: { ...approval, status: 'interrupted', decidedAt: timestamp() } })
      }
    } finally { await release() }
  }

  /** Current durable state plus trusted, browser-safe tool metadata.
   * @returns A detached snapshot safe for callers to retain.
   */
  async snapshot(): Promise<BotSnapshot> {
    const state = await this.store.snapshot()
    return {
      ...state, nextRunAt: this.nextRunAt,
      tools: [...this.tools.values()].map(tool => ({
        name: tool.name, description: tool.description, roles: [...tool.roles],
        effect: tool.effect, enabled: state.config.allowedTools.includes(tool.name),
      })),
    }
  }
  /** Cursor-based observable trace without model-private reasoning.
   * @param cursor Last acknowledged journal sequence, or zero for the first page.
   * @returns A bounded page with the next cursor and remaining-page indicator.
   */
  async events(cursor = 0): Promise<BotEventPage> { return this.store.events(cursor) }
  /** Scheduler-owned next scheduled attempt, cleared when the host stops.
   * @param value UTC ISO timestamp, or null when scheduling is disabled.
   */
  setNextRunAt(value: string | null): void { this.nextRunAt = value }

  private validateBindings(config: BotConfig): void {
    for (const name of config.allowedTools) if (!this.tools.has(name)) throw new Error(`Unknown enabled tool ${name}`)
    for (const role of BOT_ROLES) for (const name of config.roles[role].tools) {
      const tool = this.tools.get(name)
      if (tool === undefined || !tool.roles.includes(role)) throw new Error(`Role ${role} cannot be granted tool ${name}`)
    }
  }

  /** Save validated user intent; configuration cannot change underneath an active effect.
   * @param update Top-level configuration fields to replace in current settings.
   * @returns State after durable YAML and journal writes.
   */
  async configure(update: Partial<BotConfig>): Promise<BotSnapshot> {
    await this.initialize()
    if (this.running !== null) throw new BotBusyError()
    const release = await this.store.acquireLease()
    try {
      const state = await this.store.snapshot()
      if (state.activeCycle !== null) throw new Error('Finish or cancel the pending cycle before changing its execution policy')
      const current = state.config
      const config = parseBotConfig({ ...current, ...update })
      this.validateBindings(config)
      await this.store.writeConfiguration(config)
    } finally { await release() }
    return this.snapshot()
  }

  /** Start one background cycle, returning only after durable acceptance.
   * @returns Accepted state; use snapshots or events to observe completion.
   */
  async runNow(): Promise<BotSnapshot> { return this.start() }
  /** Accept a role conversation message only when its execution can start.
   * @param role Enabled recipient role whose tool ceiling applies.
   * @param content User instruction of 1–8000 characters.
   * @returns State after persisting the message and accepting its execution.
   */
  async message(role: BotRole, content: string): Promise<BotSnapshot> {
    if (!BOT_ROLES.includes(role) || typeof content !== 'string' || content.trim() === '' || content.length > 8000) throw new Error('Choose a valid role and a message of 1–8000 characters')
    return this.start({ role, content: content.trim() })
  }

  private async start(message?: { role: BotRole; content: string }): Promise<BotSnapshot> {
    await this.initialize()
    if (this.disposed) throw new Error('SaturnBot host is stopping')
    if (this.running !== null) throw new BotBusyError()
    const release = await this.store.acquireLease()
    let transferred = false
    try {
      const state = await this.store.snapshot()
      if (state.activeCycle !== null) throw new Error('Finish or cancel the cycle awaiting approval before starting another task')
      const config = state.config
      if (config.workspace.trim() === '' || (message === undefined && config.goal.trim() === '')) throw new Error('Configure a workspace and business goal before running SaturnBot')
      const role = message?.role ?? 'orchestrator'
      if (!config.roles[role].enabled) throw new Error(`The ${role} role is disabled`)
      const cycle: BotCycle = { id: freshId(), startedAt: timestamp(), finishedAt: null, status: 'running', plan: '', branches: [] }
      await this.store.append({ type: 'cycle', cycle })
      if (message !== undefined) await this.store.append({ type: 'message', message: { id: freshId(), role, sender: 'user', content: message.content, at: timestamp(), cycleId: cycle.id } })
      const controller = new AbortController()
      this.controller = controller
      transferred = true
      this.running = this.owned(this.executeCycle(cycle, config, controller.signal, message)
        .catch(async (error: unknown) => {
          cycle.status = controller.signal.aborted ? 'interrupted' : 'failed'; cycle.finishedAt = timestamp()
          await this.store.append({ type: 'cycle', cycle })
          await this.alert(cycle.id, null, this.errorText(error, config))
        }), release)
      // A rejected journal write remains visible to waitForIdle/dispose without
      // becoming an unhandled rejection while the UI polls accepted execution.
      void this.running.catch(() => {})
      return await this.snapshot()
    } finally { if (!transferred) await release() }
  }

  private async owned(operation: Promise<void>, release: () => Promise<void>): Promise<void> {
    try { await operation } finally { await release(); this.running = null; this.controller = null }
  }

  private modelContext(
    config: BotConfig, state: BotSnapshot, cycleId: BotId, branchId: BotId | null,
    observedState: Record<string, BotJson>, role: BotRole, signal: AbortSignal,
  ): BotModelContext {
    const tools = [...this.tools.values()].filter(tool => this.allowed(tool, role, config)).map((tool) => {
      const parameters = this.schemas.get(tool.name)
      if (parameters === undefined) throw new Error(`Missing JSON schema for registered tool ${tool.name}`)
      return { name: tool.name, description: tool.description, roles: tool.roles, effect: tool.effect, parameters }
    })
    return { config, state, cycleId, branchId, observedState, signal, tools }
  }
  private allowed(tool: BotTool, role: BotRole, config: BotConfig): boolean {
    return config.roles[role].enabled && tool.roles.includes(role)
      && config.allowedTools.includes(tool.name) && config.roles[role].tools.includes(tool.name)
  }
  private toolFor(action: ToolProposal, role: BotRole, config: BotConfig): BotTool {
    const tool = this.tools.get(action.tool)
    if (tool === undefined || !this.allowed(tool, role, config)) throw new Error(`Role ${role} is not allowed to dispatch ${action.tool}`)
    if (Buffer.byteLength(JSON.stringify(action.input)) > config.maxInputBytes) throw new Error('Tool input exceeds configured size limit')
    tool.input.parse(action.input)
    return tool
  }

  private async executeCycle(
    cycle: BotCycle, config: BotConfig, signal: AbortSignal, message?: { role: BotRole; content: string },
  ): Promise<void> {
    const observedState: Record<string, BotJson> = {}
    const evaluationTools = [...this.tools.values()].filter(tool => this.allowed(tool, 'orchestrator', config))
    await Promise.all(evaluationTools.map(async (tool) => {
      if (tool.evaluationInput === undefined) return
      try {
        const result = await this.dispatch(
          tool, { tool: tool.name, input: tool.evaluationInput }, config, cycle.id, null, 'orchestrator', null, -1, signal,
        )
        observedState[tool.name] = redacted(result, config, this.environment)
      } catch (error) {
        observedState[tool.name] = { error: this.errorText(error, config) }
        await this.alert(cycle.id, null, `State feed ${tool.name}: ${this.errorText(error, config)}`)
      }
    }))
    signal.throwIfAborted()
    let tasks: BotTask[]
    if (message !== undefined && message.role !== 'orchestrator') {
      cycle.plan = message.content
      tasks = [{ id: freshId(), role: message.role, title: message.content.slice(0, 160), instruction: message.content }]
    } else {
      const state = await this.snapshot()
      const planningConfig = message === undefined ? config : { ...config, goal: message.content }
      const plan = await bounded(signal, config.modelTimeoutMs, async modelSignal => this.planner.plan(this.modelContext(planningConfig, state, cycle.id, null, observedState, 'orchestrator', modelSignal)))
      cycle.plan = plan.summary; tasks = plan.tasks
    }
    cycle.branches = tasks.map(task => ({ id: freshId(), task, status: 'planning', summary: '', actions: [], nextAction: 0, continue: true, rounds: 0, stage: null, validatedRevision: null, error: null }))
    await this.store.append({ type: 'cycle', cycle })
    await this.store.append({ type: 'trace', trace: { cycleId: cycle.id, branchId: null, kind: 'plan', summary: cycle.plan } })
    await Promise.all(cycle.branches.map(async (branch) => {
      try {
        await this.runBranch(cycle, branch, config, signal)
      } catch (error) { await this.failBranch(cycle, branch, config, signal, error) }
    }))
    await this.settle(cycle, config)
  }

  private async runBranch(
    cycle: BotCycle, branch: BotBranch, config: BotConfig, signal: AbortSignal, approval?: BotApproval,
  ): Promise<void> {
    for (;;) {
      signal.throwIfAborted()
      if (branch.nextAction < branch.actions.length) {
        await this.executeBranch(cycle, branch, config, signal, approval)
        approval = undefined
        if (branch.status === 'awaiting-approval') return
      }
      if (!branch.continue) { branch.status = 'completed'; await this.store.append({ type: 'cycle', cycle }); return }
      if (branch.rounds >= config.maxActionsPerTask + 1) throw new Error('Specialist exceeded the bounded proposal-round limit')
      branch.status = 'planning'; branch.rounds++
      await this.store.append({ type: 'cycle', cycle })
      const observedState = await this.store.observations(cycle.id, branch.id)
      observedState.execution = {
        remainingActions: config.maxActionsPerTask - branch.actions.length,
        proposalRound: branch.rounds, completedActions: branch.nextAction,
      }
      const state = await this.snapshot()
      const agent = new SaturnBotAgent(branch.task.role, this.options.model)
      const proposal = await bounded(signal, config.modelTimeoutMs, async modelSignal => agent.propose(
        branch.task, this.modelContext(config, state, cycle.id, branch.id, observedState, branch.task.role, modelSignal),
      ))
      if (branch.actions.length + proposal.actions.length > config.maxActionsPerTask) throw new Error('Specialist exceeded the total configured action limit')
      if (proposal.continue && proposal.actions.length === 0) throw new Error('A continuing proposal must perform an action before requesting more model work')
      // Admit the entire proposal before any of its actions can publish effects.
      for (const action of proposal.actions) this.toolFor(action, branch.task.role, config)
      const candidate: BotBranch = { ...branch, summary: proposal.summary, actions: [...branch.actions, ...proposal.actions], continue: proposal.continue ?? false, status: 'running' }
      const candidateCycle = { ...cycle, branches: cycle.branches.map(item => item.id === branch.id ? candidate : item) }
      // Reserve the other half of the event envelope for stage metadata and
      // failure diagnostics added after an effect has already run.
      if (Buffer.byteLength(JSON.stringify(candidateCycle)) > 1_048_576) throw new Error('Cumulative cycle proposals exceed the 1 MiB execution-state limit')
      Object.assign(branch, candidate)
      await this.store.append({ type: 'cycle', cycle })
      await this.store.append({ type: 'message', message: { id: freshId(), role: branch.task.role, sender: 'agent', content: proposal.summary || 'Task proposal ready.', at: timestamp(), cycleId: cycle.id } })
      await this.store.append({ type: 'trace', trace: { cycleId: cycle.id, branchId: branch.id, kind: 'proposal', summary: proposal.summary, data: redacted(proposal, config, this.environment) } })
    }
  }

  private needsApproval(tool: BotTool, config: BotConfig): boolean {
    return (tool.effect === 'pr' && config.requirePrApproval) || (tool.effect === 'email' && !config.autoDispatchEmail)
      || (tool.effect === 'deploy' && config.requireDeployApproval) || ((tool.effect === 'write' || tool.effect === 'social') && config.requireWriteApproval)
  }
  private async executeBranch(
    cycle: BotCycle, branch: BotBranch, config: BotConfig, signal: AbortSignal, approved?: BotApproval,
  ): Promise<void> {
    while (branch.nextAction < branch.actions.length) {
      signal.throwIfAborted()
      const action = branch.actions[branch.nextAction]
      if (action === undefined) throw new Error('Saved branch action index is outside the proposed action list')
      const tool = this.toolFor(action, branch.task.role, config)
      if (['pr', 'deploy', 'write'].includes(tool.effect)) {
        if (branch.stage === null || branch.validatedRevision !== branch.stage.revision || config.validationCommands.length === 0) throw new Error(`${tool.name} requires a staged revision and successful configured validation commands`)
      }
      if (approved !== undefined) {
        if (approved.cycleId !== cycle.id || approved.branchId !== branch.id || approved.actionIndex !== branch.nextAction || approved.tool !== action.tool || JSON.stringify(approved.input) !== JSON.stringify(action.input) || JSON.stringify(approved.stage) !== JSON.stringify(branch.stage)) throw new Error('Approval no longer matches the saved action and staged revision')
        await this.store.append({ type: 'approval', approval: { ...approved, status: 'consumed', decidedAt: timestamp() } })
        approved = undefined
      } else if (this.needsApproval(tool, config)) {
        const approval: BotApproval = { id: freshId(), cycleId: cycle.id, branchId: branch.id, actionIndex: branch.nextAction, tool: action.tool, input: action.input, stage: branch.stage, status: 'pending', createdAt: timestamp(), decidedAt: null }
        await this.store.append({ type: 'approval', approval })
        branch.status = 'awaiting-approval'; await this.store.append({ type: 'cycle', cycle }); return
      }
      const result = await this.dispatch(
        tool, action, config, cycle.id, branch.id, branch.task.role, branch.stage, branch.nextAction, signal,
      )
      if (result.stage !== undefined) {
        if (tool.effect !== 'stage') throw new Error('Only a staging tool may replace the staged revision')
        branch.stage = result.stage; branch.validatedRevision = null
      }
      if (result.validatedRevision !== undefined) {
        if (tool.effect !== 'validate' || branch.stage === null || result.validatedRevision !== branch.stage.revision || config.validationCommands.length === 0) throw new Error('Validation result does not match the staged revision and configured checks')
        branch.validatedRevision = result.validatedRevision
      }
      branch.nextAction++
      await this.store.append({ type: 'cycle', cycle })
    }
  }

  private async dispatch(
    tool: BotTool, action: ToolProposal, config: BotConfig, cycleId: BotId, branchId: BotId | null,
    role: BotRole, stage: BotBranch['stage'], actionIndex: number, signal: AbortSignal,
  ): Promise<BotToolResult> {
    // Recheck trusted ceilings and JSON at the dispatch boundary, including evaluation feeds.
    this.toolFor(action, role, config)
    const input = tool.input.parse(action.input)
    const attempts = tool.retry === 'never' ? 1 : 2
    for (let attempt = 1; attempt <= attempts; attempt++) {
      signal.throwIfAborted()
      await this.store.requireHeadroom(4_194_304)
      await this.store.append({ type: 'trace', trace: { cycleId, branchId, kind: 'tool-start', tool: tool.name, attempt, summary: `Dispatch ${tool.name}`, data: redacted(input, config, this.environment) } })
      try {
        const result = await bounded(signal, config.toolTimeoutMs, async toolSignal => tool.execute(input, {
          config, cycleId, branchId: branchId ?? `${cycleId}:evaluation` as BotId, role, stage, signal: toolSignal,
          idempotencyKey: `${cycleId}:${branchId ?? 'evaluation'}:${actionIndex}:${tool.name}`,
        }))
        if (Buffer.byteLength(JSON.stringify(result)) > config.maxInputBytes) throw new Error('Tool result exceeds configured byte limit')
        const parsed = botToolResultSchema.parse(result)
        await this.store.append({ type: 'trace', trace: {
          cycleId, branchId, kind: 'tool-result', tool: tool.name, attempt,
          summary: this.redactedText(parsed.summary, config), data: redacted(parsed.data ?? null, config, this.environment),
        } })
        return {
          summary: parsed.summary, ...(parsed.data === undefined ? {} : { data: parsed.data }),
          ...(parsed.stage === undefined ? {} : { stage: parsed.stage }),
          ...(parsed.validatedRevision === undefined ? {} : { validatedRevision: parsed.validatedRevision }),
        }
      } catch (error) {
        await this.store.append({ type: 'trace', trace: { cycleId, branchId, kind: 'tool-error', tool: tool.name, attempt, summary: this.errorText(error, config) } })
        if (signal.aborted || attempt === attempts) throw error
      }
    }
    throw new Error('Tool retry loop did not settle')
  }

  /** Consume one exact pending approval and resume only its saved branch.
   * @param id Pending durable approval identity.
   * @param allow Whether to authorize this exact saved action and revision.
   * @returns Accepted decision state; execution continues in the background.
   */
  async approve(id: string, allow: boolean): Promise<BotSnapshot> {
    await this.initialize()
    if (this.disposed) throw new Error('SaturnBot host is stopping')
    if (typeof allow !== 'boolean' || typeof id !== 'string') throw new Error('Approval requires an id and boolean decision')
    if (this.running !== null) throw new BotBusyError()
    const release = await this.store.acquireLease()
    let transferred = false
    try {
      const state = await this.store.snapshot()
      const approval = state.approvals.find(item => item.id === id)
      if (approval?.status !== 'pending') throw new Error('This approval is no longer pending; refresh the activity list')
      const cycle = state.cycles.find(item => item.id === approval.cycleId)
      const branch = cycle?.branches.find(item => item.id === approval.branchId)
      if (cycle === undefined || branch?.status !== 'awaiting-approval') throw new Error('Approval branch is no longer waiting')
      const decided: BotApproval = { ...approval, status: allow ? 'approved' : 'rejected', decidedAt: timestamp() }
      await this.store.append({ type: 'approval', approval: decided })
      if (!allow) {
        branch.status = 'interrupted'; branch.error = 'Publication declined by the user.'
        await this.settle(cycle, state.config)
        return await this.snapshot()
      }
      branch.status = 'running'; cycle.status = 'running'
      await this.store.append({ type: 'cycle', cycle })
      const controller = new AbortController(); this.controller = controller
      transferred = true
      this.running = this.owned(this.runBranch(cycle, branch, state.config, controller.signal, decided)
        .catch(async (error: unknown) => this.failBranch(cycle, branch, state.config, controller.signal, error))
        .then(async () => this.settle(cycle, state.config)), release)
      void this.running.catch(() => {})
      return await this.snapshot()
    } finally { if (!transferred) await release() }
  }

  private redactedText(value: string, config: BotConfig): string { return redacted(value, config, this.environment) as string }
  private errorText(error: unknown, config: BotConfig): string {
    const message = error instanceof Error ? error.stack ?? error.message : typeof error === 'string' ? error : 'Unknown SaturnBot failure'
    return this.redactedText(message, config)
  }
  private async alert(cycleId: BotId | null, branchId: BotId | null, message: string): Promise<void> {
    await this.store.append({ type: 'alert', alert: { id: freshId(), cycleId, branchId, message: message.slice(0, 16_000), createdAt: timestamp() } })
  }
  private async failBranch(cycle: BotCycle, branch: BotBranch, config: BotConfig, signal: AbortSignal, error: unknown): Promise<void> {
    branch.status = signal.aborted ? 'interrupted' : 'failed'; branch.error = this.errorText(error, config)
    await this.store.append({ type: 'cycle', cycle }); await this.alert(cycle.id, branch.id, branch.error)
  }

  private async settle(cycle: BotCycle, config: BotConfig): Promise<void> {
    cycle.status = cycle.branches.some(branch => branch.status === 'awaiting-approval') ? 'awaiting-approval'
      : cycle.branches.some(branch => branch.status === 'failed') ? 'failed'
        : cycle.branches.some(branch => branch.status === 'interrupted') ? 'interrupted' : 'completed'
    cycle.finishedAt = cycle.status === 'awaiting-approval' ? null : timestamp()
    await this.store.append({ type: 'cycle', cycle })
    const markdown = [`# ${cycle.plan || 'SaturnBot cycle'}`, '', `Status: ${cycle.status}`, '', ...cycle.branches.map(branch => `- **${branch.task.role}: ${branch.task.title}** — ${branch.status}\n  ${branch.error ?? branch.summary}`)].join('\n')
    const date = cycle.startedAt.slice(0, 10)
    await this.store.append({ type: 'report', report: { id: `${cycle.id}:report` as BotId, cycleId: cycle.id, date, title: 'Cycle report', markdown: markdown.slice(0, 64_000), channel: 'inbox' } })
    const dailyReports = await this.store.dailyReports(date)
    const fullDigest = dailyReports.map(report => report.markdown).join('\n\n---\n\n')
    const daily = fullDigest.length <= 60_000 ? fullDigest : `[Digest preview shortened. ${dailyReports.length} cycle reports remain in the execution journal.]\n\n${fullDigest.slice(-59_800)}`
    await this.store.append({ type: 'report', report: { id: `${date}:digest` as BotId, cycleId: cycle.id, date, title: `Daily digest · ${date}`, markdown: `# Daily digest · ${date}\n\n${daily}`, channel: 'inbox' } })
    await writeFileAtomic(join(this.store.root, 'reports', `${date}.md`), `# Daily digest · ${date}\n\n${fullDigest}\n`, { mode: 0o600, dirMode: 0o700 })
    await this.store.append({ type: 'message', message: { id: freshId(), role: 'orchestrator', sender: 'agent', content: markdown.slice(0, 16_000) || 'Cycle finished.', at: timestamp(), cycleId: cycle.id } })
    if (config.reportChannel !== 'inbox') {
      const deliver = this.options.reportDeliveries?.[config.reportChannel]
      if (deliver === undefined) {
        await this.alert(cycle.id, null, `Report saved to the durable inbox. External report channel "${config.reportChannel}" is not configured by this runtime.`)
      } else {
        try { await deliver(config, { title: `Daily digest · ${date}`, markdown: daily }) } catch (error) {
          await this.alert(cycle.id, null, `Report channel "${config.reportChannel}" delivery failed: ${this.errorText(error, config)}`)
        }
      }
    }
  }

  /** Abort current work and wait until adapters and the journal reach quiescence.
   * @returns State after active branches settle and pending approvals are rejected.
   */
  async cancel(): Promise<BotSnapshot> {
    await this.initialize()
    this.controller?.abort(new Error('Cancelled by the user'))
    await this.running
    const release = await this.store.acquireLease()
    try {
      const state = await this.store.snapshot()
      if (state.activeCycle !== null) {
        const cycle = state.activeCycle
        for (const branch of cycle.branches) if (branch.status === 'awaiting-approval') { branch.status = 'interrupted'; branch.error = 'Cancelled by the user.' }
        for (const approval of state.approvals) if (approval.cycleId === cycle.id && approval.status === 'pending') await this.store.append({ type: 'approval', approval: { ...approval, status: 'rejected', decidedAt: timestamp() } })
        await this.settle(cycle, state.config)
      }
    } finally { await release() }
    return this.snapshot()
  }
  /** Disable future scheduling without cancelling the current cycle or its approvals.
   * @returns State after the scheduling preference is durably disabled.
   */
  async pause(): Promise<BotSnapshot> {
    await this.initialize()
    const save = async (): Promise<void> => {
      const state = await this.store.snapshot()
      await this.store.writeConfiguration({ ...state.config, enabled: false })
      this.nextRunAt = null
    }
    let saved = false
    if (this.running !== null) {
      try { await this.store.withHeldLease(save); saved = true } catch (error) {
        if (!(error instanceof BotBusyError)) throw error
        await this.running
      }
    }
    if (!saved) {
      const release = await this.store.acquireLease()
      try { await save() } finally { await release() }
    }
    return this.snapshot()
  }
  /** Await all in-flight work, including effect cancellation. */
  async waitForIdle(): Promise<void> { await this.running }
  /** Dispose the host-owned lifecycle without leaving background adapters running. */
  async dispose(): Promise<void> { this.disposed = true; this.nextRunAt = null; this.controller?.abort(new Error('SaturnBot host stopped')); await this.running }
}
