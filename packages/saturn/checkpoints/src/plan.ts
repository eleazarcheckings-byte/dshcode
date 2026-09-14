/**
 * The pure half of the checkpoint feature: path normalization, the mutation
 * vocabulary this feature shares with the turn receipt, the open-turn lookup,
 * and the restore plan. Everything here is decision + arithmetic over strings
 * — no filesystem, no clock, no session — so the guarantees that make a
 * restore safe ("only inside the workspace", "never into node_modules or the
 * installed app", "fail closed when a recorded path cannot be applied") are
 * unit-testable on their own.
 *
 * @module @saturnai/dsh-checkpoints/plan
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CheckpointEntry, CheckpointRecord } from './types.ts'

/**
 * Path segments a restore must never write through. `node_modules` is the
 * installed dependency tree (writing there while the app is running replaces
 * modules the host process has already loaded), and `.git` is repository
 * internals no file mutation has business rewriting.
 */
const GUARDED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', '.git'])

/** Where one mutation named its file, relative to the session's workspace. */
export type NormalizedPath =
  | { readonly kind: 'inside'; readonly rel: string; readonly absolute: string }
  | { readonly kind: 'outside' }

/**
 * Resolve one mutation's path against the session workspace, or report that it
 * escapes it. An absolute path is taken as given; a relative one is resolved
 * against the workspace root, exactly as the tools resolve it.
 * @param workspaceRoot - the session's working directory.
 * @param candidate - the path a mutation named, absolute or workspace-relative.
 * @returns the workspace-relative POSIX spelling plus its absolute form, or `outside`.
 */
export function normalizeWorkspacePath(workspaceRoot: string, candidate: string): NormalizedPath {
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  const rel = relative(root, absolute)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { kind: 'outside' }
  }
  return { kind: 'inside', rel: rel.split(sep).join('/'), absolute }
}

/** Whether `target` sits at or under `root`, comparing the way the platform does. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * The reason a path may never be written by a restore, or null when it is
 * ordinary workspace content.
 * @param absolute - the resolved target path.
 * @param installRoot - the installed app tree, or null when unknown.
 * @returns the refusal reason, or null.
 */
export function guardRefusal(absolute: string, installRoot: string | null): string | null {
  const segments = resolve(absolute).split(/[\\/]+/)
  for (const segment of segments) {
    if (GUARDED_SEGMENTS.has(segment.toLowerCase())) {
      return `refuses to write through "${segment}"`
    }
  }
  if (installRoot !== null && isInside(installRoot, absolute)) {
    return 'refuses to write inside the installed app'
  }
  return null
}

/**
 * The path a first-party mutation call targets, or null when the call is not a
 * supported mutation.
 *
 * This is deliberately the SAME vocabulary the turn receipt's produced-file
 * record is built from (`@deepseek-ai/dsh-client-ui-deliverables`): a
 * checkpoint covers exactly the files the receipt names as changed, so the two
 * rows of the composer card cannot disagree about what a turn did. Shell
 * redirection and third-party writers are outside that vocabulary and outside
 * this feature.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the named path, or null when the call is not a supported mutation.
 */
export function mutationPath(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  return mutationPathFromArgs(name, args)
}

/**
 * The path a first-party mutation call targets, from the ALREADY-PARSED
 * arguments the tool registry dispatches with — the form the capture hook
 * holds.
 * @param name - wire tool name.
 * @param args - parsed arguments as the registry dispatched them.
 * @returns the named path, or null when the call is not a supported mutation.
 */
export function mutationPathFromArgs(name: string, args: unknown): string | null {
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}

/** Validate the fields an `edit` execution requires before trusting its path. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The two facts of a session log this feature folds for its turn binding. */
export interface TurnBoundaryEvent {
  readonly type: string
  readonly data?: unknown
}

/**
 * The turn currently open in a session log, or null when none is.
 *
 * A capture binds to a turn because that is the boundary the composer already
 * shows: the receipt of a turn and the checkpoint taken as it began are the
 * same unit of work. A log whose newest `turn/end` follows its newest
 * `turn/start` has no open turn, so tool activity outside a turn (a command
 * dispatch) records nothing.
 * @param events - the session's event log, oldest first.
 * @returns the open turn number, or null.
 */
export function openTurn(events: readonly TurnBoundaryEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as TurnBoundaryEvent
    if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
    if (event.type === 'turn/end') return null
    const turn = turnOf(event.data)
    return typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 ? turn : null
  }
  return null
}

/** The turn number one boundary event carries, when it carries a usable one. */
function turnOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const turn = (data as { readonly turn?: unknown }).turn
  return typeof turn === 'number' ? turn : null
}

/** One file a restore must put back, with everything the apply step needs. */
export interface RestoreWrite {
  /** Workspace-relative POSIX path, as recorded. */
  readonly path: string
  /** The absolute path this restore resolves it to, inside the workspace. */
  readonly absolute: string
  /** Content address of the recorded bytes. */
  readonly hash: string
  /** Recorded byte length, so the apply step can prove the blob is whole. */
  readonly bytes: number
}

/** One file a restore must remove: recorded absent, and now present. */
export interface RestoreRemove {
  /** Workspace-relative POSIX path, as recorded. */
  readonly path: string
  /** The absolute path this restore resolves it to, inside the workspace. */
  readonly absolute: string
}

/** One recorded path a restore will not touch, and why. */
export interface RestoreLeftAlone {
  /** The path as recorded. */
  readonly path: string
  /** `not-captured` — the capture could not record it (see the record's skips). */
  readonly why: 'not-captured'
}

