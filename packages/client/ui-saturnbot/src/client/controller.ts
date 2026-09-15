/** React-free Remote projection and serialized command lifecycle for SaturnBot. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BotConfig, BotEventPage, BotId, BotMemoryRecord, BotRole, BotSnapshot, BotTicketRecord, BotWebhookRecord } from '@saturnai/dsh-saturnbot/client'
import type { SaturnBotActions, SaturnBotViewState } from './contracts.ts'

/** Generated Remote namespace consumed structurally by the model. */
export interface SaturnBotRemote {
  snapshot(): Promise<RemoteResult<BotSnapshot>>
  configure(input: Partial<BotConfig>): Promise<RemoteResult<BotSnapshot>>
  runNow(): Promise<RemoteResult<BotSnapshot>>
  pause(): Promise<RemoteResult<BotSnapshot>>
  cancel(): Promise<RemoteResult<BotSnapshot>>
  approve(id: BotId, allowed: boolean): Promise<RemoteResult<BotSnapshot>>
  message(role: BotRole, content: string): Promise<RemoteResult<BotSnapshot>>
  events(cursor: number): Promise<RemoteResult<BotEventPage>>
  memory(query: string): Promise<RemoteResult<BotMemoryRecord[]>>
  tickets(): Promise<RemoteResult<BotTicketRecord[]>>
  webhooks(): Promise<RemoteResult<BotWebhookRecord[]>>
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Maintains one observable server projection and owns all polling resources. */
export class SaturnBotController implements SaturnBotActions {
  /** Observable authoritative projection and transport state for the slot renderer. */
  readonly state = createSnapshotStore<SaturnBotViewState>({
    snapshot: null, events: [], loading: true, error: null,
    memory: [], tickets: [], webhooks: [], recordsLoading: false,
  })
  private disposed = false
  private cursor = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()
  private refreshing: Promise<void> | null = null

  /** @param remote - Mounted typed SaturnBot Remote namespace. */
  constructor(private readonly remote: SaturnBotRemote) {}

  /**
   * Load the dashboard baseline once, then update while visible.
   * @returns Resource disposer.
   */
  start(): () => void {
    const reload = (): void => {
      if (document.hidden || this.disposed) { this.clearTimer(); return }
      void this.refresh().catch(() => { /* The failed refresh is published in state.error. */ })
    }
    document.addEventListener('visibilitychange', reload)
    window.addEventListener('focus', reload)
    // Electron can mount a popup before publishing its visible state.
    void this.refresh().catch(() => { /* The failed baseline is published in state.error. */ })
    return () => {
      this.disposed = true
      this.clearTimer()
      document.removeEventListener('visibilitychange', reload)
      window.removeEventListener('focus', reload)
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(): void {
    this.clearTimer()
    if (this.disposed || document.hidden) return
    const snapshot = this.state.getSnapshot().snapshot
    const running = snapshot?.status === 'running' || snapshot?.status === 'awaiting-approval'
    const next = snapshot?.config.enabled === true && snapshot.nextRunAt !== null
      ? Date.parse(snapshot.nextRunAt) - Date.now() + 500
      : undefined
    let delay = 2000
    if (!running) {
      if (next === undefined) return
      delay = Math.max(2000, Math.min(next, 2_147_483_647))
    }
    this.timer = setTimeout(() => {
      void this.refresh().catch(() => { /* The dashboard retains the failure and last usable snapshot. */ })
    }, delay)
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.queue.then(async () => {
      if (!this.disposed) await operation()
    })
    this.queue = task.catch(() => { /* A failed operation must not poison later user commands. */ })
    return task
  }

  private commit(snapshot: BotSnapshot): void {
    if (this.disposed) return
    const previous = this.state.getSnapshot()
    if (previous.snapshot !== null && snapshot.cursor < previous.snapshot.cursor) return
    this.state.set({ ...previous, snapshot, loading: false, error: null })
  }

  private async pullEvents(): Promise<boolean> {
    const page = unwrap(await this.remote.events(this.cursor))
    if (this.disposed) return false
    this.cursor = page.cursor
    const previous = this.state.getSnapshot()
    const combined = new Map(previous.events.map(event => [event.seq, event]))
    for (const event of page.events) combined.set(event.seq, event)
    this.state.set({ ...previous, events: [...combined.values()].sort((a, b) => a.seq - b.seq).slice(-1000) })
    return page.hasMore
  }

  /** Refresh one baseline and journal page; concurrent refresh callers share the same operation. */
  refresh = (): Promise<void> => {
    if (this.refreshing !== null) return this.refreshing
    this.refreshing = this.enqueue(async () => {
      try {
        const snapshot = unwrap(await this.remote.snapshot())
        this.commit(snapshot)
        // The window shows a recent journal tail, so reopening a long-lived instance does not
        // replay unrelated old pages while its current tool activity stays out of view.
        this.cursor = Math.max(this.cursor, snapshot.cursor - 1000, 0)
        for (let page = 0; page < 5 && !this.disposed; page++) {
          if (!await this.pullEvents()) break
        }
      } catch (error) {
        if (!this.disposed) this.state.set({
          ...this.state.getSnapshot(), loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        this.schedule()
      }
    }).finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private command(operation: () => Promise<RemoteResult<BotSnapshot>>): Promise<void> {
    return this.enqueue(async () => {
      this.clearTimer()
      try {
        this.commit(unwrap(await operation()))
      } finally {
        this.schedule()
      }
      // Journal refresh is separate: failure to fetch a trace cannot undo an admitted command.
      queueMicrotask(() => { void this.refresh().catch(() => { /* Published by refresh. */ }) })
    })
  }

  configure = (input: Partial<BotConfig>): Promise<void> => this.command(() => this.remote.configure(input))
  runNow = (): Promise<void> => this.command(() => this.remote.runNow())
  pause = (): Promise<void> => this.command(() => this.remote.pause())
  cancel = (): Promise<void> => this.command(() => this.remote.cancel())
  approve = (id: BotId, allowed: boolean): Promise<void> => this.command(() => this.remote.approve(id, allowed))
  message = (role: BotRole, content: string): Promise<void> => this.command(() => this.remote.message(role, content))
  loadMoreEvents = (): Promise<void> => this.refresh()
  loadRecords = (query: string): Promise<void> => this.enqueue(async () => {
    this.state.set({ ...this.state.getSnapshot(), recordsLoading: true })
    try {
      const [memory, tickets, webhooks] = await Promise.all([this.remote.memory(query), this.remote.tickets(), this.remote.webhooks()])
      if (!this.disposed) this.state.set({
        ...this.state.getSnapshot(), memory: unwrap(memory), tickets: unwrap(tickets),
        webhooks: unwrap(webhooks), recordsLoading: false,
      })
    } catch (error) {
      if (!this.disposed) this.state.set({
        ...this.state.getSnapshot(), recordsLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })
}
