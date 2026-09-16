/**
 * Pure types of the orchestrate domain: the ONE home of the `orchestrate`
 * projection-key declaration and its log-only mode event, free of this
 * package's host-side value imports (cordis, dsh-agent, zod). Two namespace
 * projections serve it — `./types` for host consumers and `./client` for
 * client aggregates — with zero content duplication.
 *
 * @module @saturnai/dsh-orchestrate/types
 */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether multi-task mode is in force from this point on: log-only,
     * non-surface, whole-value replace. The last `orchestrate/mode` wins; a log
     * with none folds to **inactive** through the projection unit's init, so a
     * fresh session is a single straight thread until someone turns it on.
     */
    'orchestrate/mode': { active: boolean }
  }
}

/**
 * The orchestrate projection's wire value. `active` is the logged state in
 * force (the last `orchestrate/mode`, **inactive** before the first); `pending`
 * is true while a queued selection targets a state other than `active` and no
 * later `orchestrate/mode` event has recorded that state. Capability absence
 * (this plugin not composed) is the key's absence, never a value.
 */
export interface OrchestrateProjection {
  active: boolean
  pending: boolean
}

/** Host state used to derive {@link OrchestrateProjection}. */
export interface OrchestrateUnitState {
  /** Logged multi-task mode; false until an `orchestrate/mode` turns it on. */
  active: boolean
  /** Active state recorded by the latest `request/header`, or null before one. */
  activeAtLastHeader: boolean | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host multi-task fold state. */
    orchestrate: OrchestrateUnitState
  }
  interface SessionProjectionMap {
    /** Per-session multi-task state folded from the `orchestrate/mode` events. */
    orchestrate: OrchestrateProjection
  }
}
