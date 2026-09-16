/**
 * Shared path resolution, workspace confinement, and regular-file validation
 * for the document tool suite. `ctx.fs` backends resolve paths but do not all
 * confine them (the bare local backend is a resolution default, not a
 * containment boundary), so this module enforces containment against the
 * plugin's configured `workspaceRoot` explicitly, the way a stricter backend
 * or a `tools/execute` permission plugin would.
 * @module @deepseek-ai/dsh-tool-document/workspace
 */

import { isAbsolute, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { DocumentError } from './error.ts'

/** Caps shared by every document tool. */
export interface DocumentToolCaps {
  /** Absolute root a resolved target must stay within; see {@link isWithinRoot}. */
  workspaceRoot: string
  /** Inclusive byte cap on the whole file read into memory. */
  maxFileBytes: number
}

/**
 * Whether `candidate` is `root` itself or a descendant of it. Uses
 * `path.relative` so the check is exact regardless of trailing separators or
 * case-sensitivity quirks the two inputs might otherwise disagree on.
 * @param root - an absolute directory path.
 * @param candidate - an absolute path to test for containment.
 * @returns `true` when `candidate` does not escape `root` via `..` or land on a different root entirely.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve a model-supplied path, confine it to the workspace root, observe
 * absence, and require a regular file — the document-tool analog of
 * `resolveRegularReadTarget` in `@deepseek-ai/dsh-tool-fs`, plus the explicit
 * containment check that backend does not provide.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @param workspaceRoot - the confined root; see {@link DocumentToolCaps.workspaceRoot}.
 * @returns the resolved target and its single stat result.
 */
export async function resolveWorkspaceDocument(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  workspaceRoot: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  if (requestedPath.trim().length === 0) {
    throw new DocumentError('file_path must be a non-empty string', 'DOCUMENT_EMPTY_PATH')
  }
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
  if (!isWithinRoot(workspaceRoot, target.displayPath)) {
    throw new DocumentError(
      `cannot read "${target.displayPath}": path is outside the workspace root "${workspaceRoot}"`,
      'DOCUMENT_PATH_OUTSIDE_WORKSPACE',
    )
  }
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new DocumentError(`cannot read "${target.displayPath}": not found`, 'DOCUMENT_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new DocumentError(`cannot read "${target.displayPath}": not a regular file`, 'DOCUMENT_NOT_REGULAR_FILE')
  }
  return { target, info }
}
