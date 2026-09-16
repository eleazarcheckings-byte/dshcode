import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { reconcileTask, resumeNextFireAt, ScheduleDurableRuntime } from '../src/index.ts'
import { allocateTaskId, ScheduleDurableStore } from '../src/store.ts'
import type { DurableTaskRecord, TaskDispatchRequest } from '../src/types.ts'

function cronTask(overrides: Partial<DurableTaskRecord> = {}): DurableTaskRecord {
  return {
    id: allocateTaskId(),
    name: 'poll job',
    prompt: 'check the queue',
    workspace: '/workspace/project',
    schedule: { kind: 'cron', expression: '*/10 * * * *' },
    status: 'active',
    nextFireAt: '2026-09-16T12:00:00.000Z',
    lastFiredAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('reconcileTask (pure, deterministic clock)', () => {
  it('leaves a not-yet-due active task untouched and dispatches nothing', () => {
    const task = cronTask({ nextFireAt: '2026-09-16T12:10:00.000Z' })
    const decision = reconcileTask(task, Date.parse('2026-09-16T12:00:00.000Z'))
    expect(decision.dispatch).toBeUndefined()
    expect(decision.task).toEqual(task)
  })

  it('fires exactly once after two missed cron occurrences and jumps directly to the next future target', () => {
    // Due at 12:00; the clock is advanced to 12:25, past the 12:10 and 12:20
    // occurrences (a */10 rule) as well.
    const task = cronTask({ nextFireAt: '2026-09-16T12:00:00.000Z' })
    const nowMs = Date.parse('2026-09-16T12:25:00.000Z')
    const decision = reconcileTask(task, nowMs)
    expect(decision.dispatch).toEqual({ firedAt: '2026-09-16T12:25:00.000Z' })
    // The next fire is the first */10 slot strictly after 12:25, i.e. 12:30 —
    // not 12:10 or 12:20, proving the missed occurrences were not replayed.
    expect(decision.task.nextFireAt).toBe('2026-09-16T12:30:00.000Z')
    expect(decision.task.status).toBe('active')
    expect(decision.task.lastFiredAt).toBe('2026-09-16T12:25:00.000Z')

    // Reconciling again at the same instant must not fire a second time.
    const second = reconcileTask(decision.task, nowMs)
    expect(second.dispatch).toBeUndefined()
  })

  it('fires a one-shot task exactly once and marks it done, dropping its next fire', () => {
    const task = cronTask({
      schedule: { kind: 'once', at: '2026-09-16T12:00:00.000Z' },
      nextFireAt: '2026-09-16T12:00:00.000Z',
    })
    const decision = reconcileTask(task, Date.parse('2026-09-16T12:05:00.000Z'))
    expect(decision.dispatch).toEqual({ firedAt: '2026-09-16T12:05:00.000Z' })
    expect(decision.task.status).toBe('done')
    expect(decision.task.nextFireAt).toBeNull()

    // A done task never fires again, however far the clock advances.
    const again = reconcileTask(decision.task, Date.parse('2026-09-20T00:00:00.000Z'))
    expect(again.dispatch).toBeUndefined()
  })

  it('suppresses a paused task even when its stale next-fire is far in the past', () => {
    const task = cronTask({ status: 'paused', nextFireAt: '2020-01-01T00:00:00.000Z' })
    const decision = reconcileTask(task, Date.parse('2026-09-16T12:00:00.000Z'))
    expect(decision.dispatch).toBeUndefined()
    expect(decision.task).toEqual(task)
  })
})

describe('resumeNextFireAt', () => {
  it('recomputes a cron target strictly after now rather than replaying the paused interval', () => {
    const next = resumeNextFireAt({ kind: 'cron', expression: '*/10 * * * *' }, Date.parse('2026-09-16T12:03:00.000Z'))
    expect(next).toBe('2026-09-16T12:10:00.000Z')
  })

  it('keeps a still-future one-shot target unchanged', () => {
    const next = resumeNextFireAt({ kind: 'once', at: '2026-09-20T00:00:00.000Z' }, Date.parse('2026-09-16T12:00:00.000Z'))
    expect(next).toBe('2026-09-20T00:00:00.000Z')
  })

  it('brings a lapsed one-shot target up to now so it catches up on the next reconcile pass', () => {
    const nowMs = Date.parse('2026-09-16T12:00:00.000Z')
    const next = resumeNextFireAt({ kind: 'once', at: '2026-09-10T00:00:00.000Z' }, nowMs)
    expect(next).toBe('2026-09-16T12:00:00.000Z')
  })
})

const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-schedule-durable-reconcile-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('ScheduleDurableRuntime.reconcileAll', () => {
  it('dispatches a restart-time catch-up exactly once per due task and persists the re-armed state', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const store = await ScheduleDurableStore.open(ctx.storageDomain)
    const runtime = new ScheduleDurableRuntime(ctx, store)

    const task = cronTask({ nextFireAt: '2026-09-16T12:00:00.000Z' })
    await store.put(task)

    const dispatched: TaskDispatchRequest[] = []
    ctx.provide('scheduleDurableDispatcher', {
      async dispatch(request: TaskDispatchRequest) {
        dispatched.push(request)
        return { kind: 'dispatched' as const }
      },
    })

    const nowMs = Date.parse('2026-09-16T12:25:00.000Z')
    const fired = await runtime.reconcileAll(nowMs)
    expect(fired).toHaveLength(1)
    expect(fired[0]?.id).toBe(task.id)
    expect(dispatched).toHaveLength(1)

    // A second pass at the same instant must not fire again.
    const secondPass = await runtime.reconcileAll(nowMs)
    expect(secondPass).toHaveLength(0)
    expect(dispatched).toHaveLength(1)

    const persisted = store.get(task.id)
    expect(persisted?.nextFireAt).toBe('2026-09-16T12:30:00.000Z')

    await store.close()
    await ctx.fiber.dispose()
  })

  it('falls back to a safe recording dispatcher with no scheduleDurableDispatcher configured', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const store = await ScheduleDurableStore.open(ctx.storageDomain)
    const runtime = new ScheduleDurableRuntime(ctx, store)
    await store.put(cronTask({ nextFireAt: '2026-09-16T12:00:00.000Z' }))

    const fired = await runtime.reconcileAll(Date.parse('2026-09-16T12:01:00.000Z'))
    expect(fired).toHaveLength(1)
    expect(fired[0]?.outcome.kind).toBe('dispatched')

    await store.close()
    await ctx.fiber.dispose()
  })
})
