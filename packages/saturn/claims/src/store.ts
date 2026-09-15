/**
 * The durable claim ledger: one JSON document per workspace, replaced
 * atomically, mutated only under a cross-process lock.
 *
 * The document lives under the harness home (`<DSH_HOME>/claims/ledgers`),
 * never inside the user's repository, so taking a claim cannot dirty a working
 * tree, appear in a diff, or reach a commit. It is keyed by workspace rather
 * than by session because a claim outlives the session that took it: that is
 * what lets a peer read ownership it did not witness being declared, and what
 * lets a lane survive the restart of the process that held it.
 *
 * Concurrency is the whole point of this module, so it is layered explicitly:
 * {@link withFileLock} serializes the read-modify-write cycle across
 * processes, and {@link writeFileAtomic} makes the commit atomic, so a reader
 * never observes a half-written ledger and a losing writer never resurrects a
 * state another writer just replaced.
 *
 * One thing is added on top of that primitive. Its lock deliberately never
 * removes an existing lock, because file age alone cannot prove the owner
 * stopped — orphan recovery is left to an operator. For a ledger whose whole
 * value proposition is self-healing leases that is not enough: a swarm cell
 * killed mid-claim would leave a lock that fails every later writer until a
 * human noticed. So a timed-out contender may break a lock only when the lock's
 * own recorded owner is provably gone, or when the lock is old enough that no
 * short read-modify-write could still be inside it.
 *
 * @module @saturnai/dsh-claims/store
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { emptyLedger } from './ledger.ts'
import { parseLedger } from './types.ts'
import type { ClaimBaseline, ClaimLedger } from './types.ts'

/** Directory name of the claim ledger store under the harness home. */
export const CLAIM_STORE_DIR = 'claims'

/** Permission bits for a ledger: owner-only, since scopes can name private work. */
const LEDGER_MODE = 0o600

/** Permission bits for the directories this module creates. */
const DIR_MODE = 0o700

/**
 * How long a contention waits before it is reported as a timeout. Claims are a
 * read and a small render, so this is generous by an order of magnitude.
 */
const DEFAULT_LOCK_WAIT_MS = 10_000

/**
 * How old an ownerless lock must be before a contender treats it as debris.
 * Only consulted when the lock carries no usable pid; an owner that is
 * provably gone is recovered immediately regardless of age.
 */
const STALE_LOCK_MS = 30_000

/** Options for one claim store. */
export interface ClaimStoreOptions {
  /**
   * Maximum time to wait for the ledger's writer lock, in milliseconds.
   * Exposed so a test can exercise contention and stale-lock recovery without
   * waiting out the production timeout.
   */
  readonly lockWaitMs?: number
}

/** The ledger document path for one workspace, plus the operations over it. */
export interface ClaimStore {
  /** Absolute root directory of the ledger store. */
  readonly root: string
  /** The absolute ledger document path governing one workspace. */
  readonly ledgerPath: (workspaceRoot: string) => string
  /**
   * Read one workspace's ledger, or an empty one when none exists yet.
   * @param workspaceRoot - the absolute workspace root.
   */
  readonly read: (workspaceRoot: string) => Promise<ClaimLedger>
  /**
   * Run one read-modify-write cycle under the cross-process lock.
   * @param workspaceRoot - the absolute workspace root.
   * @param work - receives the current ledger, returns the next one plus a result.
   * @returns the work's result.
   */
  readonly mutate: <T>(
    workspaceRoot: string,
    work: (ledger: ClaimLedger) => Promise<LedgerMutation<T>> | LedgerMutation<T>,
  ) => Promise<T>
}

/** One mutation: the complete next ledger, plus what to hand back to the caller. */
export interface LedgerMutation<T> {
  /** The complete next ledger to commit. */
  readonly ledger: ClaimLedger
  /** The value returned to the caller. */
  readonly result: T
}

/**
 * One workspace's stable ledger key.
 *
 * The key is a digest of the resolved root, not the root itself, so a path
 * containing characters a filesystem dislikes still yields a usable filename,
 * and folding case on Windows keeps one workspace from splitting into two
 * ledgers that cannot see each other.
 * @param workspaceRoot - the absolute workspace root.
 * @returns a lowercase hex key, 16 characters.
 */
