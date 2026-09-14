/**
 * Pure types of the checkpoint domain: the ONE home of the `checkpoints`
 * projection-key declaration plus the durable payload vocabulary it carries,
 * free of this package's host-side value imports (cordis, dsh-agent, zod).
 * Two namespace projections serve it — `./types` for host consumers and
 * `./client` (the browser half-entry's re-export) for client aggregates —
 * with zero content duplication.
 *
 * A checkpoint is a *point-in-time record of the files a turn is about to
 * mutate*, held as content-addressed blobs outside the user's repository. The
 * record itself is small — workspace-relative paths plus one sha-256 per file —
 * so the session log stays the catalog while the bytes live in the blob store.
 *
 * @module @saturnai/dsh-checkpoints/types
 */

/**
 * Why a checkpoint exists. `turn` is the automatic capture taken as a turn
 * began mutating the workspace; `pre-restore` is the automatic capture taken
 * immediately BEFORE a restore overwrites files, which is what makes one-click
 * restore itself undoable.
 */
export type CheckpointReason = 'turn' | 'pre-restore'

/**
 * What one recorded path held at capture time: the exact content (a
 * content-addressed blob) or the positive fact that the path did not exist.
 * Absence is a recorded fact, never missing data — restoring a path recorded
 * `absent` removes the file the turn created.
 */
export type CheckpointEntryState =
  | {
    readonly kind: 'blob'
    /** Lowercase hex sha-256 of the recorded bytes; the blob store's address. */
    readonly hash: string
    /** Recorded byte length, carried so the row can state a size without reading the blob. */
    readonly bytes: number
  }
  | { readonly kind: 'absent' }

/** One path this checkpoint recorded, as it stood when the capture ran. */
export interface CheckpointEntry {
  /** Workspace-relative path in POSIX spelling; the restore resolves it under the workspace root. */
  readonly path: string
  /** The recorded state of that path. */
  readonly state: CheckpointEntryState
}

/** One durable checkpoint: what it covers, when it was taken, and why. */
export interface CheckpointRecord {
  /** Session-scoped identity, stable across resume and fork; `/checkpoint restore <id>` takes it. */
  readonly id: string
  /** Epoch milliseconds of the capture. */
  readonly createdAt: number
  /** Why this checkpoint exists. */
  readonly reason: CheckpointReason
  /** The turn this capture opened in, or null for a capture outside a turn (pre-restore). */
  readonly turn: number | null
  /** The session's workspace root at capture time, or null when the session has none. */
  readonly workspaceRoot: string | null
  /** Every path recorded, first-seen order, one entry per path. */
  readonly entries: readonly CheckpointEntry[]
  /**
   * In-workspace paths the capture could NOT record (unreadable, or larger
   * than the capture budget). A skipped path is never restored — a restore
   * reports it as left alone — so a checkpoint can be partial but never
   * destructive.
   */
  readonly skipped: readonly string[]
}

/** The compact per-checkpoint fact a client renders and restores by. */
export interface CheckpointSummary {
  /** The checkpoint's identity. */
  readonly id: string
  /** Epoch milliseconds of the capture. */
  readonly createdAt: number
  /** Why this checkpoint exists. */
  readonly reason: CheckpointReason
  /** The turn it opened in, or null when it opened outside a turn. */
  readonly turn: number | null
  /** How many paths this checkpoint recorded. */
  readonly files: number
}

/**
 * The `checkpoints` projection value: how many checkpoints this session holds,
 * the newest summary, and the newest summaries a client may list (bounded so a
 * long session's change feed stays small). Capability absence (this plugin not
 * composed) is the key's absence, never a value.
 */
export interface CheckpointsProjection {
  /** Total checkpoints recorded in this session. */
  readonly count: number
  /** The newest checkpoint, or null when the session has none. */
  readonly latest: CheckpointSummary | null
  /** The newest {@link MAX_WIRE_CHECKPOINTS} summaries, newest first. */
  readonly entries: readonly CheckpointSummary[]
}

/** Host fold state used to derive {@link CheckpointsProjection}. */
export interface CheckpointsUnitState {
  /** Every checkpoint this session recorded, keyed by id. */
  readonly byId: Readonly<Record<string, CheckpointRecord>>
  /** Checkpoint ids in creation order. */
  readonly order: readonly string[]
}

/**
 * How many entries the wire view carries. The fold keeps every checkpoint, so
 * `/checkpoint` still lists and restores an older one; the client's row only
 * needs the newest few, and a bounded view keeps each change push small.
 */
export const MAX_WIRE_CHECKPOINTS = 24

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whole-value replace of ONE checkpoint record, keyed by its id: log-only,
     * non-surface. A capture that extends an open checkpoint re-emits it with
     * the added entry, so the last event for an id is that checkpoint's
     * complete recorded state. A log with none folds to an empty catalog.
     */
    'checkpoints/change': { readonly next: CheckpointRecord }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host checkpoint-catalog fold state. */
    checkpoints: CheckpointsUnitState
  }
  interface SessionProjectionMap {
    /** This session's checkpoints, newest first, and how many exist. */
    checkpoints: CheckpointsProjection
  }
}
