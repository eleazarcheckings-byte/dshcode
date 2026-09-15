/**
 * The claim ledger as a service, for host code that writes a workspace on
 * someone else's behalf.
 *
 * The tools cover an agent acting for itself, and the two guards cover a tool
 * call about to change a file. Neither covers the third case: a runtime
 * operation that applies work produced elsewhere into a shared workspace — an
 * Agent Teams `merge_teammate` landing an isolated teammate's diff, for
 * instance. That operation has to ask the same question the guards ask, against
 * the same ledger, and get back enough to tell the model exactly which paths
 * were refused and who holds them.
 *
 * It is deliberately a reader. Nothing here takes or releases a lease: the only
 * ways to acquire one stay `claim_scope` and its explicit release, so ownership
 * remains something an agent declares rather than something the runtime infers.
 *
 * @module @saturnai/dsh-claims/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { expireClaims, findConflicts, normalizeScopes } from './ledger.ts'
import type { ClaimStore } from './store.ts'
import { claimWorkspace } from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read access to the workspace claim ledger for host-side writers. */
    claims: ClaimsAccess
  }
}

/** One requested path that a live claim owns. */
export interface ClaimPathConflict {
  /** The requested path, normalized workspace-relative. */
  readonly path: string
  /** The holding claim's id. */
  readonly claimId: string
  /** The holding claim's lane. */
  readonly lane: string
  /** Who holds it. */
  readonly holder: string
  /** Its remaining lease, in milliseconds. */
  readonly remainingMs: number
  /** The holder's scopes that collide with the requested path. */
  readonly scopes: readonly string[]
}

/** What a host-side writer asks about before it touches a workspace. */
export interface ClaimCheckRequest {
  /** The workspace the paths are relative to, usually a session's cwd. */
  readonly workspace: string
  /** Workspace-relative paths the operation would write. */
  readonly paths: readonly string[]
  /**
   * Sessions whose leases do not block this operation: the writer's own, and
   * the session whose work is being applied. Everything else is a peer.
   */
  readonly ignoreSessionIds?: readonly string[]
}

/** Read access to the durable claim ledger. */
export class ClaimsAccess extends Service {
  /**
   * @param ctx - the claims plugin context that owns this registration.
   * @param store - the shared cross-process ledger.
   */
  constructor(ctx: Context, private readonly store: ClaimStore) {
    super(ctx, 'claims')
  }

  /**
   * Resolve the directory a working directory's claims are recorded against.
   * Every linked checkout of one repository shares one claim space.
   * @param cwd - a session's working directory.
   * @returns the claim space governing it.
   */
  async workspaceFor(cwd: string): Promise<string> {
    return await claimWorkspace(cwd)
  }

  /**
   * Report every requested path a peer's live lease owns.
   * @param request - the workspace, the paths, and the sessions to disregard.
   * @returns one entry per owned path; empty when the whole set is free.
   */
  async conflictsFor(request: ClaimCheckRequest): Promise<ClaimPathConflict[]> {
    const workspace = await claimWorkspace(request.workspace)
    const now = Date.now()
    const ledger = expireClaims(await this.store.read(workspace), now).ledger
    const ignored = new Set(request.ignoreSessionIds ?? [])
    const peers = ledger.claims.filter(claim => claim.sessionId === null || !ignored.has(claim.sessionId))
    if (peers.length === 0) return []
    const conflicts: ClaimPathConflict[] = []
    for (const path of normalizeScopes(request.paths).scopes) {
      for (const conflict of findConflicts(peers, [path], now)) {
        conflicts.push({ path, ...conflict })
      }
    }
    return conflicts
  }
}