export function workspaceKey(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot)
  const canonical = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * Open the claim store at a root directory, creating nothing until the first
 * commit.
 * @param rootDir - store root; defaults to `<DSH_HOME>/claims`.
 * @param options - acquisition options; omitted waits the production default.
 * @returns the store handle.
 */
export function claimStore(
  rootDir: string = dshHomePath(CLAIM_STORE_DIR),
  options: ClaimStoreOptions = {},
): ClaimStore {
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS
  const ledgerPath = (workspaceRoot: string): string =>
    join(rootDir, 'ledgers', `${workspaceKey(workspaceRoot)}.json`)

  const readOrEmpty = async (path: string, workspaceRoot: string): Promise<ClaimLedger> => {
    try {
      return parseLedger(await readFile(path, 'utf8'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyLedger(resolve(workspaceRoot))
      }
      // Never replace a ledger that exists but does not parse: silently
      // starting fresh would drop live claims and hand a second writer a file
      // another agent still believes it owns.
      throw error
    }
  }

  return {
    root: rootDir,
    ledgerPath,
    read: async (workspaceRoot: string) => await readOrEmpty(ledgerPath(workspaceRoot), workspaceRoot),
    mutate: async <T>(
      workspaceRoot: string,
      work: (ledger: ClaimLedger) => Promise<LedgerMutation<T>> | LedgerMutation<T>,
    ): Promise<T> => {
      const path = ledgerPath(workspaceRoot)
      // withFileLock requires the parent to exist; it is created here because
      // the lock is taken before writeFileAtomic would create it.
      await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
      return await withRecoveredLock(path, lockWaitMs, async () => {
        const current = await readOrEmpty(path, workspaceRoot)
        const outcome = await work(current)
        await writeFileAtomic(path, `${JSON.stringify(outcome.ledger, null, 2)}\n`, {
          mode: LEDGER_MODE,
          dirMode: DIR_MODE,
        })
        return outcome.result
      })
    },
  }
}

/**
 * Read one path's identity, or null when it is absent.
 * @param absolute - the absolute path to observe.
 * @returns its modification time and size, or null.
 */
export async function statIdentity(absolute: string): Promise<ClaimBaseline | null> {
  try {
    const info = await stat(absolute)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Whether one operating-system process is still running. */
function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM means the process exists but belongs to another user: alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether a failed acquisition reported the lock timeout rather than a real error. */
function isLockTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes('timed out waiting for the writer lock')
}

/**
 * Whether a lock may be broken by a contender that could not acquire it.
 *
 * The lock file holds its owner's pid, so the strong case is proof: the owner
 * is not running, and the lock is therefore debris. The weak case is the lock
 * carrying no usable pid at all; then age is the only evidence, and it is
 * accepted only past a threshold far longer than any claim mutation takes.
 * @param lockPath - the `<ledger>.lock` sibling.
 * @param now - the instant to age the lock against.
 * @returns true when the lock is safe to remove.
 */
async function lockIsRecoverable(lockPath: string, now: number): Promise<boolean> {
  let raw: string
  let mtimeMs: number
  try {
    const [text, info] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)])
    raw = text
    mtimeMs = info.mtimeMs
  } catch {
    // The lock vanished between the timeout and this probe, so a plain retry
    // is safe and needs no removal.
    return true
  }
  const pid = Number.parseInt(raw.trim(), 10)
  if (Number.isSafeInteger(pid) && pid > 0) return !isProcessAlive(pid)
  return now - mtimeMs >= STALE_LOCK_MS
}

/**
 * Take the writer lock, breaking provably-dead debris once before giving up.
 * @param filename - the file whose writers this serializes.
 * @param waitMs - maximum time to wait for the lock, in milliseconds.
 * @param operation - the read-modify-write cycle to run while holding the lock.
 * @returns the operation's result.
 */
async function withRecoveredLock<T>(
  filename: string,
  waitMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await withFileLock(filename, operation, { waitMs })
  } catch (error: unknown) {
    if (!isLockTimeout(error)) throw error
    const lockPath = `${filename}.lock`
    if (!await lockIsRecoverable(lockPath, Date.now())) throw error
    await rm(lockPath, { force: true })
    return await withFileLock(filename, operation, { waitMs })
  }
}
