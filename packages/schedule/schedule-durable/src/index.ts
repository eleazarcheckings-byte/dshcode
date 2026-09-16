/**
 * Restart-durable, workspace-bound scheduled tasks: cron and one-shot forms,
 * exactly-once catch-up after a cold start, pause/resume/cancel, persisted
 * through the `dsh-storage-domain` seam (never the session log). Composes
 * beside the session-scoped `@deepseek-ai/dsh-schedule` package rather than
 * replacing it: this package's tasks are not tied to any one session or live
 * Agent, so they keep firing across a harness restart.
 *
 * Firing a due task is a two-step split. Reconciliation (this package) always
 * runs: it decides which tasks are due, fires each at most once per pass, and
 * re-arms it. What a firing DOES is delegated to an injected
 * {@link TaskDispatcher}, resolved duck-typed from `ctx.get('scheduleDurableDispatcher')`
 * so a deployment without one still composes: reconciliation then records the
 * firing and takes no further action. See the package README for why this
 * package does not itself start an agent session.
 * @module @deepseek-ai/dsh-schedule-durable
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { CronParseError, nextFireAfter, parseCron, toUtcInstant } from './cron.ts'
import { allocateTaskId, ScheduleDurableStore, TaskId } from './store.ts'
import type {
  DurableTaskRecord,
  DurableTaskView,
  ReconcileDecision,
  ScheduleDurableCancelValue,
  ScheduleDurableCreateValue,
  ScheduleDurableListValue,
  ScheduleDurableMutateValue,
  ScheduleDurableToolError,
  ScheduleSpec,
  TaskDispatchOutcome,
  TaskDispatcher,
  TaskId as TaskIdType,
} from './types.ts'

export type * from './types.ts'
export { allocateTaskId, durableTaskRecordSchema, scheduleDurableDomainSpec, ScheduleDurableStore, TaskId } from './store.ts'
export { CronParseError, nextFireAfter, parseCron, toUtcInstant } from './cron.ts'
export type { ParsedCron } from './cron.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scheduleDurable: ScheduleDurableRuntime
  }
}

/** Cordis plugin name. */
export const name = 'schedule-durable'
/** The tools registry and the storage-domain form must both be present before this plugin mounts. */
export const inject = ['tools', 'storageDomain']

/** Plugin configuration. */
export interface Config {
  /**
   * How often the live process re-checks for due tasks, in milliseconds.
   * Restart catch-up does not depend on this value: the first reconciliation
   * pass after mount always runs immediately, regardless of the interval.
   */
  pollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  pollIntervalMs: z.number().step(1).min(1_000).default(30_000),
})

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Stable error for failures not safe to expose in detail. */
function internalError(detail?: string): ScheduleDurableToolError {
  return { code: 'internal_error', message: `The schedule-durable operation failed.${detail === undefined ? '' : ` ${detail}`}` }
}

/**
 * Reconcile one task against a wall-clock instant. Pure and deterministic:
 * every caller (the live poll timer, a restart-time sweep, and every test)
 * passes `nowMs` explicitly, so no part of this decision reads `Date.now()`
 * internally. A due task fires AT MOST ONCE per call, however many
 * occurrences it missed: the next target is always computed strictly after
 * `nowMs`, never by walking forward from the missed occurrence, which is
 * what makes catch-up exactly-once by construction rather than by a counter.
 * @param task - the task's current durable state.
 * @param nowMs - the decision instant, epoch milliseconds.
 * @returns the task's next durable state, plus a dispatch instruction when this pass fires it.
 */
export function reconcileTask(task: DurableTaskRecord, nowMs: number): ReconcileDecision {
  if (task.status !== 'active' || task.nextFireAt === null) return { task }
  if (Date.parse(task.nextFireAt) > nowMs) return { task }
  const firedAt = toUtcInstant(nowMs)
  if (task.schedule.kind === 'once') {
    return {
      task: { ...task, status: 'done', nextFireAt: null, lastFiredAt: firedAt, updatedAt: firedAt },
      dispatch: { firedAt },
    }
  }
  const parsed = parseCron(task.schedule.expression)
  const next = nextFireAfter(parsed, nowMs)
  return {
    task: {
      ...task,
      // A cron rule validated reachable at creation cannot usually become
      // unreachable later; treat the unreachable branch as completion rather
      // than an unrecoverable state so a corrupted store still fails loud
      // only at the schema boundary, not here.
      status: next === undefined ? 'done' : 'active',
      nextFireAt: next === undefined ? null : toUtcInstant(next),
      lastFiredAt: firedAt,
      updatedAt: firedAt,
    },
    dispatch: { firedAt },
  }
}

