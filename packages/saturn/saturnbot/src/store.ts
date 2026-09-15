/** Fsynced append-only execution journal, boot configuration, and cross-process lease. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseBotConfig, parseBotEvent, parseBotYaml } from './config.ts'
import type { BotConfig, BotEvent, BotEventData, BotEventPage, BotId, BotJson, BotSnapshot, BotTrace } from './types.ts'

/** A live owner already holds the daemon's exclusive execution lease. */
export class BotBusyError extends Error { constructor() { super('SaturnBot is already running in another operation or process'); this.name = 'BotBusyError' } }
/** Store location and deployment-owned resource bounds. */
export interface BotStoreOptions { configFile?: string; maxJournalBytes?: number }
interface Projection {
  events: BotEvent[]
  applied: number
  config: BotConfig
  cycles: Map<string, BotSnapshot['cycles'][number]>
  approvals: Map<string, BotSnapshot['approvals'][number]>
  reports: Map<string, BotSnapshot['reports'][number]>
  traces: Map<string, BotTrace[]>
  alerts: BotSnapshot['alerts']
  messages: BotSnapshot['messages']
}

/** Durable journal with one exclusive writer across processes. */
export class SaturnBotStore {
  /** Absolute append-only execution journal location. */
  readonly journalPath: string
  /** Absolute YAML boot-import and configuration mirror location. */
  readonly configPath: string
  private readonly leasePath: string
  private readonly maxJournalBytes: number
  private leased = false
  private releasing = false
  private readonly borrowers = new Set<Promise<unknown>>()
  private writes: Promise<void> = Promise.resolve()
  private cache: { size: number; mtimeMs: number; events: BotEvent[] } | null = null
  private projection: Projection | null = null

  constructor(readonly root: string, options: BotStoreOptions = {}) {
    this.journalPath = join(root, 'events.jsonl')
    this.configPath = options.configFile ?? join(root, 'config.yaml')
    this.leasePath = join(root, 'execution.lock')
    this.maxJournalBytes = options.maxJournalBytes ?? 64 * 1024 * 1024
  }

