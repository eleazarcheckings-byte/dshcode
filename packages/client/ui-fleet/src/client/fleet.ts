/**
 * The fleet fold: published session facts → one route line per delegated
 * worker.
 *
 * Pure and dependency-free so the mapping is provable in isolation. Every input
 * field is a fact another layer already publishes; nothing here is fetched,
 * counted twice, or invented. There is no percentage, no elapsed time, no token
 * or cost figure, and no second metric per row — the four statuses are the
 * whole vocabulary:
 *
 * - `waiting-for-you` — a Session-scoped UI consumer published a pending
 *   interaction, so nothing moves until the human answers. The interaction's
 *   own `kind` rides along as `need`.
 * - `blocked` — the worker's goal reports a blocked phase with the
 *   host-authored reason, or a background job it holds ended in failure. The
 *   line names the blocker.
 * - `running` — the session's agent is running right now.
 * - `done` — it stopped and the list still holds the completion reminder the
 *   sidebar shows as its green "done" dot.
 *
 * Nothing else earns a line: a settled worker with no news is not a route, so
 * it is omitted rather than printed as filler. Zero lines is a legitimate,
 * designed answer.
 *
 * Lineage follows the same discipline as the shipped descendant projection
 * (`packages/client/ui-subagent/src/client/subagent-lineage.ts`): only
 * subagent-origin sessions are delegated workers, traversal stops at an
 * ordinary fork (that fork starts its own fleet), and a cycle is dropped rather
 * than thrown on.
 */
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The four states a route line can carry. */
export type FleetStatus = 'waiting-for-you' | 'blocked' | 'running' | 'done'

/** Rank for ordering: the human's attention first, settlement last. */
const RANK: Record<FleetStatus, number> = {
  'waiting-for-you': 0,
  blocked: 1,
  running: 2,
  done: 3,
}

/**
 * Raw worker facts, read once from session state. Nothing in here is derived a
 * second time: `running`, `completed`, `projectionValues`, the job list, and
 * the pending-interaction map are each the single authority for their own fact.
 */
export interface FleetWorker {
  readonly id: SessionId
  readonly parentId?: SessionId
  /** Durable origin; only `subagent` sessions are delegated workers. */
  readonly origin?: 'subagent'
  /** Human-facing route label: durable title, project basename, then the id. */
  readonly label: string
  /** The session's agent is running right now. */
  readonly running: boolean
  /** Kind of the pending interaction a Session-scoped UI consumer published. */
  readonly pendingKind?: string
  /** Host-authored explanation published while the worker's goal is blocked. */
  readonly blockedReason?: string
  /** Label of a background job this worker holds that ended in failure. */
  readonly failedJob?: string
  /** The list still holds the completion reminder (the sidebar's green bit). */
  readonly completed?: boolean
}

/** One route line: the route label, its single state, and the fact naming it. */
export type FleetLine =
  | { readonly status: 'waiting-for-you'; readonly id: SessionId; readonly label: string; readonly need: string }
  | { readonly status: 'blocked'; readonly id: SessionId; readonly label: string; readonly blocker: string }
  | { readonly status: 'running'; readonly id: SessionId; readonly label: string }
  | { readonly status: 'done'; readonly id: SessionId; readonly label: string }

/** Structural view of one session-list row — only the fields this fold reads. */
export interface FleetSessionView {
  readonly id: SessionId
  readonly displayTitle: string
  readonly parentId?: SessionId
  readonly origin?: 'subagent'
  readonly running: boolean
  readonly completed?: boolean
  /** The row's own host-computed projection values (the goal reads its phase). */
  readonly projectionValues?: { readonly goal?: GoalProjection | null }
}

/** Structural view of one background job — only the fields this fold reads. */
export interface FleetJobView {
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
}

/** Structural view of one pending interaction — only the field this fold reads. */
export interface FleetPendingView {
  readonly kind: string
}

/**
 * Non-blank string, or undefined. Every optional fact goes through this so an
 * empty string can never become a visible status word.
 * @param value - the candidate fact.
 * @returns the trimmed value, or undefined when it carries nothing.
 */
function fact(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.trim() === '' ? undefined : value
}

/**
 * The blocked reason a worker's own goal publishes, when it has one.
 * `GoalPhase` is `blocked` exactly while `blockedReason` is present, so the
 * phase is the guard for the message.
 * @param projections - the list row's host-computed projection values.
 * @returns the host-authored reason, or undefined while the goal is not blocked.
 */
function blockedReasonOf(projections: FleetSessionView['projectionValues']): string | undefined {
  const projection = projections?.goal
  if (projection === undefined || projection === null) return undefined
  if (projection.goal.phase !== 'blocked') return undefined
  return fact(projection.goal.blockedReason?.message)
}

/**
 * The failed job a worker still holds. A job that ended on request (`killed`)
 * or is stopping is not a blocker — someone already decided to stop it — so
 * only `failed` counts, and the job's own label names the thing that failed.
 * @param jobs - the jobs the session can see; absent means an empty set.
 * @returns the failed job's label, or undefined when nothing failed.
 */
