/** Host-owned interval scheduler; no timer survives plugin teardown. */
import type { BotScheduler } from './contracts.ts'
import type { SaturnBotEngine } from './engine.ts'
import { BotBusyError } from './store.ts'

/** Scheduler callbacks keep diagnostics with the host's logger. */
export interface BotSchedulerOptions { onError: (error: unknown) => void; pollMs?: number }

/** Poll configuration and launch at the configured interval without overlapping cycles. */
export class SaturnBotScheduler implements BotScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private next = 0
  private interval = 0
  private latestCycle: string | undefined
  private current: Promise<void> = Promise.resolve()
  constructor(private readonly engine: SaturnBotEngine, private readonly options: BotSchedulerOptions) {}
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.queue()
  }
  private queue(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      this.current = this.tick().catch((error: unknown) => {
        // A deployment logger may throw; it must not terminate scheduling.
        try { this.options.onError(error) } catch { /* Only the diagnostic callback is contained. */ }
      }).finally(() => { this.queue() })
    }, this.options.pollMs ?? 1000)
    this.timer.unref()
  }
  private async tick(): Promise<void> {
    const state = await this.engine.snapshot()
    if (this.stopped) return
    if (!state.config.enabled || state.config.goal.trim() === '' || state.config.workspace === '') {
      this.next = 0; this.engine.setNextRunAt(null); return
    }
    const interval = state.config.intervalMinutes * 60_000
    const latest = state.cycles[0]?.startedAt
    if (this.next === 0 || this.interval !== interval || this.latestCycle !== latest) {
      this.interval = interval
      this.latestCycle = latest
      this.next = latest === undefined ? Date.now() + interval : new Date(latest).getTime() + interval
    }
    this.engine.setNextRunAt(new Date(this.next).toISOString())
    if (Date.now() < this.next || state.activeCycle !== null) return
    this.next = Date.now() + interval
    this.engine.setNextRunAt(new Date(this.next).toISOString())
    try { await this.engine.runNow() } catch (error) { if (!(error instanceof BotBusyError)) throw error }
  }
  async dispose(): Promise<void> {
    this.stopped = true; clearTimeout(this.timer)
    await this.current
    this.engine.setNextRunAt(null)
  }
}
