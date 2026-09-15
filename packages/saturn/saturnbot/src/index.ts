/** SaturnBot host plugin and authenticated Remote interface over the durable execution engine. */
import { join, isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SaturnBotStore } from './store.ts'
import { SaturnBotEngine } from './engine.ts'
import { SaturnBotScheduler } from './scheduler.ts'
import { LoggedBotModel } from './model.ts'
import { createBotTools } from './tools.ts'
import { BotDataStore } from './adapters/memory.ts'
import { describeBotConnections } from './adapters/integrations.ts'
import type { BotMemoryRecord, BotWebhookRecord, BotTicketRecord } from './service-types.ts'
import { createBotWebhookHandler } from './webhook.ts'
import type { BotConfig, BotEventPage, BotId, BotRole, BotSnapshot } from './types.ts'

export type * from './types.ts'
export type * from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { saturnbot: SaturnBotService }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'saturnbot/rejected': { reason: string } }
}

/** Storage locations are deployment-owned; model output cannot change them. */
export interface Config {
  /** Absolute directory for the journal, SQLite memory, isolated worktrees, and reports. */
  dataDirectory?: string
  /** Optional absolute YAML config path; defaults to config.yaml within dataDirectory. */
  configFile?: string
  /** Maximum append-only journal bytes before the runtime requires offline archival. */
  maxJournalBytes?: number
  /** Maximum signed webhook request size, at most 128 KiB. */
  webhookMaxBytes?: number
  /** Maximum permitted clock difference for signed webhook timestamps. */
  webhookToleranceSeconds?: number
}

