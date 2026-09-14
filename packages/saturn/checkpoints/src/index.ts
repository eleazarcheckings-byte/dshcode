/**
 * Code checkpoints, host half: the session-scoped record of the files a turn
 * is about to change, plus the `/checkpoint` command that puts them back.
 *
 * The feature exists because the destructive half of an agent's work is the
 * half a person cannot see coming. Every turn that mutates the workspace
 * therefore opens a checkpoint BEFORE the first mutation lands: the exact
 * bytes of each file the turn is about to write, held under the harness home
 * (`<DSH_HOME>/checkpoints`) as content-addressed blobs, outside the user's
 * repository, so recording never dirties a working tree. The record itself —
 * workspace-relative paths and one sha-256 each — rides the session log as the
 * `checkpoints` projection, so it survives resume and fork with the session it
 * belongs to.
 *
 * Restoring is one command and one click, and it is itself undoable: before a
 * restore rewrites anything it records the CURRENT bytes of every path it is
 * about to touch, so the restore that just ran is the next checkpoint in the
 * list. Nothing outside the recorded set is ever written or removed, and a
 * restore that would leave the workspace, cross into `node_modules`, or write
 * into the installed app refuses wholesale rather than partially.
 *
 * Capture binds to the same vocabulary the turn receipt shows — first-party
 * `write`, `edit`, and mutating `str_replace_editor` calls — so the paths the
 * receipt names and the files the checkpoint holds cannot disagree, and the
 * turn is the unit both surfaces speak in.
 *
 * @module @saturnai/dsh-checkpoints
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
// Type-only: pulls the commands Context merge (ctx.commands).
import type {} from '@deepseek-ai/dsh-commands'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Type-only: pulls the tools Events merge (the tools/execute wrapper) and the execution shape.
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { applyRestore, capturePaths, verifyRestore, type RestoreReport } from './capture.ts'
import { mutationPathFromArgs, normalizeWorkspacePath, openTurn, planRestore, undoPaths } from './plan.ts'
import { checkpointStore, type CheckpointStore } from './store.ts'
import {
  MAX_WIRE_CHECKPOINTS,
  type CheckpointEntry,
  type CheckpointRecord,
  type CheckpointsProjection,
  type CheckpointsUnitState,
} from './types.ts'

export type {
  CheckpointEntry,
  CheckpointEntryState,
  CheckpointReason,
  CheckpointRecord,
  CheckpointSummary,
  CheckpointsProjection,
  CheckpointsUnitState,
} from './types.ts'
export { MAX_WIRE_CHECKPOINTS } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'saturn-checkpoints'

/** The projection registry is this plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** The human command: one logged verb channel for list and restore, no model turn. */
export const CHECKPOINT_COMMAND = 'checkpoint'

/** Longest recorded path the domain admits. */
const MAX_PATH = 4096

/** Longest capture-failure line the command reports. */
const MAX_FAILURE = 400

/** Most paths one checkpoint may record. */
const MAX_ENTRIES = 4096

const checkpointEntrySchema: ZodType<CheckpointEntry> = zod.object({
  path: zod.string().min(1).max(MAX_PATH),
  state: zod.union([
    zod.object({
      kind: zod.literal('blob'),
      hash: zod.string().regex(/^[0-9a-f]{64}$/u),
      bytes: zod.number().int().nonnegative(),
    }).strict(),
    zod.object({ kind: zod.literal('absent') }).strict(),
  ]),
}).strict() as unknown as ZodType<CheckpointEntry>

const checkpointRecordSchema: ZodType<CheckpointRecord> = zod.object({
  id: zod.string().min(1).max(64),
  createdAt: zod.number().int().nonnegative(),
  reason: zod.union([zod.literal('turn'), zod.literal('pre-restore')]),
  turn: zod.number().int().nonnegative().nullable(),
  workspaceRoot: zod.string().min(1).max(MAX_PATH).nullable(),
  entries: zod.array(checkpointEntrySchema).max(MAX_ENTRIES),
  skipped: zod.array(zod.string().min(1).max(MAX_PATH)).max(MAX_ENTRIES),
}).strict() as unknown as ZodType<CheckpointRecord>