/** Everything a restore intends, and every reason it must refuse wholesale. */
export interface RestorePlan {
  /** Whether the plan may be applied; false when any refusal stands. */
  readonly ok: boolean
  /** Files to rewrite with their recorded bytes, in record order. */
  readonly writes: readonly RestoreWrite[]
  /** Files to remove (recorded absent, created by the work being undone). */
  readonly removes: readonly RestoreRemove[]
  /** Recorded paths this restore leaves untouched because they were never captured. */
  readonly leftAlone: readonly RestoreLeftAlone[]
  /** Human-readable reasons the restore must not run; any one fails the plan. */
  readonly refusals: readonly string[]
}

/** What a restore needs to know about the session and the machine it runs on. */
export interface RestoreContext {
  /** The session's workspace root, or null when it has none (nothing is restorable). */
  readonly workspaceRoot: string | null
  /** The installed app tree a restore must never write into, or null when unknown. */
  readonly installRoot: string | null
}

/**
 * Plan a restore of one checkpoint, refusing wholesale rather than partially.
 *
 * Every recorded path is re-resolved under the live workspace root and
 * re-guarded, so a checkpoint recorded in one directory can never be applied
 * to another, and a path that has since become a `node_modules` or installed-app
 * location is refused rather than written. Paths the capture skipped are
 * reported as left alone — they were never recorded, so they are not the
 * restore's to touch.
 * @param context - the session's workspace root and the installed app tree.
 * @param record - the checkpoint to restore.
 * @returns the plan, with `ok: false` and the refusals when it must not run.
 */
export function planRestore(context: RestoreContext, record: CheckpointRecord): RestorePlan {
  const refusals: string[] = []
  const writes: RestoreWrite[] = []
  const removes: RestoreRemove[] = []
  const leftAlone: RestoreLeftAlone[] = record.skipped.map(path => ({ path, why: 'not-captured' }))

  if (context.workspaceRoot === null) {
    refusals.push('this session has no workspace to restore into')
  }
  if (context.workspaceRoot !== null && record.workspaceRoot !== null
    && resolve(record.workspaceRoot) !== resolve(context.workspaceRoot)) {
    refusals.push(`this checkpoint records "${record.workspaceRoot}", not the session's "${context.workspaceRoot}"`)
  }
  if (context.workspaceRoot !== null && context.installRoot !== null
    && isInside(context.installRoot, context.workspaceRoot)) {
    refusals.push('this workspace is the installed app itself, which a restore never writes into')
  }

  const root = context.workspaceRoot
  if (root !== null) {
    const seen = new Set<string>()
    for (const entry of record.entries) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      const normalized = normalizeWorkspacePath(root, entry.path)
      if (normalized.kind === 'outside') {
        refusals.push(`recorded path "${entry.path}" is outside the workspace`)
        continue
      }
      const guarded = guardRefusal(normalized.absolute, context.installRoot)
      if (guarded !== null) {
        refusals.push(`recorded path "${entry.path}": ${guarded}`)
        continue
      }
      collect(entry, normalized.absolute, writes, removes)
    }
  }

  return refusals.length === 0
    ? { ok: true, writes, removes, leftAlone, refusals }
    // Fail closed: a plan carrying any refusal offers NOTHING to apply, so a
    // caller that ignores `ok` still cannot half-restore what was refused.
    : { ok: false, writes: [], removes: [], leftAlone: [], refusals }
}

/** Route one recorded entry into the writes or the removes it implies. */
function collect(
  entry: CheckpointEntry,
  absolute: string,
  writes: RestoreWrite[],
  removes: RestoreRemove[],
): void {
  if (entry.state.kind === 'absent') {
    removes.push({ path: entry.path, absolute })
    return
  }
  writes.push({ path: entry.path, absolute, hash: entry.state.hash, bytes: entry.state.bytes })
}

/**
 * The paths a capture must record to make a restore undoable: every path the
 * restore will write or remove. Captured as they stand right now, they are the
 * recorded state a later restore puts back.
 * @param plan - the restore about to be applied.
 * @returns the workspace-relative paths to record, first-seen order.
 */
export function undoPaths(plan: RestorePlan): readonly string[] {
  const paths: string[] = []
  for (const write of plan.writes) paths.push(write.path)
  for (const remove of plan.removes) paths.push(remove.path)
  return paths
}

/** One path's recorded state, before it becomes part of a checkpoint. */
export interface CapturedPath {
  /** Workspace-relative POSIX path. */
  readonly path: string
  /** What the path held when the capture ran. */
  readonly state: CheckpointEntry['state']
}

/** The outcome of reading the paths one capture covers. */
export interface CaptureOutcome {
  /** The paths that were recorded, first-seen order. */
  readonly entries: readonly CapturedPath[]
  /** In-workspace paths that could not be recorded, first-seen order. */
  readonly skipped: readonly string[]
}

/**
 * Merge one new path's capture into a checkpoint's outcome, keeping the FIRST
 * capture of each path. A turn that writes and then edits one file is one
 * entry — the state the file held before the turn touched it — which is what
 * makes the restore that turn's undo.
 * @param outcome - the outcome so far.
 * @param path - the newly captured path.
 * @param state - the state recorded at the first capture of that path.
 * @returns the extended outcome, or the same one when the path is already recorded.
 */
export function mergeCapture(outcome: CaptureOutcome, path: string, state: CapturedPath['state']): CaptureOutcome {
  if (outcome.entries.some(entry => entry.path === path)) return outcome
  return { entries: [...outcome.entries, { path, state }], skipped: outcome.skipped }
}
