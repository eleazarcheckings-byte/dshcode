/**
 * Isolated checkouts for Team members, and the one road back.
 *
 * A teammate spawned with `isolation: "worktree"` gets a real `git worktree`
 * checked out from the Lead's HEAD, outside the repository, under the harness
 * home. Inside it, that member is alone: its formatter, its code generator, its
 * half-finished refactor are invisible to every peer, and no claim is needed to
 * touch its own files, because nobody else can see them.
 *
 * The cost of isolation is that work has to come back, and `merge` is where the
 * coordination that isolation deferred is finally paid. The diff is collected
 * whole (staged with `add -A`, so new files count and ignored build output does
 * not), every path it touches is named, and the patch is applied with
 * `git apply` — which refuses the whole patch when any hunk fails, so the Lead
 * workspace never ends up half-merged.
 *
 * The pattern is ported from SaturnBot's local adapter
 * (`packages/saturn/saturnbot/src/adapters/local.ts`), which has used
 * `git worktree add --detach` per task since it was written. What is not ported
 * is its process supervision and redaction: SaturnBot runs arbitrary
 * model-chosen validation commands, while every argv here is fixed by this
 * file, with the paths the only variable.
 *
 * @module @saturnai/dsh-agent-team/worktree
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { TeamError } from './error.ts'

const run = promisify(execFile)

/** Directory holding every Team worktree, under the harness home. */
export const WORKTREE_DIR = 'worktrees'

/** Environment variable naming the harness home. */
const HOME_ENV = 'DSH_HOME'

/** Default harness home directory name under the user's home. */
const HOME_DIR = '.dsh'

/** Largest git output this module accepts, in bytes. A diff beyond it is a merge nobody should make blind. */
const MAX_GIT_OUTPUT = 64 * 1024 * 1024

/** One member's isolated checkout. */
export interface WorktreeRecord {
  /** Absolute path of the checkout. */
  readonly path: string
  /** The exact commit it was created from. */
  readonly baseRevision: string
}

/** Everything one checkout changed since it was created. */
export interface WorktreeChange {
  /** Repository-relative POSIX paths the diff touches, sorted. */
  readonly paths: string[]
  /** The complete patch, or the empty string when nothing changed. */
  readonly patch: string
}

/** Reduce one identity to a single safe path segment. */
function segment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/gu, '-').replace(/^[-.]+/u, '').slice(0, 64)
  return cleaned === '' ? 'team' : cleaned
}

/** The harness home this deployment writes user data under. */
function harnessHome(): string {
  const configured = process.env[HOME_ENV]
  return configured === undefined || configured === '' ? join(homedir(), HOME_DIR) : configured
}

/** Creates, inspects, merges, and removes the isolated checkouts of one Team. */
export class WorktreeManager {
  /** Absolute directory every checkout is created under. */
  readonly root: string

  /**
   * @param root - directory holding the checkouts; defaults to `<DSH_HOME>/worktrees`.
   */
  constructor(root: string = join(harnessHome(), WORKTREE_DIR)) {
    this.root = resolve(root)
  }

  /**
   * Whether a workspace is inside a git repository with a commit to branch from.
   * @param workspace - the Lead's workspace.
   * @param signal - caller cancellation.
   * @returns true when a worktree can be created from it.
   */
  async isRepository(workspace: string, signal: AbortSignal): Promise<boolean> {
    try {
      await this.git(workspace, ['rev-parse', 'HEAD'], signal)
      return true
    } catch {
      return false
    }
  }

  /**
   * Create one member's checkout from the workspace's current HEAD.
   * @param workspace - the Lead's workspace, inside the repository to copy.
   * @param teamId - the Team's identity, used as the containing directory.
   * @param member - the member's durable name.
   * @param signal - caller cancellation.
   * @returns the checkout path and the commit it was taken from.
   * @throws {TeamError} when the workspace is not a usable repository.
   */
  async create(workspace: string, teamId: string, member: string, signal: AbortSignal): Promise<WorktreeRecord> {
    let baseRevision: string
    try {
      baseRevision = await this.git(workspace, ['rev-parse', 'HEAD'], signal)
    } catch (error: unknown) {
      throw new TeamError(
        `worktree isolation needs a git repository with at least one commit at "${workspace}"`,
        'TEAM_WORKTREE_UNAVAILABLE',
        { cause: error },
      )
    }
    const path = join(this.root, segment(teamId), segment(member))
    await mkdir(dirname(path), { recursive: true })
    await rm(path, { recursive: true, force: true })
    try {
      await this.git(workspace, ['worktree', 'add', '--detach', path, baseRevision], signal)
    } catch (error: unknown) {
      await this.discard(workspace, path)
      throw new TeamError(
        `creating the isolated checkout for "${member}" failed: ${String(error)}`,
        'TEAM_WORKTREE_UNAVAILABLE',
        { cause: error },
      )
    }
    return { path, baseRevision }
  }