/** Recompute the correct next-fire target for a task moving from `paused` back to `active`, never by replaying the paused interval. */
export function resumeNextFireAt(schedule: ScheduleSpec, nowMs: number): string | null {
  if (schedule.kind === 'once') {
    const atMs = Date.parse(schedule.at)
    return atMs > nowMs ? schedule.at : toUtcInstant(nowMs)
  }
  const next = nextFireAfter(parseCron(schedule.expression), nowMs)
  return next === undefined ? null : toUtcInstant(next)
}

/** Default dispatcher: records that a task fired and takes no further action. See the README for wiring a real one. */
function recordingDispatcher(ctx: Context): TaskDispatcher {
  return {
    async dispatch(request): Promise<TaskDispatchOutcome> {
      ctx.logger.info(
        `schedule-durable: task '${request.task.id}' fired at ${request.firedAt} with no scheduleDurableDispatcher configured; recorded only.`,
      )
      return { kind: 'dispatched', detail: 'no scheduleDurableDispatcher configured; no action was taken' }
    },
  }
}

/** Owns the open store and the live reconciliation loop; published on `ctx.scheduleDurable`. */
export class ScheduleDurableRuntime {
  constructor(private readonly ctx: Context, readonly store: ScheduleDurableStore) {}

  /** Resolve the configured dispatcher duck-typed, falling back to a safe no-op recorder. */
  private resolveDispatcher(): TaskDispatcher {
    return (this.ctx.get('scheduleDurableDispatcher') as TaskDispatcher | undefined) ?? recordingDispatcher(this.ctx)
  }

  /**
   * Every persisted task, in no particular order.
   * @returns every task record the store holds.
   */
  list(): DurableTaskRecord[] {
    return this.store.list()
  }

  /**
   * Reconcile every task against `nowMs`, firing each due task at most once
   * and persisting its re-armed state, then handing each firing to the
   * configured dispatcher. Safe to call repeatedly (a live poll) or once
   * after a cold start (restart catch-up) — both paths are this one method.
   * @param nowMs - decision instant, epoch milliseconds; defaults to the wall clock.
   * @returns one entry per task fired during this pass.
   */
  async reconcileAll(nowMs: number = Date.now()): Promise<Array<{ id: TaskIdType; outcome: TaskDispatchOutcome }>> {
    const dispatcher = this.resolveDispatcher()
    const fired: Array<{ id: TaskIdType; outcome: TaskDispatchOutcome }> = []
    for (const task of this.store.list()) {
      const decision = reconcileTask(task, nowMs)
      if (decision.dispatch === undefined) continue
      await this.store.put(decision.task)
      let outcome: TaskDispatchOutcome
      try {
        outcome = await dispatcher.dispatch({ task: decision.task, firedAt: decision.dispatch.firedAt })
      } catch (error: unknown) {
        outcome = { kind: 'failed', detail: error instanceof Error ? error.message : String(error) }
      }
      fired.push({ id: task.id, outcome })
    }
    return fired
  }
}

/** Pure generic pending card. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

const SCHEDULE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'cron' },
        expression: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'once' },
        at: { type: 'string', required: true },
      },
    },
  ],
} as const

const NULLABLE_STRING_SCHEMA = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    workspace: { type: 'string', required: true },
    schedule: { ...SCHEDULE_SCHEMA, required: true },
    status: { type: 'string', required: true, enum: ['active', 'paused', 'done'] },
    nextFireAt: { ...NULLABLE_STRING_SCHEMA, required: true },
    lastFiredAt: { ...NULLABLE_STRING_SCHEMA, required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

function basicErrorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

const ERROR_SCHEMAS = [
  basicErrorSchema('invalid_name'),
  basicErrorSchema('invalid_prompt'),
  basicErrorSchema('invalid_workspace'),
  basicErrorSchema('invalid_selector'),
  basicErrorSchema('invalid_cron'),
  basicErrorSchema('invalid_at'),
  basicErrorSchema('not_future'),
  basicErrorSchema('unreachable_rule'),
  basicErrorSchema('task_not_found'),
  basicErrorSchema('invalid_transition'),
  basicErrorSchema('internal_error'),
] as const

const CREATE_OUTPUT_SCHEMA = { oneOf: [TASK_VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
const LIST_OUTPUT_SCHEMA = { oneOf: [{ type: 'array', items: TASK_VIEW_SCHEMA }, ...ERROR_SCHEMAS] } as const
const MUTATE_OUTPUT_SCHEMA = { oneOf: [TASK_VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
const CANCEL_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', required: true }, cancelled: { type: 'boolean', required: true, const: true } },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        cancelled: { type: 'boolean', required: true, const: false },
        code: { type: 'string', required: true, const: 'task_not_found' },
      },
    },
    ...ERROR_SCHEMAS,
  ],
} as const

/** Deterministic model content for every canonical Schedule-Durable value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Validate the shape-only constraints `schedule_durable_create` cannot express through JSON Schema alone. */
function validateCreateArgs(args: {
  name: string
  prompt: string
  workspace: string
  cron?: string
  at?: string
}): ScheduleDurableToolError | undefined {
  if (args.name.trim().length === 0) return { code: 'invalid_name', message: 'name must be non-empty after trimming.' }
  if (args.prompt.trim().length === 0) return { code: 'invalid_prompt', message: 'prompt must be non-empty after trimming.' }
  if (args.workspace.trim().length === 0 || !isAbsolute(args.workspace)) {
    return { code: 'invalid_workspace', message: 'workspace must be a non-empty absolute path.' }
  }
  if ((args.cron !== undefined) === (args.at !== undefined)) {
    return { code: 'invalid_selector', message: 'schedule_durable_create accepts exactly one of cron or at.' }
  }
  return undefined
}