const checkpointsUnitStateSchema: ZodType<CheckpointsUnitState> = zod.object({
  byId: zod.record(zod.string(), checkpointRecordSchema),
  order: zod.array(zod.string()),
}).strict() as unknown as ZodType<CheckpointsUnitState>

const checkpointSummarySchema: ZodType<CheckpointsProjection['entries'][number]> = zod.object({
  id: zod.string().min(1).max(64),
  createdAt: zod.number().int().nonnegative(),
  reason: zod.union([zod.literal('turn'), zod.literal('pre-restore')]),
  turn: zod.number().int().nonnegative().nullable(),
  files: zod.number().int().nonnegative(),
}).strict()

const checkpointsViewSchema: ZodType<CheckpointsProjection> = zod.object({
  count: zod.number().int().nonnegative(),
  latest: checkpointSummarySchema.nullable(),
  entries: zod.array(checkpointSummarySchema).max(MAX_WIRE_CHECKPOINTS),
}).strict() as unknown as ZodType<CheckpointsProjection>

/** The compact fact a client row renders: identity, reason, and how many files it covers. */
function summarize(record: CheckpointRecord): CheckpointsProjection['entries'][number] {
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    turn: record.turn,
    files: record.entries.length,
  }
}

/**
 * Logged per-session checkpoint catalog, keyed by checkpoint id. `init` is the
 * empty catalog — no checkpoint exists until a turn opens one — and only
 * `checkpoints/change` events move it. The wire view is the newest
 * {@link MAX_WIRE_CHECKPOINTS} summaries, because the row lists what it can
 * restore and the change feed stays small.
 */
export const checkpointsProjectionDefinition = {
  key: 'checkpoints',
  stateVersion: 1,
  stateSchema: checkpointsUnitStateSchema,
  init: (): CheckpointsUnitState => ({ byId: {}, order: [] }),
  apply: (state, event) => {
    if (event.type !== 'checkpoints/change') return state
    const next = event.data.next
    const existing = state.byId[next.id]
    return {
      byId: { ...state.byId, [next.id]: next },
      order: existing === undefined ? [...state.order, next.id] : state.order,
    }
  },
  wire: {
    viewSchema: checkpointsViewSchema,
    view: (state) => {
      const summaries = state.order
        .map(id => state.byId[id])
        .filter((record): record is CheckpointRecord => record !== undefined)
        .map(record => summarize(record))
      const entries = summaries.slice(-MAX_WIRE_CHECKPOINTS).reverse()
      return { count: summaries.length, latest: entries[0] ?? null, entries }
    },
  },
} satisfies ProjectionDefinition<'checkpoints', CheckpointsUnitState>

/**
 * The installed app tree a restore must never write into, derived exactly the
 * way `scripts\lib-app-stop.ps1` derives it: the app the harness runs from,
 * whose `node_modules` the host process has already loaded.
 * @param env - environment mapping to read; defaults to the process environment.
 * @returns the absolute install root, or null when this machine cannot name it.
 */
export function defaultInstallRoot(env: Record<string, string | undefined> = process.env): string | null {
  const local = env.LOCALAPPDATA
  return typeof local === 'string' && local.trim().length > 0
    ? join(local, 'Programs', '@dshcodedesktop')
    : null
}

/** A checkpoint a turn has opened and is still adding captured paths to. */
interface OpenCapture {
  /** The turn this capture belongs to. */
  readonly turn: number
  /** Epoch milliseconds the capture opened. */
  readonly createdAt: number
  /** Paths recorded so far, first-seen order. */
  readonly entries: readonly CheckpointEntry[]
  /** In-workspace paths that could not be recorded. */
  readonly skipped: readonly string[]
  /** The id this capture committed under, assigned at its first commit. */
  readonly id: string | null
}

