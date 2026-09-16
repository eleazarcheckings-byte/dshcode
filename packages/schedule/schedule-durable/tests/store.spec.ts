import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { allocateTaskId, ScheduleDurableStore, TaskId } from '../src/store.ts'
import type { DurableTaskRecord } from '../src/types.ts'

const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-schedule-durable-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Boot the real storage stack (JSON backend) over `root`; the caller disposes the returned context. */
async function harness(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

function cronTask(overrides: Partial<DurableTaskRecord> = {}): DurableTaskRecord {
  return {
    id: allocateTaskId(),
    name: 'nightly build',
    prompt: 'run the nightly build',
    workspace: '/workspace/project',
    schedule: { kind: 'cron', expression: '0 3 * * *' },
    status: 'active',
    nextFireAt: '2026-09-17T03:00:00.000Z',
    lastFiredAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('ScheduleDurableStore', () => {
  it('retains id, cron, next-fire, and workspace across a simulated restart', async () => {
    const root = await freshRoot()
    const task = cronTask()

    const ctx1 = await harness(root)
    const store1 = await ScheduleDurableStore.open(ctx1.storageDomain)
    await store1.put(task)
    await store1.close()
    await ctx1.fiber.dispose()

    // Simulated restart: a completely fresh Context and store over the same root.
    const ctx2 = await harness(root)
    const store2 = await ScheduleDurableStore.open(ctx2.storageDomain)
    const reloaded = store2.get(task.id)
    expect(reloaded).toBeDefined()
    expect(reloaded?.id).toBe(task.id)
    expect(reloaded?.schedule).toEqual({ kind: 'cron', expression: '0 3 * * *' })
    expect(reloaded?.nextFireAt).toBe('2026-09-17T03:00:00.000Z')
    expect(reloaded?.workspace).toBe('/workspace/project')
    await store2.close()
    await ctx2.fiber.dispose()
  })

  it('deletes durably: a second delete of the same id is a no-op, not a throw', async () => {
    const root = await freshRoot()
    const ctx = await harness(root)
    const store = await ScheduleDurableStore.open(ctx.storageDomain)
    const task = cronTask()
    await store.put(task)
    await expect(store.delete(task.id)).resolves.toBe(true)
    await expect(store.delete(task.id)).resolves.toBe(false)
    expect(store.get(task.id)).toBeUndefined()
    await store.close()
    await ctx.fiber.dispose()
  })

  it('fails loud at open when a persisted record does not match the schema, rather than silently skipping it', async () => {
    const root = await freshRoot()
    // Hand-craft the on-disk unit with one record whose `status` is not in
    // the closed vocabulary, matching the JSON backend's single-layout shape.
    const malformed = {
      unit: { name: 'schedule_durable', version: 0 },
      global: null,
      tables: {
        tasks: {
          'task-bad': { ...cronTask(), status: 'bogus' },
        },
      },
    }
    await writeFile(join(root, 'schedule_durable.json'), JSON.stringify(malformed), 'utf8')

    const ctx = await harness(root)
    await expect(ScheduleDurableStore.open(ctx.storageDomain)).rejects.toMatchObject({ code: 'invalid-record' })
    await ctx.fiber.dispose()
  })

  it('lists every persisted task', async () => {
    const root = await freshRoot()
    const ctx = await harness(root)
    const store = await ScheduleDurableStore.open(ctx.storageDomain)
    const a = cronTask({ id: TaskId('task-a'), name: 'a' })
    const b = cronTask({ id: TaskId('task-b'), name: 'b' })
    await store.put(a)
    await store.put(b)
    expect(store.list().map(task => task.id).sort()).toEqual(['task-a', 'task-b'])
    await store.close()
    await ctx.fiber.dispose()
  })
})
