/**
 * The pure half of the claim ledger: what a scope is, when two overlap, and
 * which leases have lapsed. Everything here is decision and arithmetic over
 * strings and numbers — no filesystem, no clock, no session — so the
 * guarantees that make a claim a lock ("this scope is inside the workspace",
 * "these two writers collide", "this lease is over") are unit-testable on
 * their own.
 *
 * The protocol implemented here is the one SWARM.md §2 paid for: ownership
 * lives in a durable file rather than in messages, a claim is taken BEFORE the
 * first edit, and a claim younger than its TTL means the lane is taken.
 *
 * @module @saturnai/dsh-claims/ledger
 */

import type {
  Claim,
  ClaimBaseline,
  ClaimLedger,
  ClaimView,
  DriftFinding,
  ExpiryOutcome,
  ScopeConflict,
} from './types.ts'
import { MAX_CLAIM_SCOPES } from './types.ts'

/** The scope that names the whole workspace. It overlaps every other scope. */
export const ROOT_SCOPE = '.'

/**
 * The default lease: two hours, exactly the window SWARM.md §2 treats as
 * "this lane is taken". Long enough to finish a real unit of work, short
 * enough that an abandoned lane frees itself without a human.
 */
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000

/** Shortest lease a caller may request. */
export const MIN_TTL_MS = 60_000

/** Longest lease a caller may request. */
export const MAX_TTL_MS = 24 * 60 * 60 * 1000

/** An empty ledger for one workspace. */
export function emptyLedger(workspaceRoot: string): ClaimLedger {
  return { version: 1, workspaceRoot, nextClaimNumber: 1, claims: [] }
}

/**
 * Normalize one caller-supplied scope to a workspace-relative POSIX prefix, or
 * reject it.
 *
 * A scope is a file or a directory subtree. Backslashes are folded, trailing
 * separators dropped, and a leading `./` removed so the same surface has one
 * spelling. Absolute paths, drive-qualified paths, and anything that would
 * escape the workspace via `..` are rejected outright: a claim is a lock on
 * THIS repository, and a scope that leaves it is a lock on nothing meaningful.
 * @param raw - the caller's spelling.
 * @returns the normalized prefix, or null when it is not a usable scope.
 */