/** Per-session capture state and failure memory the plugin owns. */
interface CaptureState {
  /** The open capture per session, keyed by session id. */
  readonly open: Map<string, OpenCapture>
  /** The next checkpoint number per session, keyed by session id. */
  readonly nextId: Map<string, number>
  /** The last capture failure per session, keyed by session id; reported by the command. */
  readonly failures: Map<string, string>
  /** The serialization tail per session, so concurrent calls extend one record in order. */
  readonly tails: Map<string, Promise<unknown>>
}

/**
 * Mount code checkpoints: the projection unit, the pre-mutation capture hook,
 * and the `/checkpoint` command.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  const store = checkpointStore()
  const state: CaptureState = {
    open: new Map(),
    nextId: new Map(),
    failures: new Map(),
    tails: new Map(),
  }

  ctx.sessionProjections.register(checkpointsProjectionDefinition)

  // The capture wrapper. It runs BEFORE the tool body so the bytes it records
  // are the ones the mutation is about to replace, and it never throws or
  // blocks: a checkpoint that cannot be recorded must not fail the work it was
  // going to protect.
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    try {
      await recordMutation(store, state, exec)
    } catch (error: unknown) {
      remember(state, exec.agent?.session.id, error)
    }
    return next()
  })

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: CHECKPOINT_COMMAND,
      description: 'list this session\'s code checkpoints, or restore one',
      input: { hint: '[restore <id>]' },
      handler: (invocation: CommandInvocation): Promise<CommandResult> | CommandResult =>
        run(ctx, store, state, invocation.agent.session, invocation.rawInput.trim()),
    })
  })
}

/** Record one session's last capture failure, bounded, for the command to report. */
function remember(state: CaptureState, sessionId: string | undefined, error: unknown): void {
  if (sessionId === undefined) return
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').trim()
  state.failures.set(sessionId, message.slice(0, MAX_FAILURE))
}

/** Run `work` after every earlier call for the same key settled, in call order. */
async function serialized<T>(state: CaptureState, key: string, work: () => Promise<T>): Promise<T> {
  const previous = state.tails.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  const tail = run.then(() => undefined, () => undefined)
  state.tails.set(key, tail)
  void tail.then(() => {
    if (state.tails.get(key) === tail) state.tails.delete(key)
  })
  return await run
}

/**
 * Record one mutating call's target before it runs.
 *
 * A call that names no path, names a path outside the workspace, or arrives
 * outside an open turn records nothing: this feature covers the files of the
 * session's own workspace, and a turn is the unit its checkpoints are grouped
 * and shown in.
 * @param store - the content-addressed blob store.
 * @param state - per-session capture state.
 * @param exec - the call about to dispatch.
 */
async function recordMutation(
  store: CheckpointStore,
  state: CaptureState,
  exec: ToolDispatchExecution,
): Promise<void> {
  const session = exec.agent?.session
  if (session === undefined) return
  const named = mutationPathFromArgs(exec.name, exec.arguments)
  if (named === null) return
  const turn = openTurn(session.events)
  if (turn === null) return
  const workspaceRoot = session.header.cwd ?? null
  if (workspaceRoot === null) return
  const normalized = normalizeWorkspacePath(workspaceRoot, named)
  if (normalized.kind === 'outside') return
  const relative = normalized.rel

  await serialized(state, session.id, async () => {
    const open = openFor(state, session, turn)
    if (open.entries.length >= MAX_ENTRIES || open.entries.some(entry => entry.path === relative)) return
    const outcome = await capturePaths({ workspaceRoot, paths: [relative], store })
    const captured = outcome.entries[0]
    // A path the capture could not read is recorded as skipped, never as
    // absent: absence would make a restore delete a file that still exists.
    const next: OpenCapture = {
      turn,
      createdAt: open.createdAt,
      entries: captured === undefined ? open.entries : [...open.entries, { path: relative, state: captured.state }],
      skipped: [...open.skipped, ...outcome.skipped],
      id: open.id,
    }
    state.open.set(session.id, next)
    // A capture that holds no file yet is not worth logging; the turn's next
    // mutation commits the record with whatever was recorded by then.
    if (next.entries.length > 0) commit(state, session, next)
  })
}

