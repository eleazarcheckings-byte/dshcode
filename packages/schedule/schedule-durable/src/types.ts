/**
 * Durable, workspace-bound Schedule-Durable value types. Types only — no runtime code.
 * @module @deepseek-ai/dsh-schedule-durable
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity for one durable task, unique for the lifetime of its store. */
export type TaskId = Branded<'ScheduleDurableTaskId'>

/** A recurring rule over the standard 5-field cron syntax (minute hour day-of-month month day-of-week), interpreted in UTC. */
export interface CronScheduleSpec {
  readonly kind: 'cron'
  /** The raw 5-field expression as supplied at creation. */
  readonly expression: string
}

/** A single future firing at one absolute instant. */
export interface OnceScheduleSpec {
  readonly kind: 'once'
  /** Four-digit-year RFC 3339 UTC target. */
  readonly at: string
}

/** The v1 durable schedule rule union. */
export type ScheduleSpec = CronScheduleSpec | OnceScheduleSpec

/** Lifecycle state of one durable task. `done` applies only to a fired `once` task; `cancelled` records are removed, never stored. */
export type TaskStatus = 'active' | 'paused' | 'done'

/** One durable, workspace-bound scheduled task as persisted through the storage-domain seam. */
export interface DurableTaskRecord {
  /** Store-local stable identity, never reused within one store. */
  readonly id: TaskId
  /** Short operator-supplied label; not interpreted. */
  readonly name: string
  /** Prompt content dispatched when the task fires. */
  readonly prompt: string
  /** Absolute workspace directory this task is bound to; the dispatcher runs its session there. */
  readonly workspace: string
  /** The recurrence or one-shot rule. */
  readonly schedule: ScheduleSpec
  /** Current lifecycle state. */
  readonly status: TaskStatus
  /**
   * Next UTC instant this task is due, or `null` when no future firing
   * remains (a `done` one-shot). Meaningful for firing only while `status`
   * is `active`.
   */
  readonly nextFireAt: string | null
  /** UTC instant of the most recent successful dispatch, or `null` before the first firing. */
  readonly lastFiredAt: string | null
  /** UTC creation instant. */
  readonly createdAt: string
  /** UTC instant of the most recent durable mutation. */
  readonly updatedAt: string
}

/** Model-facing view of one durable task; currently identical in shape to the durable record. */
export type DurableTaskView = DurableTaskRecord

/** One decision made while reconciling a single task against a wall-clock instant. */
export interface ReconcileDecision {
  /** The task's durable state after reconciliation; always written back to the store. */
  readonly task: DurableTaskRecord
  /** Present exactly when this reconciliation pass fired the task; absent otherwise. */
  readonly dispatch?: {
    readonly firedAt: string
  }
}

/** Outcome of handing one firing to the configured dispatcher. */
export type TaskDispatchOutcome =
  | { readonly kind: 'dispatched'; readonly detail?: string }
  | { readonly kind: 'failed'; readonly detail: string }

/** One firing handed to the configured dispatcher. */
export interface TaskDispatchRequest {
  readonly task: DurableTaskRecord
  /** UTC instant this firing was accepted at (the reconciliation decision time, not the original due time). */
  readonly firedAt: string
}

/** Pluggable seam a deployment composes to make a firing take action; see the package README. */
export interface TaskDispatcher {
  dispatch(request: TaskDispatchRequest): Promise<TaskDispatchOutcome>
}

/** Stable error returned for an empty or whitespace-only name. */
export interface InvalidNameError {
  readonly code: 'invalid_name'
  readonly message: string
}

/** Stable error returned for an empty or whitespace-only prompt. */
export interface InvalidPromptError {
  readonly code: 'invalid_prompt'
  readonly message: string
}

/** Stable error returned for a missing, empty, or non-absolute workspace path. */
export interface InvalidWorkspaceError {
  readonly code: 'invalid_workspace'
  readonly message: string
}

/** Stable error returned for a missing, conflicting selector (`cron` xor `at`). */
export interface InvalidSelectorError {
  readonly code: 'invalid_selector'
  readonly message: string
}

/** Stable error returned for a syntactically or semantically invalid cron expression. */
export interface InvalidCronError {
  readonly code: 'invalid_cron'
  readonly message: string
}

/** Stable error returned for an `at` value that is not a strict four-digit-year RFC 3339 UTC instant. */
export interface InvalidAtError {
  readonly code: 'invalid_at'
  readonly message: string
}

/** Stable error returned when an absolute `at` target is not strictly future. */
export interface NotFutureError {
  readonly code: 'not_future'
  readonly message: string
}

/** Stable error returned when a rule can never produce a future firing within the supported horizon. */
export interface UnreachableRuleError {
  readonly code: 'unreachable_rule'
  readonly message: string
}

/** Stable error returned when the named task does not exist in this store. */
export interface TaskNotFoundError {
  readonly code: 'task_not_found'
  readonly message: string
}

/** Stable error returned when a mutation is requested against a task that is not in the state it requires. */
export interface InvalidTransitionError {
  readonly code: 'invalid_transition'
  readonly message: string
}

/** Stable fallback that does not disclose an internal exception. */
export interface InternalScheduleDurableError {
  readonly code: 'internal_error'
  readonly message: string
}

/** Closed v1 Schedule-Durable management error union. */
export type ScheduleDurableToolError =
  | InvalidNameError
  | InvalidPromptError
  | InvalidWorkspaceError
  | InvalidSelectorError
  | InvalidCronError
  | InvalidAtError
  | NotFutureError
  | UnreachableRuleError
  | TaskNotFoundError
  | InvalidTransitionError
  | InternalScheduleDurableError

/** Canonical `schedule_durable_create` value. */
export type ScheduleDurableCreateValue = DurableTaskView | ScheduleDurableToolError

/** Canonical `schedule_durable_list` value. */
export type ScheduleDurableListValue = DurableTaskView[] | ScheduleDurableToolError

/** Canonical `schedule_durable_pause` / `schedule_durable_resume` value. */
export type ScheduleDurableMutateValue = DurableTaskView | ScheduleDurableToolError

/** Successful `schedule_durable_cancel` value, including the non-mutating not-found result. */
export type ScheduleDurableCancelResult =
  | { readonly id: TaskId; readonly cancelled: true }
  | { readonly id: TaskId; readonly cancelled: false; readonly code: 'task_not_found' }

/** Canonical `schedule_durable_cancel` value. */
export type ScheduleDurableCancelValue = ScheduleDurableCancelResult | ScheduleDurableToolError
