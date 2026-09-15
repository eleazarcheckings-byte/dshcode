// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BotEvent, BotEventPage, BotMemoryRecord, BotSnapshot, BotTicketRecord, BotWebhookRecord } from '@saturnai/dsh-saturnbot/client'
import { SaturnBotController, type SaturnBotRemote } from '../src/client/controller.ts'
import { at, snapshot } from './fixtures.client.ts'

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}
// `snapshot()` returns the client's widened `SaturnBotSnapshot`; pin this back to the plain
// host `BotSnapshot` the real `SaturnBotRemote` methods (and this file's own `RemoteResult<BotSnapshot>`
// fixtures) traffic in — a `SaturnBotSnapshot` value is always a valid `BotSnapshot` too.
function remote(value: BotSnapshot = snapshot()) {
  return {
    snapshot: vi.fn(async () => ok(value)), configure: vi.fn(async () => ok(value)),
    runNow: vi.fn(async () => ok(value)), pause: vi.fn(async () => ok(value)), cancel: vi.fn(async () => ok(value)),
    approve: vi.fn(async () => ok(value)), message: vi.fn(async () => ok(value)),
    events: vi.fn(async (_cursor: number): Promise<RemoteResult<BotEventPage>> => ok({ events: [], cursor: value.cursor, hasMore: false })),
    memory: vi.fn(async (): Promise<RemoteResult<BotMemoryRecord[]>> => ok([])),
    tickets: vi.fn(async (): Promise<RemoteResult<BotTicketRecord[]>> => ok([])),
    webhooks: vi.fn(async (): Promise<RemoteResult<BotWebhookRecord[]>> => ok([])),
  } satisfies SaturnBotRemote
}
let hidden: boolean
beforeEach(() => { hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('SaturnBot controller ordering and lifecycle', () => {
  it('loads its initial baseline while hidden and waits for visibility before polling', async () => {
    vi.useFakeTimers()
    hidden = true
    const api = remote(snapshot({ status: 'running' })), controller = new SaturnBotController(api)
    const dispose = controller.start()
    onTestFinished(dispose)
    await vi.waitFor(() => { expect(controller.state.getSnapshot().loading).toBe(false) })
    expect(api.snapshot).toHaveBeenCalledOnce()
    expect(api.events).toHaveBeenCalledOnce()
    expect(controller.state.getSnapshot().snapshot?.status).toBe('running')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.snapshot).toHaveBeenCalledOnce()
    hidden = false; document.dispatchEvent(new Event('visibilitychange'))
    await controller.refresh()
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.snapshot).toHaveBeenCalledTimes(3)
  })

  it('opens at the recent journal tail and drains all five pages without hiding the latest run', async () => {
    const api = remote(snapshot({ cursor: 3200 })), controller = new SaturnBotController(api)
    vi.mocked(api.events).mockImplementation(async (cursor) => {
      const events: BotEvent[] = Array.from({ length: 200 }, (_, index) => ({
        type: 'configured', version: 1, seq: cursor + index + 1, at, config: snapshot().config,
      }))
      return ok({ events, cursor: cursor + 200, hasMore: cursor + 200 < 3200 })
    })
    await controller.refresh()
    expect(api.events.mock.calls.map(call => call[0])).toEqual([2200, 2400, 2600, 2800, 3000])
    expect(controller.state.getSnapshot().events).toHaveLength(1000)
    expect(controller.state.getSnapshot().events.at(-1)?.seq).toBe(3200)
  })

  it('deduplicates refresh and serializes writes after an in-flight baseline', async () => {
    const api = remote(), baseline = deferred<RemoteResult<BotSnapshot>>()
    vi.mocked(api.snapshot).mockReturnValueOnce(baseline.promise)
    vi.mocked(api.configure).mockResolvedValue(ok(snapshot({ cursor: 2, config: { ...snapshot().config, goal: 'Accepted goal' } })))
    const controller = new SaturnBotController(api)
    const first = controller.refresh(), shared = controller.refresh()
    expect(shared).toBe(first)
    const write = controller.configure({ goal: 'Accepted goal' })
    await Promise.resolve()
    expect(api.configure).not.toHaveBeenCalled()
    baseline.resolve(ok(snapshot({ cursor: 1 })))
    await first; await write; await controller.refresh()
    expect(api.configure).toHaveBeenCalledExactlyOnceWith({ goal: 'Accepted goal' })
    expect(controller.state.getSnapshot().snapshot?.config.goal).toBe('Accepted goal')
    expect(controller.state.getSnapshot().snapshot?.cursor).toBe(2)
  })

  it('keeps the previous projection on error and accepts the next command', async () => {
    const api = remote(), controller = new SaturnBotController(api)
    await controller.refresh()
    vi.mocked(api.message).mockRejectedValueOnce(new Error('Busy'))
    await expect(controller.message('developer', 'Review')).rejects.toThrow('Busy')
    expect(controller.state.getSnapshot().snapshot?.config.goal).toBe(snapshot().config.goal)
    await controller.pause(); await controller.refresh()
    expect(api.pause).toHaveBeenCalledOnce()
  })

  it('does not turn a trace fetch failure into a failed admitted command', async () => {
    const api = remote(), controller = new SaturnBotController(api)
    vi.mocked(api.events).mockRejectedValue(new Error('Trace temporarily unavailable'))
    await expect(controller.runNow()).resolves.toBeUndefined()
    await expect(controller.refresh()).rejects.toThrow('Trace temporarily unavailable')
    expect(controller.state.getSnapshot().snapshot).not.toBeNull()
    expect(controller.state.getSnapshot().error).toBe('Trace temporarily unavailable')
  })

  it('polls visible active work, pauses in the background, and ignores late disposal results', async () => {
    vi.useFakeTimers()
    const api = remote(snapshot({ status: 'running' })), controller = new SaturnBotController(api)
    const dispose = controller.start()
    await controller.refresh()
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    hidden = true; document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    const late = deferred<RemoteResult<BotSnapshot>>()
    vi.mocked(api.snapshot).mockReturnValueOnce(late.promise)
    hidden = false; window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    dispose()
    late.resolve(ok(snapshot({ cursor: 999 })))
    await controller.refresh()
    expect(controller.state.getSnapshot().snapshot?.cursor).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves unscheduled idle work quiet and refreshes once when a schedule is due', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    const api = remote(), controller = new SaturnBotController(api)
    const dispose = controller.start(); await controller.refresh()
    expect(vi.getTimerCount()).toBe(0)
    vi.mocked(api.snapshot).mockResolvedValue(ok(snapshot({ cursor: 1, config: { ...snapshot().config, enabled: true }, nextRunAt: '2026-09-14T12:01:00.000Z' })))
    await controller.refresh()
    await vi.advanceTimersByTimeAsync(60_499)
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.snapshot).toHaveBeenCalledTimes(3)
    dispose()
  })

  it('reads real memory, tickets, and webhook records through their dedicated RPCs', async () => {
    const api = remote(), controller = new SaturnBotController(api)
    vi.mocked(api.memory).mockResolvedValue(ok([{ key: 'release', value: 'Monday', updatedAt: at }]))
    await controller.loadRecords('release')
    expect(api.memory).toHaveBeenCalledWith('release')
    expect(api.tickets).toHaveBeenCalledOnce()
    expect(api.webhooks).toHaveBeenCalledOnce()
    expect(controller.state.getSnapshot().memory[0]?.value).toBe('Monday')
    expect(controller.state.getSnapshot().recordsLoading).toBe(false)
  })
})