/** The open capture for this turn, opening one when the turn has none. */
function openFor(state: CaptureState, session: Session, turn: number): OpenCapture {
  const current = state.open.get(session.id)
  if (current !== undefined && current.turn === turn) return current
  const opened: OpenCapture = { turn, createdAt: Date.now(), entries: [], skipped: [], id: null }
  state.open.set(session.id, opened)
  return opened
}

/** The next checkpoint number in one session, dense and stable once assigned. */
function nextId(state: CaptureState, session: Session): string {
  const known = state.nextId.get(session.id) ?? 1
  state.nextId.set(session.id, known + 1)
  return String(known)
}

/** Log an open capture's whole current value, first assigning its id. */
function commit(state: CaptureState, session: Session, open: OpenCapture): CheckpointRecord {
  const id = open.id ?? nextId(state, session)
  const record: CheckpointRecord = {
    id,
    createdAt: open.createdAt,
    reason: 'turn',
    turn: open.turn,
    workspaceRoot: session.header.cwd ?? null,
    entries: [...open.entries],
    skipped: [...open.skipped],
  }
  state.open.set(session.id, { ...open, id })
  session.append('checkpoints/change', { next: record })
  return record
}

/** The session's checkpoint catalog as the fold currently holds it. */
function catalogOf(ctx: Context, session: Session): CheckpointsUnitState {
  return ctx.sessionProjections.stateOf(session, 'checkpoints') ?? { byId: {}, order: [] }
}

/** Every checkpoint this session holds, in creation order. */
function recordsOf(ctx: Context, session: Session): readonly CheckpointRecord[] {
  const catalog = catalogOf(ctx, session)
  return catalog.order
    .map(id => catalog.byId[id])
    .filter((record): record is CheckpointRecord => record !== undefined)
}

/** The command's one-line usage line, shared by every refusal. */
function usage(): string {
  return `Usage: /${CHECKPOINT_COMMAND} [list | restore <id>]`
}

/** Dispatch one `/checkpoint` invocation. */
function run(
  ctx: Context,
  store: CheckpointStore,
  state: CaptureState,
  session: Session,
  input: string,
): Promise<CommandResult> | CommandResult {
  const failure = state.failures.get(session.id)
  state.failures.delete(session.id)
  if (input === '' || input.toLowerCase() === 'list') {
    return { kind: 'success', text: renderList(recordsOf(ctx, session), failure) }
  }
  const restore = /^restore\b/iu.exec(input)
  if (restore !== null) return restoreById(ctx, store, state, session, input.slice(restore[0].length).trim())
  return { kind: 'error', text: `Unknown subcommand.\n${usage()}` }
}

/** Render the catalog: one line per checkpoint, oldest first. */
function renderList(records: readonly CheckpointRecord[], failure: string | undefined): string {
  return [
    records.length === 0
      ? 'No code checkpoints in this session yet.'
      : `Code checkpoints (${records.length}):`,
    ...records.map(record => `  #${record.id}  ${describe(record)}`),
    '',
    usage(),
    ...failure === undefined ? [] : ['', `The last capture failed: ${failure}`],
  ].join('\n')
}

/** One checkpoint's human description: what state it restores, and how much it covers. */
function describe(record: CheckpointRecord): string {
  const target = record.reason === 'pre-restore'
    ? 'before a restore'
    : record.turn === null ? 'outside a turn' : `before turn ${record.turn}`
  const files = record.entries.length === 1 ? '1 file' : `${record.entries.length} files`
  const skipped = record.skipped.length === 0 ? '' : `, ${record.skipped.length} left alone`
  return `${target} · ${files}${skipped}`
}