/**
 * Register the five Schedule-Durable tools over one open runtime.
 * @param ctx - context receiving the tool definitions.
 * @param runtime - the open store plus reconciliation, shared by every call.
 * @returns disposers for the five registrations.
 */
export function registerScheduleDurableTools(ctx: Context, runtime: ScheduleDurableRuntime): Array<() => void> {
  const store = runtime.store
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'schedule_durable_create',
    description:
      'Create one durable scheduled task bound to a workspace. It survives a harness restart, unlike a session-local reminder. '
      + 'Supply a non-empty name and prompt, an absolute workspace path, and exactly one of a 5-field cron expression '
      + '(minute hour day-of-month month day-of-week, UTC) or an absolute four-digit-year RFC 3339 UTC at instant strictly in the future.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short operator-facing label for this task.' },
      prompt: { type: 'string', required: true, description: 'Content dispatched when the task fires.' },
      workspace: { type: 'string', required: true, description: 'Absolute directory this task is bound to.' },
      cron: { type: 'string', description: '5-field cron expression (minute hour day-of-month month day-of-week), interpreted in UTC.' },
      at: { type: 'string', description: 'Absolute four-digit-year RFC 3339 UTC instant, strictly in the future.' },
    },
    output: { schema: CREATE_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<ScheduleDurableCreateValue> {
      const invalid = validateCreateArgs(args)
      if (invalid !== undefined) return invalid
      const nowMs = Date.now()
      let schedule: ScheduleSpec
      let nextFireAt: string
      if (args.cron !== undefined) {
        let parsed
        try {
          parsed = parseCron(args.cron)
        } catch (error: unknown) {
          return error instanceof CronParseError ? { code: 'invalid_cron', message: error.message } : internalError()
        }
        const next = nextFireAfter(parsed, nowMs)
        if (next === undefined) {
          return { code: 'unreachable_rule', message: 'This cron expression cannot produce a future firing within the supported horizon.' }
        }
        schedule = { kind: 'cron', expression: args.cron }
        nextFireAt = toUtcInstant(next)
      } else {
        const at = args.at as string
        if (!UTC_INSTANT.test(at) || !Number.isFinite(Date.parse(at))) {
          return { code: 'invalid_at', message: 'at must be a four-digit-year RFC 3339 UTC instant, e.g. 2026-09-16T12:00:00.000Z.' }
        }
        if (Date.parse(at) <= nowMs) return { code: 'not_future', message: 'at must be strictly in the future.' }
        schedule = { kind: 'once', at }
        nextFireAt = at
      }
      const nowIso = toUtcInstant(nowMs)
      const record: DurableTaskRecord = {
        id: allocateTaskId(),
        name: args.name,
        prompt: args.prompt,
        workspace: args.workspace,
        schedule,
        status: 'active',
        nextFireAt,
        lastFiredAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      try {
        await store.put(record)
      } catch (error: unknown) {
        return internalError(error instanceof Error ? error.message : undefined)
      }
      return record
    },
    presentCall: args => present('Create durable task', 'other', args.name),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'schedule_durable_list',
    description: 'List every durable task in this store, active, paused, or done, in no particular order.',
    parameters: {},
    output: { schema: LIST_OUTPUT_SCHEMA, render: renderValue },
    async execute(): Promise<ScheduleDurableListValue> {
      return store.list()
    },
    presentCall: () => present('List durable tasks', 'read'),
  })))

  const requireTask = (id: string): DurableTaskView | ScheduleDurableToolError => {
    const task = store.get(TaskId(id))
    return task ?? { code: 'task_not_found', message: `no durable task '${id}' in this store.` }
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'schedule_durable_pause',
    description: 'Pause one active durable task by id. Pausing an already-paused task is a no-op; pausing a done task is refused.',
    parameters: { id: { type: 'string', required: true, description: 'Task id returned by schedule_durable_create or schedule_durable_list.' } },
    output: { schema: MUTATE_OUTPUT_SCHEMA, render: renderValue },
    async execute({ id }): Promise<ScheduleDurableMutateValue> {
      const found = requireTask(id)
      if ('code' in found) return found
      if (found.status === 'done') return { code: 'invalid_transition', message: 'a done task cannot be paused.' }
      if (found.status === 'paused') return found
      const updated: DurableTaskRecord = { ...found, status: 'paused', updatedAt: toUtcInstant(Date.now()) }
      try {
        await store.put(updated)
      } catch (error: unknown) {
        return internalError(error instanceof Error ? error.message : undefined)
      }
      return updated
    },
    presentCall: args => present('Pause durable task', 'other', args.id),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'schedule_durable_resume',
    description:
      'Resume one paused durable task by id, recomputing its next fire strictly after now. Resuming an already-active task is a no-op; resuming a done task is refused.',
    parameters: { id: { type: 'string', required: true, description: 'Task id returned by schedule_durable_create or schedule_durable_list.' } },
    output: { schema: MUTATE_OUTPUT_SCHEMA, render: renderValue },
    async execute({ id }): Promise<ScheduleDurableMutateValue> {
      const found = requireTask(id)
      if ('code' in found) return found
      if (found.status === 'done') return { code: 'invalid_transition', message: 'a done task cannot be resumed.' }
      if (found.status === 'active') return found
      const nowMs = Date.now()
      const nextFireAt = resumeNextFireAt(found.schedule, nowMs)
      const updated: DurableTaskRecord = {
        ...found,
        status: nextFireAt === null ? 'done' : 'active',
        nextFireAt,
        updatedAt: toUtcInstant(nowMs),
      }
      try {
        await store.put(updated)
      } catch (error: unknown) {
        return internalError(error instanceof Error ? error.message : undefined)
      }
      return updated
    },
    presentCall: args => present('Resume durable task', 'other', args.id),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'schedule_durable_cancel',
    description: 'Cancel and durably remove one task by id. Unknown or already-cancelled ids report cancelled false without error.',
    parameters: { id: { type: 'string', required: true, description: 'Task id returned by schedule_durable_create or schedule_durable_list.' } },
    output: { schema: CANCEL_OUTPUT_SCHEMA, render: renderValue },
    async execute({ id }): Promise<ScheduleDurableCancelValue> {
      const taskId = TaskId(id)
      let existed: boolean
      try {
        existed = await store.delete(taskId)
      } catch (error: unknown) {
        return internalError(error instanceof Error ? error.message : undefined)
      }
      return existed ? { id: taskId, cancelled: true } : { id: taskId, cancelled: false, code: 'task_not_found' }
    },
    presentCall: args => present('Cancel durable task', 'other', args.id),
  })))

  return disposers
}

/**
 * Mount Schedule-Durable: open the store, register the five tools, run one
 * immediate reconciliation pass (restart catch-up), then poll on the
 * configured interval.
 * @param ctx - plugin context; must carry `tools` and `storageDomain`.
 * @param config - validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const store = await ScheduleDurableStore.open(ctx.storageDomain)
  const runtime = new ScheduleDurableRuntime(ctx, store)
  ctx.provide('scheduleDurable', runtime)

  const disposers = registerScheduleDurableTools(ctx, runtime)

  // Restart catch-up: the first pass after mount always runs, independent of the poll interval.
  await runtime.reconcileAll()
  const interval = setInterval(() => {
    runtime.reconcileAll().catch((error: unknown) => {
      ctx.logger.warn(`schedule-durable: reconciliation pass failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, config.pollIntervalMs)
  interval.unref?.()

  ctx.effect(() => async () => {
    clearInterval(interval)
    for (const dispose of disposers) dispose()
    await store.close()
  }, 'schedule-durable.dispose')
}