export function normalizeScope(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (cleaned === ROOT_SCOPE) return ROOT_SCOPE
  if (cleaned === '') return null
  // A colon-qualified or slash-leading path is absolute on some platform.
  if (cleaned.startsWith('/') || /^[A-Za-z]:/u.test(cleaned)) return null
  const trimmed = cleaned.startsWith('./') ? cleaned.slice(2) : cleaned
  if (trimmed === '' || trimmed === ROOT_SCOPE) return ROOT_SCOPE
  const segments = trimmed.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/** The accepted and rejected outcome of normalizing a caller's scope list. */
export interface NormalizedScopes {
  /** Distinct normalized scopes, sorted for a stable ledger document. */
  readonly scopes: readonly string[]
  /** The caller's spellings that were refused, verbatim and in order. */
  readonly rejected: readonly string[]
}

/**
 * Normalize, de-duplicate, and cap one caller's scope list.
 *
 * Sorting makes the stored scope list canonical, so two callers naming the
 * same surface in a different order produce the same bytes — which is what
 * lets scope comparison be a plain equality check.
 * @param values - the caller's spellings.
 * @returns the accepted scopes and the refused spellings.
 */
export function normalizeScopes(values: readonly string[]): NormalizedScopes {
  const scopes = new Set<string>()
  const rejected: string[] = []
  for (const value of values) {
    if (scopes.size >= MAX_CLAIM_SCOPES) {
      rejected.push(value)
      continue
    }
    const normalized = normalizeScope(value)
    if (normalized === null) {
      rejected.push(value)
      continue
    }
    scopes.add(normalized)
  }
  return { scopes: [...scopes].sort(), rejected }
}

/**
 * Whether two scopes name overlapping surfaces, comparing by path component.
 *
 * Component-aware, not string-prefix: `src/a` and `src/ab` are different
 * surfaces, while `src` covers `src/a`. The root scope covers everything.
 * @param left - one normalized scope.
 * @param right - the other normalized scope.
 * @returns true when a writer holding one may touch the other's surface.
 */
export function scopesOverlap(left: string, right: string): boolean {
  if (left === ROOT_SCOPE || right === ROOT_SCOPE) return true
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

/** Whether one lease has lapsed at `now`. */
export function isExpired(claim: Claim, now: number): boolean {
  return claim.expiresAt <= now
}

/** One lease's remaining time, floored at zero. */
export function remainingMs(claim: Claim, now: number): number {
  return Math.max(0, claim.expiresAt - now)
}

/**
 * Remove every lapsed lease, reporting what was released.
 *
 * This is the auto-release that makes the ledger self-healing: a cell that
 * crashes, is interrupted, or simply walks away frees its lane on the clock,
 * with no operator action and no message from the dead peer.
 * @param ledger - the ledger to sweep.
 * @param now - the instant to evaluate leases against.
 * @returns the swept ledger and the claims that lapsed.
 */
export function expireClaims(ledger: ClaimLedger, now: number): ExpiryOutcome {
  const released = ledger.claims.filter(claim => isExpired(claim, now))
  if (released.length === 0) return { ledger, released: [] }
  return {
    ledger: { ...ledger, claims: ledger.claims.filter(claim => !isExpired(claim, now)) },
    released,
  }
}

/**
 * Every live lease whose scopes collide with a proposed set.
 *
 * Lapsed claims are excluded by construction — the caller sweeps first — so a
 * conflict always names a writer that genuinely holds the surface right now.
 * @param claims - the live, already-swept claims.
 * @param scopes - the proposed normalized scopes.
 * @param now - the instant to compute each conflict's remaining lease against.
 * @param exceptId - a claim id to ignore, used when a holder extends its own lease.
 * @returns one conflict per colliding claim, in ledger order.
 */
export function findConflicts(
  claims: readonly Claim[],
  scopes: readonly string[],
  now: number,
  exceptId?: string,
): ScopeConflict[] {
  const conflicts: ScopeConflict[] = []
  for (const claim of claims) {
    if (claim.id === exceptId) continue
    const colliding = claim.scopes.filter(other => scopes.some(scope => scopesOverlap(scope, other)))
    if (colliding.length === 0) continue
    conflicts.push({
      claimId: claim.id,
      lane: claim.lane,
      holder: claim.holder,
      remainingMs: remainingMs(claim, now),
      scopes: colliding,
    })
  }
  return conflicts
}

/** The tools' and prompt's view of one live claim. */
export function viewOf(claim: Claim, now: number): ClaimView {
  return {
    id: claim.id,
    lane: claim.lane,
    holder: claim.holder,
    sessionId: claim.sessionId,
    scopes: [...claim.scopes],
    note: claim.note,
    createdAt: claim.createdAt,
    expiresAt: claim.expiresAt,
    remainingMs: remainingMs(claim, now),
  }
}

/** The claims one session holds; used to release a departing session's lanes. */
export function claimsOfSession(ledger: ClaimLedger, sessionId: string): readonly Claim[] {
  return ledger.claims.filter(claim => claim.sessionId === sessionId)
}

/**
 * Compare one path's newly observed identity against the recorded baseline.
 * @param before - the recorded identity, or null when recorded absent; undefined when never observed.
 * @param after - the identity observed now, or null when the path is absent.
 * @returns the drift, or null when nothing a writer would care about changed.
 */
export function driftOf(
  path: string,
  before: ClaimBaseline | null | undefined,
  after: ClaimBaseline | null,
): DriftFinding | null {
  if (before === undefined) {
    return { path, kind: 'added', before: null, after }
  }
  if (before === null && after === null) return null
  if (before === null) return { path, kind: 'created', before, after }
  if (after === null) return { path, kind: 'removed', before, after }
  if (before.mtimeMs === after.mtimeMs && before.size === after.size) return null
  return { path, kind: 'moved', before, after }
}

/**
 * Fold a proposal's scopes into an existing claim's, for idempotent extension.
 *
 * A holder that claims the same lane twice must not deadlock against its own
 * lease, so the second call unions the scopes and refreshes the clock instead
 * of denying. The result is capped, and the refused spellings are reported.
 * @param existing - the scopes the claim already holds.
 * @param proposed - the newly normalized scopes.
 * @returns the union, or null when the cap would be exceeded.
 */
export function extendScopes(
  existing: readonly string[],
  proposed: readonly string[],
): readonly string[] | null {
  const union = new Set(existing)
  for (const scope of proposed) union.add(scope)
  if (union.size > MAX_CLAIM_SCOPES) return null
  return [...union].sort()
}