/**
 * Restore one checkpoint: verify the whole plan, record the current bytes of
 * every path it touches, then apply it.
 * @param ctx - host context carrying the projection registry.
 * @param store - the content-addressed blob store.
 * @param session - the session whose workspace is restored.
 * @param id - the checkpoint id to restore.
 * @returns the command result, always describing what happened (or refused).
 */
async function restoreById(
  ctx: Context,
  store: CheckpointStore,
  state: CaptureState,
  session: Session,
  id: string,
): Promise<CommandResult> {
  const records = recordsOf(ctx, session)
  if (id === '') return { kind: 'error', text: `Restoring needs a checkpoint id.\n${usage()}` }
  const record = records.find(candidate => candidate.id === id)
  if (record === undefined) {
    const known = records.length === 0 ? 'none exist' : records.map(candidate => `#${candidate.id}`).join(', ')
    return { kind: 'error', text: `No checkpoint #${id} in this session (${known}).\n${usage()}` }
  }
  const workspaceRoot = session.header.cwd ?? null
  const plan = planRestore({ workspaceRoot, installRoot: defaultInstallRoot() }, record)
  if (!plan.ok) {
    return {
      kind: 'error',
      text: [`Refusing to restore #${record.id}:`, ...plan.refusals.map(line => `  ${line}`)].join('\n'),
    }
  }
  const issues = await verifyRestore(store, plan)
  if (issues.length > 0) {
    return {
      kind: 'error',
      text: [
        `Refusing to restore #${record.id}: its recorded bytes are not intact.`,
        ...issues.map(issue => `  ${issue.path}: ${issue.reason}`),
      ].join('\n'),
    }
  }
  const undo = await recordUndo(state, store, session, workspaceRoot, plan)
  const report = await applyRestore(store, plan)
  return report.failure === null
    ? { kind: 'success', text: applied(record, report, undo) }
    : { kind: 'error', text: failed(record, report) }
}

/**
 * Record the current state of every path a restore will touch, so the restore
 * is itself undoable. This runs AFTER verification and BEFORE the first write:
 * the checkpoint it commits is the "before the restore" state a person clicks
 * to get back to where they were.
 */
async function recordUndo(
  state: CaptureState,
  store: CheckpointStore,
  session: Session,
  workspaceRoot: string | null,
  plan: Parameters<typeof undoPaths>[0],
): Promise<CheckpointRecord> {
  const outcome = await capturePaths({ workspaceRoot, paths: undoPaths(plan), store })
  const undo: CheckpointRecord = {
    id: nextId(state, session),
    createdAt: Date.now(),
    reason: 'pre-restore',
    turn: null,
    workspaceRoot,
    entries: [...outcome.entries],
    skipped: [...outcome.skipped],
  }
  session.append('checkpoints/change', { next: undo })
  return undo
}

/** The success report: what was put back, what was left alone, and how to undo it. */
function applied(record: CheckpointRecord, report: RestoreReport, undo: CheckpointRecord): string {
  const written = report.written.length === 1 ? '1 file' : `${report.written.length} files`
  const removed = report.removed.length === 0
    ? ''
    : ` and removed ${report.removed.length === 1 ? '1 file it had created' : `${report.removed.length} files it had created`}`
  return [
    `Restored #${record.id} (${describe(record)}): wrote ${written}${removed}.`,
    `Undo: /${CHECKPOINT_COMMAND} restore ${undo.id} puts back the state from just before this restore.`,
    ...report.leftAlone.length === 0
      ? []
      : [`Left alone (never captured by #${record.id}): ${report.leftAlone.map(left => left.path).join(', ')}`],
  ].join('\n')
}

/** The partial-failure report: what applied before the failure, and how to get back. */
function failed(record: CheckpointRecord, report: RestoreReport): string {
  const failure = report.failure
  return [
    `Restore of #${record.id} stopped at ${failure?.path ?? 'an unknown path'}: ${failure?.message ?? ''}`,
    `Applied before stopping: ${report.written.length} written, ${report.removed.length} removed.`,
    'The pre-restore checkpoint records the previous state of every path this restore planned to touch.',
  ].join('\n')
}