function failedJobOf(jobs: readonly FleetJobView[] | undefined): string | undefined {
  const failed = jobs?.find(job => job.status === 'failed')
  return failed === undefined ? undefined : fact(failed.label)
}

/**
 * Adapter: the session list's own read models → raw worker facts. Reads only
 * published fields, and reads each fact from one authority.
 * @param sessions - list rows keyed by id (`SessionListState.byId`).
 * @param jobs - background jobs per session (`SessionListState.jobsBySession`).
 * @param pending - pending interactions by session (`useSessionPendingInteraction`).
 * @returns the whole roster; {@link deriveFleet} picks the delegated subtree.
 */
export function fleetRoster(
  sessions: Readonly<Record<SessionId, FleetSessionView>>,
  jobs: Readonly<Record<SessionId, readonly FleetJobView[]>> = {},
  pending: ReadonlyMap<SessionId, FleetPendingView> = new Map(),
): Readonly<Record<SessionId, FleetWorker>> {
  const roster: Record<SessionId, FleetWorker> = {}
  for (const session of Object.values(sessions)) {
    const need = fact(pending.get(session.id)?.kind)
    const reason = blockedReasonOf(session.projectionValues)
    const failed = failedJobOf(jobs[session.id])
    roster[session.id] = {
      id: session.id,
      label: session.displayTitle,
      running: session.running,
      ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
      ...(session.origin === undefined ? {} : { origin: session.origin }),
      ...(session.completed === true ? { completed: true } : {}),
      ...(need === undefined ? {} : { pendingKind: need }),
      ...(reason === undefined ? {} : { blockedReason: reason }),
      ...(failed === undefined ? {} : { failedJob: failed }),
    }
  }
  return roster
}

/**
 * Fold one worker's facts into its single route line.
 *
 * Precedence is a fact order, not a presentation choice: a human decision
 * outranks every other stop, because nothing else can move until it is
 * answered; a declared blocker outranks plain activity; activity outranks
 * settlement.
 * @param worker - the worker's raw facts.
 * @returns the line, or undefined when the worker is settled with no news.
 */
export function fleetLine(worker: FleetWorker): FleetLine | undefined {
  if (worker.pendingKind !== undefined) {
    return { status: 'waiting-for-you', id: worker.id, label: worker.label, need: worker.pendingKind }
  }
  if (worker.blockedReason !== undefined) {
    return { status: 'blocked', id: worker.id, label: worker.label, blocker: worker.blockedReason }
  }
  if (worker.failedJob !== undefined) {
    return { status: 'blocked', id: worker.id, label: worker.label, blocker: worker.failedJob }
  }
  if (worker.running) return { status: 'running', id: worker.id, label: worker.label }
  if (worker.completed === true) return { status: 'done', id: worker.id, label: worker.label }
  return undefined
}

/**
 * The delegated workers under one root, in host-list order with each worker's
 * descendants adjacent to it (the lineage-adjacency rule the sidebar's
 * flattening uses).
 * @param rootId - the session whose fleet is being shown.
 * @param workers - the whole roster.
 * @returns the subtree, nearest first.
 */
export function fleetWorkers(
  rootId: SessionId | undefined,
  workers: Readonly<Record<SessionId, FleetWorker>>,
): FleetWorker[] {
  if (rootId === undefined) return []
  const children = new Map<SessionId, FleetWorker[]>()
  for (const worker of Object.values(workers)) {
    if (worker.origin !== 'subagent' || worker.parentId === undefined) continue
    const siblings = children.get(worker.parentId)
    if (siblings === undefined) children.set(worker.parentId, [worker])
    else siblings.push(worker)
  }
  const out: FleetWorker[] = []
  const seen = new Set<SessionId>([rootId])
  const walk = (parentId: SessionId): void => {
    const kids = children.get(parentId)
    if (kids === undefined) return
    for (const kid of kids) {
      // The host list cannot repeat an id; this only fires on corrupt input,
      // and a cycle must not become an infinite render.
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      out.push(kid)
      walk(kid.id)
    }
  }
  walk(rootId)
  return out
}

/**
 * Derive the whole surface: the root's non-settled workers, attention first.
 * Ties keep the lineage order, so the list never reshuffles between renders.
 * @param rootId - the session whose fleet is being shown.
 * @param workers - the whole roster.
 * @returns the route lines, or an empty list when nothing is delegated.
 */
export function deriveFleet(
  rootId: SessionId | undefined,
  workers: Readonly<Record<SessionId, FleetWorker>>,
): FleetLine[] {
  const lines: FleetLine[] = []
  for (const worker of fleetWorkers(rootId, workers)) {
    const line = fleetLine(worker)
    if (line !== undefined) lines.push(line)
  }
  return lines.sort((left, right) => RANK[left.status] - RANK[right.status])
}