  /**
   * Remove one checkout and its registration.
   * @param workspace - the repository the checkout belongs to.
   * @param path - the checkout to remove.
   * @param signal - caller cancellation.
   */
  async remove(workspace: string, path: string, signal: AbortSignal): Promise<void> {
    try {
      await this.git(workspace, ['worktree', 'remove', '--force', path], signal)
    } catch {
      // A checkout whose registration git no longer accepts is still a
      // directory this Team created, and leaving it behind would leak the
      // member's work into the next run under the same name.
      await this.discard(workspace, path)
    }
  }

  /**
   * Collect everything one checkout changed, as a single patch.
   * @param path - the checkout to read.
   * @param signal - caller cancellation.
   * @returns the touched paths and the complete patch.
   */
  async collect(path: string, signal: AbortSignal): Promise<WorktreeChange> {
    // Staging is what makes new files part of the diff; ignored build output
    // stays out because `add -A` honors the repository's own ignore rules.
    await this.git(path, ['add', '-A', '--'], signal)
    const names = await this.git(path, ['diff', '--cached', '--name-only', '--no-renames', '-z'], signal)
    const paths = names.split('\0').filter(name => name !== '').sort()
    if (paths.length === 0) return { paths: [], patch: '' }
    const patch = await this.git(path, ['diff', '--cached', '--binary', '--no-renames'], signal, true)
    return { paths, patch }
  }

  /**
   * Apply one collected patch into a workspace, whole or not at all.
   * @param workspace - the workspace to change.
   * @param patch - a patch produced by {@link collect}.
   * @param signal - caller cancellation.
   * @throws {TeamError} when the patch does not apply cleanly; nothing is changed.
   */
  async apply(workspace: string, patch: string, signal: AbortSignal): Promise<void> {
    if (patch === '') return
    const root = await this.git(workspace, ['rev-parse', '--show-toplevel'], signal)
    const file = join(this.root, '.patches', `${randomUUID()}.patch`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf8')
    try {
      // `git apply` verifies every hunk before it writes the first one, so a
      // patch that cannot land leaves the workspace exactly as it was.
      await this.git(root, ['apply', '--whitespace=nowarn', '--', file], signal)
    } catch (error: unknown) {
      throw new TeamError(
        `the teammate diff does not apply to this workspace: ${String(error)}`,
        'TEAM_MERGE_CONFLICT',
        { cause: error },
      )
    } finally {
      await rm(file, { force: true })
    }
  }

  /**
   * The repository root a workspace belongs to.
   * @param workspace - a directory inside the repository.
   * @param signal - caller cancellation.
   * @returns the absolute top-level directory.
   */
  async repositoryRoot(workspace: string, signal: AbortSignal): Promise<string> {
    return resolve(await this.git(workspace, ['rev-parse', '--show-toplevel'], signal))
  }

  /**
   * The directory inside a checkout that stands where a workspace stands.
   *
   * `git worktree add` always checks out the whole repository, so a Lead whose
   * session sits in `<repo>/app` would otherwise hand its teammate the checkout
   * ROOT — a different depth, and therefore a different claim space, since
   * claims are recorded against a workspace. The teammate's lease on
   * `src/app.ts` would be filed under the repository while the Lead's merge
   * asked about it under `<repo>/app`, and the lease would be invisible exactly
   * when it matters. Mirroring the depth keeps one surface with one name on
   * both sides.
   * @param workspace - the Lead's workspace, inside the repository.
   * @param checkout - the checkout root created by {@link create}.
   * @param signal - caller cancellation.
   * @returns the corresponding directory inside the checkout, created if absent.
   */
  async checkoutWorkspace(workspace: string, checkout: string, signal: AbortSignal): Promise<string> {
    const root = await this.repositoryRoot(workspace, signal)
    const within = relative(root, resolve(workspace))
    if (within === '' || within.startsWith('..') || isAbsolute(within)) return checkout
    const path = join(checkout, within)
    // A directory tracked only through ignored files — or through files added
    // after the base commit — is absent from a checkout of HEAD, and a session
    // cannot start in a directory that does not exist.
    await mkdir(path, { recursive: true })
    return path
  }

  /** Remove a checkout directory and any registration git still holds for it. */
  private async discard(workspace: string, path: string): Promise<void> {
    await rm(path, { recursive: true, force: true })
    try {
      await run('git', ['-C', workspace, 'worktree', 'prune'], { windowsHide: true })
    } catch {
      // Pruning is cleanup of git's own bookkeeping; the directory is already
      // gone, and a repository that cannot be pruned is not this Team's failure.
    }
  }

  /** Run one fixed git builtin and return its trimmed output. */
  private async git(cwd: string, args: readonly string[], signal: AbortSignal, raw = false): Promise<string> {
    signal.throwIfAborted()
    // `core.autocrlf` is a machine-level preference, and isolation must be
    // byte-faithful: a checkout that rewrote line endings on the way out and a
    // merge that rewrote them on the way back would turn a one-line change into
    // a whole-file diff on some developers' machines and not on others. A
    // repository that genuinely wants CRLF still says so in `.gitattributes`,
    // which is honored either way.
    const { stdout } = await run('git', ['-C', cwd, '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', ...args], {
      signal,
      windowsHide: true,
      maxBuffer: MAX_GIT_OUTPUT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    })
    return raw ? stdout : stdout.trim()
  }
}
