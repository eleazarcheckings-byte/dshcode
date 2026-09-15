import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaturnBotScheduler } from '../src/scheduler.ts'
import { parseBotConfig } from '../src/config.ts'
import type { SaturnBotEngine } from '../src/engine.ts'
import type { BotSnapshot } from '../src/types.ts'

afterEach(() => { vi.useRealTimers() })
function harness(state: Pick<BotSnapshot, 'config' | 'cycles' | 'activeCycle'>) {
  const engine = { snapshot: vi.fn(async () => state), runNow: vi.fn(async () => {}), setNextRunAt: vi.fn() }
  const onError = vi.fn()
  const scheduler = new SaturnBotScheduler(engine as unknown as SaturnBotEngine, { onError, pollMs: 10 })
  return { engine, onError, scheduler }
}

describe('host-only scheduler', () => {
  it('stays disabled until setup and performs only one overdue catch-up after restart', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
    const state: Pick<BotSnapshot, 'config' | 'cycles' | 'activeCycle'> = { config: parseBotConfig({}), cycles: [], activeCycle: null }
    const { engine, scheduler } = harness(state)
    scheduler.start(); await vi.advanceTimersByTimeAsync(20)
    expect(engine.runNow).not.toHaveBeenCalled()
    state.config = parseBotConfig({ enabled: true, goal: 'Goal', workspace: process.cwd(), intervalMinutes: 1 })
    state.cycles = [{ startedAt: '2026-09-14T10:00:00Z' } as BotSnapshot['cycles'][number]]
    await vi.advanceTimersByTimeAsync(10)
    expect(engine.runNow).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.runNow).toHaveBeenCalledOnce()
    await scheduler.dispose()
    expect(engine.setNextRunAt).toHaveBeenLastCalledWith(null)
  })

  it('waits for an active approval and contains a throwing diagnostics callback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
    const state = { config: parseBotConfig({ enabled: true, goal: 'Goal', workspace: process.cwd(), intervalMinutes: 1 }), cycles: [{ startedAt: '2026-09-14T10:00:00Z' } as BotSnapshot['cycles'][number]], activeCycle: {} as BotSnapshot['activeCycle'] }
    const { engine, onError, scheduler } = harness(state)
    onError.mockImplementation(() => { throw new Error('Logger failed') })
    scheduler.start(); await vi.advanceTimersByTimeAsync(10)
    expect(engine.runNow).not.toHaveBeenCalled()
    state.activeCycle = null
    engine.runNow.mockRejectedValueOnce(new Error('Connection failed'))
    await vi.advanceTimersByTimeAsync(10)
    expect(onError).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.runNow).toHaveBeenCalledTimes(2)
    await scheduler.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.runNow).toHaveBeenCalledTimes(2)
  })

  it('reschedules from a manually started cycle and clears the timestamp on pause', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
    const state: Pick<BotSnapshot, 'config' | 'cycles' | 'activeCycle'> = {
      config: parseBotConfig({ enabled: true, goal: 'Goal', workspace: process.cwd(), intervalMinutes: 1 }),
      cycles: [], activeCycle: null,
    }
    const { engine, scheduler } = harness(state)
    scheduler.start(); await vi.advanceTimersByTimeAsync(30_000)
    state.cycles = [{ startedAt: new Date().toISOString() } as BotSnapshot['cycles'][number]]
    await vi.advanceTimersByTimeAsync(35_000)
    expect(engine.runNow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(25_000)
    expect(engine.runNow).toHaveBeenCalledOnce()
    state.config.enabled = false
    await vi.advanceTimersByTimeAsync(10)
    expect(engine.setNextRunAt).toHaveBeenLastCalledWith(null)
    await scheduler.dispose()
  })
})