  /** Read a complete journal prefix; a crash-truncated final line is never replayed. */
  private async readEvents(): Promise<BotEvent[]> {
    let source: string
    try {
      const info = await stat(this.journalPath)
      if (info.size > this.maxJournalBytes) throw new Error('SaturnBot journal reached its configured size limit; archive it before continuing')
      if (this.cache?.size === info.size && this.cache.mtimeMs === info.mtimeMs) return this.cache.events
      source = await readFile(this.journalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records = source.slice(0, source.lastIndexOf('\n') + 1).split('\n').filter(Boolean)
    const events = records.map((line, index) => {
      const event = parseBotEvent(JSON.parse(line))
      if (event.seq !== index + 1) throw new Error(`SaturnBot journal sequence gap at ${index + 1}`)
      return event
    })
    const info = await stat(this.journalPath)
    if (info.size === Buffer.byteLength(source)) this.cache = { size: info.size, mtimeMs: info.mtimeMs, events }
    return events
  }

  private async project(): Promise<Projection> {
    await this.writes
    const events = await this.readEvents()
    if (this.projection?.events !== events) this.projection = {
      events, applied: 0, config: parseBotConfig({}), cycles: new Map(), approvals: new Map(),
      reports: new Map(), traces: new Map(), alerts: [], messages: [],
    }
    const projection = this.projection
    for (const event of events.slice(projection.applied)) {
      switch (event.type) {
        case 'configured': projection.config = event.config; break
        case 'cycle': projection.cycles.set(event.cycle.id, event.cycle); break
        case 'approval': projection.approvals.set(event.approval.id, event.approval); break
        case 'report': projection.reports.set(event.report.id, event.report); break
        case 'alert': projection.alerts.push(event.alert); break
        case 'trace': {
          let traces = projection.traces.get(event.trace.cycleId)
          if (traces === undefined) { traces = []; projection.traces.set(event.trace.cycleId, traces) }
          traces.push(event.trace)
          break
        }
        case 'message': projection.messages.push(event.message); break
      }
    }
    projection.applied = events.length
    return projection
  }

  /** Reconstruct current state and bounded dashboard history from the journal.
   * @returns Detached current records with bounded dashboard history.
   */
  async snapshot(): Promise<BotSnapshot> {
    const { events, config, cycles, approvals, reports, alerts, messages } = await this.project()
    const ordered = [...cycles.values()].reverse()
    const activeCycle = ordered.find(cycle => cycle.status === 'running' || cycle.status === 'awaiting-approval') ?? null
    const status: BotSnapshot['status'] = activeCycle === null
      ? config.goal.trim() === '' || config.workspace === '' ? 'needs-setup' : config.enabled ? 'idle' : 'disabled'
      : activeCycle.status === 'running' ? 'running' : 'awaiting-approval'
    // Callers may edit a branch before appending its next transition. Journal
    // records must remain immutable until that append has actually committed.
    return structuredClone({
      config, status, activeCycle, cycles: ordered.slice(0, 50), approvals: [...approvals.values()].reverse().slice(0, 200),
      reports: [...reports.values()].reverse().slice(0, 100), alerts: alerts.slice(-100).reverse(),
      messages: messages.slice(-200), cursor: events.length, nextRunAt: null, tools: [], connections: [],
    })
  }

  /** Append a validated event and flush it before acknowledging the transition.
   * @param data Event captured at invocation time under the owned execution lease.
   */
  async append(data: BotEventData): Promise<void> {
    if (!this.leased) throw new Error('SaturnBot journal writes require the execution lease')
    const captured = structuredClone(data)
    const operation = this.writes.then(async () => {
      const events = await this.readEvents()
      const record = parseBotEvent({ ...captured, version: 1, seq: events.length + 1, at: new Date().toISOString() })
      const line = `${JSON.stringify(record)}\n`
      if (Buffer.byteLength(line) > 2_097_152) throw new Error('SaturnBot event exceeds 2 MiB')
      if ((this.cache?.size ?? 0) + Buffer.byteLength(line) > this.maxJournalBytes) throw new Error('SaturnBot journal reached its configured size limit')
      const file = await open(this.journalPath, 'a', 0o600)
      try {
        await file.writeFile(line, 'utf8'); await file.sync()
        const info = await file.stat()
        events.push(record)
        this.cache = { size: info.size, mtimeMs: info.mtimeMs, events }
      } finally { await file.close() }
    })
    // The append caller observes rejection; later queued writes remain runnable.
    this.writes = operation.catch(() => {})
    return operation
  }

  /** Read bounded execution facts after a cursor, retaining stable sequence numbers.
   * @param cursor Last acknowledged event sequence, or zero to start.
   * @param limit Maximum records in this page, between 1 and 500.
   * @returns Detached records with the next cursor and remaining-page indicator.
   */
  async events(cursor = 0, limit = 200): Promise<BotEventPage> {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid SaturnBot event cursor or limit')
    await this.writes
    const all = await this.readEvents()
    const events = all.slice(cursor, cursor + limit)
    return { events: structuredClone(events), cursor: events.at(-1)?.seq ?? cursor, hasMore: cursor + events.length < all.length }
  }

  /** Read all latest per-cycle reports for a date, independent of dashboard limits.
   * @param date UTC calendar date to aggregate.
   * @returns Reports in chronological cycle order.
   */
  async dailyReports(date: string): Promise<BotSnapshot['reports']> {
    const { reports } = await this.project()
    return structuredClone([...reports.values()].filter(report => report.date === date && report.id !== `${date}:digest`))
  }

  /** Reconstruct cycle feeds and completed branch results for a follow-up model request.
   * @param cycleId Current execution cycle.
   * @param branchId Specialist whose successful results may inform the next proposal.
   * @returns Recorded feed results or failures and successful branch results.
   */
  async observations(cycleId: BotId, branchId: BotId): Promise<Record<string, BotJson>> {
    const traces = (await this.project()).traces.get(cycleId) ?? []
    const observations: Record<string, BotJson> = {}
    const results: BotJson[] = []
    for (const trace of traces) if (trace.tool !== undefined) {
      if (trace.kind === 'tool-error' && trace.branchId === null) observations[trace.tool] = { error: trace.summary }
      if (trace.kind !== 'tool-result') continue
      const result = { summary: trace.summary, data: trace.data ?? null }
      if (trace.branchId === null) observations[trace.tool] = result
      else if (trace.branchId === branchId) results.push({ tool: trace.tool, ...result })
    }
    observations.branchResults = results
    return structuredClone(observations)
  }

  /** Check journal headroom before starting an effect whose outcome must be recorded.
   * @param bytes Maximum bytes needed for the admitted effect and following state records.
   * @returns Resolves when the configured journal cap can accommodate those records.
   */
  async requireHeadroom(bytes: number): Promise<void> {
    await this.writes
    await this.readEvents()
    if ((this.cache?.size ?? 0) + bytes > this.maxJournalBytes) throw new Error('SaturnBot journal has insufficient space to record another effect; archive the journal before continuing')
  }

  /** Import deliberate YAML configuration edits at boot.
   * @returns Validated on-disk configuration, or null when no YAML exists.
   */
  async readConfiguration(): Promise<BotConfig | null> {
    try { return parseBotYaml(await readFile(this.configPath, 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** Persist YAML intent before logging it so a crash can import the same intent at boot.
   * @param config Complete validated configuration to mirror and journal.
   */
  async writeConfiguration(config: BotConfig): Promise<void> {
    if (!this.leased) throw new Error('Configuration writes require the execution lease')
    const yaml = stringify(parseBotConfig(config))
    parseBotYaml(yaml)
    await writeFileAtomic(this.configPath, yaml, { mode: 0o600, dirMode: 0o700 })
    await this.append({ type: 'configured', config })
  }

  /** Complete an owner-local operation before an already-held lease can release.
   * @param operation Work that must settle while this instance remains the writer.
   * @returns The operation result; rejects busy if no borrowable lease is held.
   */
  async withHeldLease<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.leased || this.releasing) throw new BotBusyError()
    const pending = operation()
    this.borrowers.add(pending)
    try { return await pending } finally { this.borrowers.delete(pending) }
  }

  /** Acquire one process-wide lease, recovering only a provably dead recorded owner.
   * @returns An idempotent release operation that awaits owned writes and borrowers.
   */
  async acquireLease(): Promise<() => Promise<void>> {
    if (this.leased) throw new BotBusyError()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const token = `${process.pid}:${randomUUID()}`
    const claim = async (): Promise<void> => {
      const file = await open(this.leasePath, 'wx', 0o600)
      try { await file.writeFile(token); await file.sync() } finally { await file.close() }
    }
    try { await claim() } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const recoveryPath = `${this.leasePath}.recovery`
      let recovery
      try { recovery = await open(recoveryPath, 'wx', 0o600) } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'EEXIST') throw new BotBusyError()
        throw failure
      }
      try {
        const current = await readFile(this.leasePath, 'utf8')
        const pid = Number(current.split(':')[0])
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('SaturnBot lease owner is unreadable; inspect the lock before recovery')
        let alive = true
        try { process.kill(pid, 0) } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code === 'ESRCH') alive = false
          else if ((probe as NodeJS.ErrnoException).code !== 'EPERM') throw probe
        }
        if (alive) throw new BotBusyError()
        await rm(this.leasePath)
        await claim()
      } finally { await recovery.close(); await rm(recoveryPath, { force: true }) }
    }
    this.leased = true
    this.releasing = false
    try {
      const bytes = await readFile(this.journalPath)
      const boundary = bytes.lastIndexOf(10) + 1
      if (boundary < bytes.length) await truncate(this.journalPath, boundary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.leased = false; await rm(this.leasePath, { force: true }); throw error
      }
    }
    let released = false
    return async () => {
      if (released) return
      released = true
      this.releasing = true
      await Promise.allSettled([...this.borrowers])
      await this.writes
      const owner = await readFile(this.leasePath, 'utf8')
      if (owner !== token) throw new Error('SaturnBot execution lease changed owner')
      await rm(this.leasePath)
      this.leased = false
    }
  }
}
