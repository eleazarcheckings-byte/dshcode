/**
 * Claim space: the directory a session's claims are recorded and compared in.
 *
 * For an ordinary session that is simply its working directory, and nothing in
 * this module changes what the ledger already did. The case it exists for is a
 * linked `git worktree`: a teammate handed its own checkout gets its own bytes
 * on purpose, but it must NOT get its own private notion of who owns
 * `src/app.ts`. Two members each holding that path in their own checkout, each
 * believing the surface is theirs, is the same lost-work collision the ledger
 * exists to prevent — arriving later and costing more, because by then both
 * diffs are already written.
 *
 * So a linked worktree resolves to the corresponding directory under the
 * repository's MAIN worktree, and every checkout of one repository therefore
 * reads one ledger, in which a scope names one repository-relative surface.
 * Detection is the worktree's own `.git` FILE (a plain `.git` directory is
 * already the main worktree) plus the `commondir` pointer git writes beside the
 * per-worktree git directory — both are git's own durable record, not a guess
 * about layout. Anything unreadable or unexpected falls back to the directory
 * itself, so an unusual repository degrades to today's behavior rather than to
 * a wrong shared ledger.
 *
 * @module @saturnai/dsh-claims/workspace
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Resolved claim spaces, keyed by the absolute directory asked about.
 *
 * The mapping is a property of the repository's layout, which does not change
 * while a session runs, and it is consulted on every guarded tool call — so it
 * is cached rather than re-derived from the filesystem each time.
 */
const resolved = new Map<string, string>()

/** Forget every cached mapping; for tests that rebuild repositories in place. */
export function resetClaimWorkspaces(): void {
  resolved.clear()
}

/**
 * Resolve the claim space of one working directory.
 * @param cwd - the session's working directory.
 * @returns the directory its claims are recorded against.
 */
export async function claimWorkspace(cwd: string): Promise<string> {
  const start = resolve(cwd)
  const cached = resolved.get(start)
  if (cached !== undefined) return cached
  const space = await resolveWorkspace(start)
  resolved.set(start, space)
  return space
}

/** Map one directory into the main worktree, or return it unchanged. */
async function resolveWorkspace(start: string): Promise<string> {
  try {
    const checkout = await enclosingCheckout(start)
    if (checkout === null) return start
    const main = await mainWorktreeRoot(checkout.gitEntry)
    if (main === null) return start
    return join(main, relative(checkout.root, start))
  } catch {
    // Claim space is an optimization of comparison, never an authority: a
    // repository this module cannot read must not make the ledger unusable.
    return start
  }
}

/** The nearest ancestor holding a `.git` entry, with that entry's path. */
async function enclosingCheckout(start: string): Promise<{ root: string; gitEntry: string } | null> {
  let current = start
  while (true) {
    const gitEntry = join(current, '.git')
    try {
      await stat(gitEntry)
      return { root: current, gitEntry }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * The main worktree root behind one `.git` entry, or null when the entry is
 * already a main worktree or does not describe a linked one.
 */
async function mainWorktreeRoot(gitEntry: string): Promise<string | null> {
  const info = await stat(gitEntry)
  if (info.isDirectory()) return null
  const pointer = /^gitdir:\s*(.+)$/mu.exec(await readFile(gitEntry, 'utf8'))
  if (pointer?.[1] === undefined) return null
  const gitDir = resolve(dirname(gitEntry), pointer[1].trim())
  let common: string
  try {
    common = (await readFile(join(gitDir, 'commondir'), 'utf8')).trim()
  } catch (error: unknown) {
    // A submodule's `.git` file points at a git directory with no `commondir`.
    // It is a repository of its own, so it keeps its own ledger.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (common === '') return null
  const commonGitDir = resolve(gitDir, common)
  const root = dirname(commonGitDir)
  // A bare repository's common directory has no working tree above it.
  return await isDirectory(join(root, '.git')) ? root : null
}

/** Whether one path is an existing directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
