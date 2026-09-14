/**
 * The impure half of the checkpoint feature: reading the paths a capture
 * records, and putting recorded bytes back.
 *
 * Two directions, one law: a capture reads content and records it under its
 * content address; a restore writes that content back through
 * `@deepseek-ai/dsh-atomic-write`'s stage-then-rename primitive, so a reader of
 * a restored file sees either the old bytes or the recorded ones and never a
 * half-written file. Nothing here decides WHAT to restore — that is
 * `./plan.ts` — and nothing here is destructive: the apply step only rewrites
 * the recorded set and removes paths the record itself says were absent.
 *
 * @module @saturnai/dsh-checkpoints/capture
 */

import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { CaptureOutcome, CapturedPath, RestoreLeftAlone, RestorePlan } from './plan.ts'
import { hashOfBytes, type CheckpointStore } from './store.ts'

/**
 * Largest file a capture records. Workspace files worth checkpointing are
 * sources and documents; a larger file is recorded as skipped (and reported by
 * the restore as left alone) rather than read whole into memory.
 */
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024

/** Permission bits stamped on a restored file that did not exist before the restore. */
const DEFAULT_RESTORE_MODE = 0o644

/** What one capture needs to read the paths it covers. */
export interface CaptureRequest {
  /** The session's workspace root; captures record nothing without one. */
  readonly workspaceRoot: string | null
  /** Workspace-relative POSIX paths to record, in first-seen order. */
  readonly paths: readonly string[]
  /** The content-addressed store the recorded bytes land in. */
  readonly store: CheckpointStore
  /** Capture budget per file; defaults to {@link MAX_CAPTURE_BYTES}. */
  readonly maxBytes?: number
}

/**
 * Read the named paths and record their exact bytes, once.
 *
 * A missing path is recorded as the positive fact `absent` — the mutation
 * about to run will create it, and that is exactly what a restore must undo. A
 * path that cannot be recorded at all is reported in `skipped` and never
 * restored, so an unreadable or oversized file degrades to "left alone" rather
 * than to a broken checkpoint. A path outside the workspace is not this
 * feature's to record and is not mentioned at all.
 * @param request - the workspace root, the paths, and the store.
 * @returns the recorded entries plus the in-workspace paths that were skipped.
 */
export async function capturePaths(request: CaptureRequest): Promise<CaptureOutcome> {
  const root = request.workspaceRoot
  if (root === null) return { entries: [], skipped: [] }
  const maxBytes = request.maxBytes ?? MAX_CAPTURE_BYTES
  return await captureInto(request.store, root, request.paths, maxBytes)
}

/** Read one list of workspace-relative paths into a fresh outcome. */
async function captureInto(
  store: CheckpointStore,
  root: string,
  paths: readonly string[],
  maxBytes: number,
): Promise<CaptureOutcome> {
  const entries: CapturedPath[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue
    seen.add(path)
    const absolute = join(root, path)
    let size: number
    try {
      const info = await stat(absolute)
      if (!info.isFile()) {
        skipped.push(path)
        continue
      }
      size = info.size
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entries.push({ path, state: { kind: 'absent' } })
        continue
      }
      skipped.push(path)
      continue
    }
    if (size > maxBytes) {
      skipped.push(path)
      continue
    }
    try {
      const bytes = await readFile(absolute)
      const hash = hashOfBytes(bytes)
      await store.putBlob(hash, bytes)
      entries.push({ path, state: { kind: 'blob', hash, bytes: bytes.byteLength } })
    } catch {
      skipped.push(path)
    }
  }
  return { entries, skipped }
}

/** One reason a restore cannot be applied as planned. */
export interface RestoreIssue {
  /** The workspace-relative path at fault. */
  readonly path: string
  /** The human-readable reason. */
  readonly reason: string
}

/**
 * Prove a restore can be applied BEFORE anything is written: every recorded
 * blob must still be in the store with exactly its recorded bytes, and no path
 * the restore would remove may have become a directory.
 * @param store - the store holding the recorded bytes.
 * @param plan - the plan to verify.
 * @returns every issue found; an empty list means the restore may proceed.
 */
export async function verifyRestore(store: CheckpointStore, plan: RestorePlan): Promise<readonly RestoreIssue[]> {
  const issues: RestoreIssue[] = []
  for (const write of plan.writes) {
    try {
      const bytes = await store.readBlob(write.hash)
      if (bytes.byteLength !== write.bytes) {
        issues.push({ path: write.path, reason: `the recorded blob holds ${bytes.byteLength} bytes, not ${write.bytes}` })
        continue
      }
      if (hashOfBytes(bytes) !== write.hash) {
        issues.push({ path: write.path, reason: 'the recorded blob does not hash to its address' })
      }
    } catch (error: unknown) {
      issues.push({ path: write.path, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const remove of plan.removes) {
    try {
      if ((await stat(remove.absolute)).isDirectory()) {
        issues.push({ path: remove.path, reason: 'a directory now stands where the record says no file existed' })
      }
    } catch {
      // Absent already: the removal is a no-op, not a problem.
    }
  }
  return issues
}

/** What a restore actually did, including a partial outcome after a failure. */
export interface RestoreReport {
  /** Paths rewritten with their recorded bytes, in application order. */
  readonly written: readonly string[]
  /** Paths removed, in application order. */
  readonly removed: readonly string[]
  /** Recorded paths left untouched because they were never captured. */
  readonly leftAlone: readonly RestoreLeftAlone[]
  /** The first failure that stopped the restore, or null when it completed. */
  readonly failure: { readonly path: string; readonly message: string } | null
}

/**
 * Apply a verified restore. Each file is replaced atomically, so no reader ever
 * observes a partial file; a failure stops the run and is reported with the
 * paths already applied, which the pre-restore checkpoint can put back.
 *
 * A refused plan never reaches the filesystem: the apply step re-checks `ok`
 * and throws, so a caller that skipped the guard gets a loud error instead of
 * a silent no-op that looks like a successful restore.
 * @param store - the store holding the recorded bytes.
 * @param plan - the verified plan to apply.
 * @returns what was written, what was removed, and any failure.
 * @throws when the plan carries refusals (`ok: false`).
 */
export async function applyRestore(store: CheckpointStore, plan: RestorePlan): Promise<RestoreReport> {
  if (!plan.ok) {
    throw new Error(`refusing to apply a refused restore plan: ${plan.refusals.join('; ')}`)
  }
  const written: string[] = []
  const removed: string[] = []
  for (const write of plan.writes) {
    try {
      const bytes = await store.readBlob(write.hash)
      await writeFileAtomic(write.absolute, bytes, { mode: await restoreMode(write.absolute) })
      written.push(write.path)
    } catch (error: unknown) {
      return { written, removed, leftAlone: plan.leftAlone, failure: { path: write.path, message: messageOf(error) } }
    }
  }
  for (const remove of plan.removes) {
    try {
      await rm(remove.absolute, { force: true })
      removed.push(remove.path)
    } catch (error: unknown) {
      return { written, removed, leftAlone: plan.leftAlone, failure: { path: remove.path, message: messageOf(error) } }
    }
  }
  return { written, removed, leftAlone: plan.leftAlone, failure: null }
}

/** Keep a restored file's existing permission bits; a fresh file gets the default. */
async function restoreMode(absolute: string): Promise<number> {
  try {
    return (await stat(absolute)).mode & 0o777
  } catch {
    return DEFAULT_RESTORE_MODE
  }
}

/** One error's message, whatever shape it arrived in. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