/** Persistent scheduled automation with one engine and one authenticated RPC namespace per host. */
export class SaturnBotService extends TypertRemoteService {
  static inject = ['llm', 'sessions', 'sessionPersistence', 'subprocess']
  static Config: Schema<Config> = Schema.object({
    dataDirectory: Schema.string(), configFile: Schema.string(),
    maxJournalBytes: Schema.number().step(1).min(1),
    webhookMaxBytes: Schema.number().step(1).min(1).max(131072).default(65536),
    webhookToleranceSeconds: Schema.number().step(1).min(1).default(300),
  })
  private readonly engine: SaturnBotEngine
  private readonly scheduler: SaturnBotScheduler
  private readonly data: BotDataStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'saturnbot')
    const dataDirectory = config.dataDirectory ?? join(resolveDshHome(), 'saturnbot')
    if (!isAbsolute(dataDirectory) || (config.configFile !== undefined && !isAbsolute(config.configFile))) {
      throw new Error('SaturnBot dataDirectory and configFile must be absolute paths')
    }
    const store = new SaturnBotStore(dataDirectory, {
      ...config.configFile === undefined ? {} : { configFile: config.configFile },
      ...config.maxJournalBytes === undefined ? {} : { maxJournalBytes: config.maxJournalBytes },
    })
    this.engine = new SaturnBotEngine({
      store, model: new LoggedBotModel(ctx),
      tools: createBotTools({ dataDirectory, subprocess: ctx.subprocess }),
    })
    this.data = new BotDataStore(dataDirectory)
    this.scheduler = new SaturnBotScheduler(this.engine, {
      onError: (error) => { ctx.logger.warn('SaturnBot scheduler failed: %s', error instanceof Error ? error.message : String(error)) },
    })
    ctx.inject(['webServer'], (host) => {
      host.effect(() => host.webServer.register({
        kind: 'exact', path: '/saturnbot/webhook',
        handler: createBotWebhookHandler({
          config: async () => (await this.engine.snapshot()).config, data: this.data,
          maxBytes: config.webhookMaxBytes ?? 65536, toleranceSeconds: config.webhookToleranceSeconds ?? 300,
        }),
      }), 'saturnbot: signed webhook ingress')
    })
    ctx.effect(() => async () => {
      await this.scheduler.dispose()
      await this.engine.dispose()
    }, 'saturnbot: durable runner')
  }

  /** Initialize storage and resume only the configured scheduler after the plugin is ready. */
  async [Service.init](): Promise<void> {
    await this.engine.initialize()
    this.scheduler.start()
  }

  /** Read current configuration, cycles, approvals, messages, and reports.
   * @returns The authoritative bounded dashboard projection.
   */
  @Remote
  async snapshot(): Promise<BotSnapshot> { return this.project(await this.engine.snapshot()) }

  /** Persist validated settings; changes never bypass role ceilings or existing approvals.
   * @param patch User-selected configuration changes.
   * @returns The saved configuration and current dashboard state.
   */
  @Remote
  async configure(patch: Partial<BotConfig>): Promise<BotSnapshot> {
    return await this.operation(() => this.engine.configure(patch))
  }

  /** Start one background cycle; returns as soon as its durable ownership is established.
   * @returns The durably accepted running cycle.
   */
  @Remote
  async runNow(): Promise<BotSnapshot> { return await this.operation(() => this.engine.runNow()) }

  /** Pause future scheduled cycles without discarding active work.
   * @returns The current state with automatic scheduling disabled.
   */
  @Remote
  async pause(): Promise<BotSnapshot> { return await this.operation(() => this.engine.pause()) }

  /** Cancel the current cycle and wait for its owned work to settle.
   * @returns The settled state after cancellation.
   */
  @Remote
  async cancel(): Promise<BotSnapshot> { return await this.operation(() => this.engine.cancel()) }

  /** Decide one exact pending action; duplicate or stale approvals are rejected.
   * @param id Exact pending approval identity.
   * @param allowed Whether the operator authorizes the recorded action.
   * @returns The saved decision and resumed or interrupted branch state.
   */
  @Remote
  async approve(id: BotId, allowed: boolean): Promise<BotSnapshot> {
    return await this.operation(() => this.engine.approve(id, allowed))
  }

  /** Send a persisted instruction to the selected role without changing the standing business goal.
   * @param role The selected specialist or orchestrator.
   * @param content The operator's instruction, limited to 8000 characters.
   * @returns The accepted message and newly started cycle.
   */
  @Remote
  async message(role: BotRole, content: string): Promise<BotSnapshot> {
    return await this.operation(() => this.engine.message(role, content))
  }

  /** Read one bounded trace page after the supplied durable sequence number.
   * @param cursor Last event sequence already received, or zero for the start.
   * @returns The next bounded page of observable events.
   */
  @Remote
  async events(cursor: number): Promise<BotEventPage> { return await this.engine.events(cursor) }

  /** Read durable long-term memory without triggering a model or tool invocation.
   * @param query Literal substring to match against keys and values.
   * @returns At most 100 matching memory records, newest first.
   */
  @Remote
  async memory(query: string): Promise<BotMemoryRecord[]> {
    if (query.length > 500) throw new RemoteError('saturnbot/rejected', 'Memory query exceeds 500 characters', { reason: 'query-too-long' })
    return await this.data.searchMemory(query, 100)
  }

  /** Read the latest authenticated delivery receipts.
   * @returns At most 50 signed webhook receipts, newest first.
   */
  @Remote
  async webhooks(): Promise<BotWebhookRecord[]> { return await this.data.listWebhooks(50) }

  /** Read the open support tickets owned by this SaturnBot instance.
   * @returns At most 20 open tickets, newest first.
   */
  @Remote
  async tickets(): Promise<BotTicketRecord[]> { return await this.data.listTickets() }

  private project(state: BotSnapshot): BotSnapshot {
    const connections = describeBotConnections(state.config)
      .map(item => ({ id: item.name, status: item.status, detail: item.message }))
    return { ...state, connections }
  }

  private async operation(action: () => Promise<BotSnapshot>): Promise<BotSnapshot> {
    try { return this.project(await action()) } catch (error) {
      const reason = error instanceof Error ? error.message : 'SaturnBot could not complete the operation'
      throw new RemoteError('saturnbot/rejected', reason, { reason })
    }
  }
}

export default SaturnBotService
