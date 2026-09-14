/**
 * Pure types of the definition-of-done domain: the ONE home of the `done`
 * projection-key declaration plus the durable payload vocabulary it carries,
 * free of this package's host-side value imports (cordis, dsh-agent, zod).
 * Two namespace projections serve it — `./types` for host consumers and
 * `./client` (the browser half-entry's re-export) for client aggregates —
 * with zero content duplication.
 *
 * @module @saturnai/dsh-done/types
 */

/**
 * Whether the stated definition of done has been *proven*. Doctrine: "'Done'
 * means proven. Tests pass, smoke passes, the thing actually runs — not
 * hoped. Missing evidence is NOT_ASSESSED and never counts as green." A
 * statement is `stated` from the moment it is written and becomes `proven`
 * only when it carries the evidence that met it.
 */
export type DoneStatus = 'stated' | 'proven'

/**
 * One durable definition of done: the short contract a piece of work is
 * striving against, plus the evidence that met it.
 */
export interface DoneState {
  /**
   * One or two sentences naming what is being built and how we will know it
   * is finished. Concrete enough that a stranger could falsify it.
   */
  readonly statement: string
  /** `stated` until evidence exists; `proven` only alongside {@link evidence}. */
  readonly status: DoneStatus
  /**
   * One-line citation of the evidence that proved it (what was run and what
   * it showed). Present exactly when `status` is `proven`.
   */
  readonly evidence?: string
  /** Epoch milliseconds of the latest durable mutation. */
  readonly at: number
}

/**
 * The `done` projection value: the session's current definition of done, or
 * `null` before the first statement and after a clear. Capability absence
 * (this plugin not composed) is the key's absence, never a value.
 */
export type DoneProjection = DoneState | null

/** Host fold state used to derive {@link DoneProjection}. */
export interface DoneUnitState {
  /** Latest durable definition of done, or null while none is stated. */
  readonly current: DoneState | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whole-value replace of this session's definition of done: log-only,
     * non-surface. The last `done/change` wins; a log with none folds to
     * `null` — no definition of done has been stated yet.
     */
    'done/change': { readonly next: DoneState | null }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host definition-of-done fold state. */
    done: DoneUnitState
  }
  interface SessionProjectionMap {
    /** The session's current definition of done, or `null` when none is stated. */
    done: DoneProjection
  }
}
