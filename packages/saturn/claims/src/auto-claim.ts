/**
 * Session-owned lease updates for a guarded mutation.
 *
 * The write and shell guards deny a peer's live claim, then land here. An
 * unclaimed path is taken for the acting session on lane `auto` with the same
 * TTL as `claim_scope`. A holder writing a surface it already covers refreshes
 * that lease instead of taking a second one, so the acting session never
 * deadlocks against itself.
 *
 * @module @saturnai/dsh-claims/auto-claim
 */

import { isAbsolute, relative } from 'node:path'
import {
  DEFAULT_TTL_MS,
  extendScopes,
  normalizeScope,
  scopesOverlap,
} from './ledger.ts'
import type { Claim, ClaimBaseline, ClaimLedger } from './types.ts'

/** Lane used when a mutation takes a claim the session did not already name. */
export const AUTO_CLAIM_LANE = 'auto'

/** Note recorded on a lease created by a guarded first write. */
export const AUTO_CLAIM_NOTE = 'auto-claimed on first write'

/**
 * Project a mutation path into a workspace-relative claim scope.
 *
 * Relative paths are used as spelled. Absolute paths are taken relative to the
 * session cwd so a first-party tool that named a full path still claims the
 * same surface `claim_scope` would. A path that leaves the cwd is not a scope
 * this ledger can hold.
 * @param path - the mutation path as the tool named it.
 * @param cwd - the session working directory the path was resolved against.
 * @returns a normalized scope, or null when the path is not claimable.
 */
export function mutationScope(path: string, cwd: string): string | null {
  const spelled = isAbsolute(path) ? relative(cwd, path) : path
  if (spelled === '') return null
  if (isAbsolute(spelled)) return null
  if (spelled === '..' || spelled.startsWith('../') || spelled.startsWith('..\\')) return null
  return normalizeScope(spelled)
}

/**
 * Refresh the clock on named live claims without changing their scopes.
 * @param ledger - the already-swept ledger.
 * @param claimIds - claims that cover the mutation, so the holder is writing again.
 * @param now - the instant the extension starts from.
 * @param ttlMs - lease length; defaults to today's two-hour window.
 * @returns the ledger with those claims extended.
 */
export function refreshClaimLeases(
  ledger: ClaimLedger,
  claimIds: readonly string[],
  now: number,
  ttlMs: number = DEFAULT_TTL_MS,
): ClaimLedger {
  const ids = new Set(claimIds)
  let changed = false
  const claims = ledger.claims.map((claim) => {
    if (!ids.has(claim.id)) return claim
    changed = true
    return { ...claim, expiresAt: now + ttlMs, revision: claim.revision + 1 }
  })
  return changed ? { ...ledger, claims } : ledger
}

/**
 * Take or extend a session's lease so `scopes` are owned by that session.
 *
 * Covering claims are extended in place (same id, refreshed TTL). Uncovered
 * scopes join the session's `auto` lane, or create that lane. The acting
 * session is never treated as a peer of itself.
 * @param ledger - the already-swept ledger.
 * @param input - the acting session and the scopes the mutation will touch.
 * @returns the ledger after the session owns every requested scope.
 */
export function applySessionClaim(
  ledger: ClaimLedger,
  input: {
    readonly sessionId: string
    readonly holder: string
    readonly scopes: readonly string[]
    readonly now: number
    readonly ttlMs?: number
    readonly baseline?: Readonly<Record<string, ClaimBaseline | null>>
  },
): ClaimLedger {
  if (input.scopes.length === 0) return ledger
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
  const own = ledger.claims.filter(claim => claim.sessionId === input.sessionId)
  const covering = own.filter(claim => scopesCoveredBy(claim.scopes, input.scopes))
  if (covering.length > 0) {
    return refreshClaimLeases(ledger, covering.map(claim => claim.id), input.now, ttlMs)
  }
  const uncovered = input.scopes.filter(scope =>
    !own.some(claim => claim.scopes.some(owned => scopesOverlap(scope, owned))))
  if (uncovered.length === 0) {
    const touching = own.filter(claim =>
      input.scopes.some(scope => claim.scopes.some(owned => scopesOverlap(scope, owned))))
    return refreshClaimLeases(ledger, touching.map(claim => claim.id), input.now, ttlMs)
  }
  const target = own.find(claim => claim.lane === AUTO_CLAIM_LANE)
  if (target === undefined) {
    const claim: Claim = {
      id: `claim-${ledger.nextClaimNumber}`,
      lane: AUTO_CLAIM_LANE,
      holder: input.holder,
      sessionId: input.sessionId,
      scopes: [...uncovered].sort(),
      note: AUTO_CLAIM_NOTE,
      createdAt: input.now,
      expiresAt: input.now + ttlMs,
      revision: 1,
      baseline: input.baseline ?? {},
    }
    return {
      ...ledger,
      nextClaimNumber: ledger.nextClaimNumber + 1,
      claims: [...ledger.claims, claim],
    }
  }
  const union = extendScopes(target.scopes, uncovered)
  if (union === null) {
    return refreshClaimLeases(ledger, [target.id], input.now, ttlMs)
  }
  const next: Claim = {
    ...target,
    scopes: union,
    expiresAt: input.now + ttlMs,
    revision: target.revision + 1,
    baseline: { ...input.baseline, ...target.baseline },
  }
  return { ...ledger, claims: ledger.claims.map(claim => claim.id === target.id ? next : claim) }
}

/** Whether every proposed scope already sits inside the held set. */
function scopesCoveredBy(held: readonly string[], proposed: readonly string[]): boolean {
  return proposed.every(scope => held.some(owned => scopesOverlap(scope, owned)))
}
