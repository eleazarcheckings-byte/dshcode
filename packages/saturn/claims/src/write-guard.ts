/** Peer-lease enforcement around first-party filesystem tool dispatch. */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { expireClaims, remainingMs } from './ledger.ts'
import { claimWorkspace } from './workspace.ts'
import type { Claim, ScopeConflict } from './types.ts'
import type { ClaimStore } from './store.ts'

/** Return the mutation path from the first-party filesystem tool vocabulary. */
function mutationPath(exec: ToolExecutionInput): string | undefined {
  const args = exec.arguments
  if (typeof args !== 'object' || args === null) return undefined
  if ((exec.name === 'write' || exec.name === 'edit') && 'file_path' in args) {
    return typeof args.file_path === 'string' ? args.file_path : undefined
  }
  if (exec.name === 'str_replace_editor' && 'command' in args && 'path' in args
    && (args.command === 'create' || args.command === 'str_replace' || args.command === 'insert')) {
    return typeof args.path === 'string' ? args.path : undefined
  }
  return undefined
}

/**
 * Compare canonical provider targets so case and symlink aliases share ownership.
 * @param fs - the mounted filesystem provider.
 * @param workspace - the workspace in which claim scopes resolve.
 * @param claims - live leases to check.
 * @param targets - canonical targets about to be acquired or written.
 * @param now - instant used for the reported remaining lease.
 * @param signal - caller cancellation during path resolution.
 * @returns every overlapping claim with its original display scopes.
 */
export async function canonicalConflicts(
  fs: FileSystem,
  workspace: string,
  claims: readonly Claim[],
  targets: readonly FsTarget[],
  now: number,
  signal: AbortSignal,
): Promise<ScopeConflict[]> {
  const conflicts: ScopeConflict[] = []
  for (const claim of claims) {
    const scopes: string[] = []
    for (const scope of claim.scopes) {
      const owned = await fs.resolve(scope, { cwd: workspace, signal })
      if (targets.some(target => fs.contains(owned, target) || fs.contains(target, owned))) scopes.push(scope)
    }
    if (scopes.length > 0) {
      conflicts.push({ claimId: claim.id, lane: claim.lane, holder: claim.holder, remainingMs: remainingMs(claim, now), scopes })
    }
  }
  return conflicts
}

/**
 * Mount a write guard when the host supplies filesystem tools. Hold the ledger
 * transaction through dispatch so another process cannot acquire a claim between
 * the ownership check and the write. Reads and shell execution do not take it.
 * @param ctx - claims plugin context, owning the reversible listener.
 * @param store - shared cross-process claim ledger.
 */
export function installWriteGuard(ctx: Context, store: ClaimStore): void {
  ctx.inject(['fs'], (fsCtx) => {
    fsCtx.on('tools/execute', async (exec, next) => {
      const path = mutationPath(exec)
      const session = exec.agent?.session
      const cwd = session?.header.cwd
      if (path === undefined || session === undefined || cwd === undefined || cwd === '') return await next()
      // The ledger and the claimed scopes live in claim space; the path the
      // model named is relative to the session's own checkout. Resolving each
      // in its own root is what lets an isolated teammate write freely inside
      // its worktree while the shared surface stays owned.
      const workspace = await claimWorkspace(cwd)
      return await store.mutate(workspace, async (raw) => {
        exec.signal.throwIfAborted()
        const now = Date.now()
        const swept = expireClaims(raw, now).ledger
        const target = await fsCtx.fs.resolve(path, { cwd, signal: exec.signal })
        const peers = swept.claims.filter(claim => claim.sessionId !== session.id)
        const conflicts = await canonicalConflicts(fsCtx.fs, workspace, peers, [target], now, exec.signal)
        if (conflicts.length > 0) {
          throw new Error([
            `${exec.name} DENIED: another session holds an active workspace claim. No file was changed.`,
            ...conflicts.map(conflict => `"${conflict.scopes.join(', ')}" is held by ${conflict.holder} (lane ${conflict.lane}, claim ${conflict.claimId}, ${Math.ceil(conflict.remainingMs / 60_000)} min left).`),
            'Ask the holder to release the claim, choose a different scope, or wait for the lease to expire. Do not bypass the claim using shell commands.',
          ].join('\n'))
        }
        exec.signal.throwIfAborted()
        return { ledger: swept, result: await next() }
      })
    })
  })
}
