/**
 * Durable persistence for Schedule-Durable tasks over the `dsh-storage-domain`
 * seam. Owns the domain spec, record schema, and a typed CRUD wrapper; carries
 * no scheduling or dispatch logic (that lives in `index.ts`).
 * @module @deepseek-ai/dsh-schedule-durable/src/store
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DomainFacility, Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { DurableTaskRecord, ScheduleSpec, TaskId, TaskStatus } from './types.ts'

/** Apply the `TaskId` brand to a plain string identity. */
export function TaskId(value: string): TaskId {
  return value as Branded<'ScheduleDurableTaskId'>
}

/** Generate a fresh, never-reused task identity. */
export function allocateTaskId(): TaskId {
  return TaskId(`task-${randomUUID()}`)
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Strict four-digit-year RFC 3339 UTC instant, matching the wire format `toUtcInstant` produces. */
const utcInstantSchema = z.string().regex(UTC_INSTANT, 'must be a four-digit-year RFC 3339 UTC instant')

const scheduleSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cron'), expression: z.string().min(1) }),
  z.object({ kind: z.literal('once'), at: utcInstantSchema }),
]) satisfies z.ZodType<ScheduleSpec>

const taskStatusSchema = z.union([
  z.literal('active'),
  z.literal('paused'),
  z.literal('done'),
]) satisfies z.ZodType<TaskStatus>

/** Runtime schema for one persisted task record; validated at domain open and on every write. */
export const durableTaskRecordSchema = z.object({
  id: z.string().min(1).transform(value => value as TaskId),
  name: z.string(),
  prompt: z.string(),
  workspace: z.string(),
  schedule: scheduleSpecSchema,
  status: taskStatusSchema,
  nextFireAt: utcInstantSchema.nullable(),
  lastFiredAt: utcInstantSchema.nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
}) as unknown as z.ZodType<DurableTaskRecord>

/** The `schedule_durable` domain: one `tasks` table keyed by {@link TaskId}. */
export const scheduleDurableDomainSpec = defineDomain({
  name: 'schedule_durable',
  version: 0,
  tables: {
    tasks: domainTable<TaskId, DurableTaskRecord>(durableTaskRecordSchema),
  },
})

/** Typed CRUD surface over the open `schedule_durable` domain. */
export class ScheduleDurableStore {
  private readonly table: KvTable<TaskId, DurableTaskRecord>

  private constructor(private readonly domain: Domain<typeof scheduleDurableDomainSpec>) {
    this.table = domain.table('tasks')
  }

  /**
   * Open the domain over the facility's routed backend.
   * @param facility - the mounted `ctx.storageDomain` form.
   * @returns the opened, ready-to-use store.
   */
  static async open(facility: DomainFacility): Promise<ScheduleDurableStore> {
    const domain = await facility.open(scheduleDurableDomainSpec)
    return new ScheduleDurableStore(domain)
  }

  /** Read one task, synchronously from memory. */
  get(id: TaskId): DurableTaskRecord | undefined {
    return this.table.get(id)
  }

  /** Snapshot every persisted task, in no particular order. */
  list(): DurableTaskRecord[] {
    return [...this.table.entries()].map(([, record]) => record)
  }

  /** Insert or overwrite one task record durably. */
  put(record: DurableTaskRecord): Promise<void> {
    return this.table.put(record.id, record)
  }

  /** Delete one task durably. Idempotent: returns `false` when the id was already absent. */
  delete(id: TaskId): Promise<boolean> {
    return this.table.delete(id)
  }

  /** Close the underlying domain; the caller (the plugin's disposer) owns this call. */
  close(): Promise<void> {
    return this.domain.close()
  }
}
