/**
 * The durable shapes of the claim ledger.
 *
 * A claim is a lease, not a message: it names a lane, the agent holding it,
 * the workspace-relative scopes that agent exclusively owns, and the instant
 * the lease lapses. It is stored as a file under the harness home rather than
 * in a session log because ownership must outlive the session that took it —
 * a peer that dies mid-lane leaves its claim to expire on the clock, and every
 * other writer reads the same bytes.
 *
 * @module @saturnai/dsh-claims/types
 */

import { z as zod } from 'zod'

/** Longest lane name the ledger admits. */
const MAX_LANE = 64

/** Longest holder identity the ledger admits. */
const MAX_HOLDER = 200

/** Longest note the ledger admits. */
const MAX_NOTE = 400

/** Longest recorded scope, in characters. */
const MAX_SCOPE = 4096

/** Most scopes one claim may hold. */
export const MAX_CLAIM_SCOPES = 256

/** Most claims one workspace ledger retains. */
export const MAX_CLAIMS = 1024

/**
 * One path's observed identity, recorded so a later write burst can tell
 * whether anything moved underneath it.
 */
export interface ClaimBaseline {
  /** Last observed modification time, in epoch milliseconds. */
  readonly mtimeMs: number
  /** Last observed byte length. */
  readonly size: number
}

/**
 * One lease: who owns what, until when.
 *
 * `baseline` is keyed by scope or by an individual file the holder named when
 * checking. A `null` value records that the path did not exist at that
 * observation, so a later appearance is reported as a creation rather than as
 * silent drift.
 */
export interface Claim {
  /** Stable id within its workspace ledger, e.g. `claim-1`. */
  readonly id: string
  /** Short lower-kebab lane name, e.g. `copy`, `api`, `migrations`. */
  readonly lane: string
  /** Who holds it: a member name, an agent id, or a described role. */
  readonly holder: string
  /** The session that took the claim, or null when a caller had no session. */
  readonly sessionId: string | null
  /** Workspace-relative file or directory prefixes this holder exclusively owns. */
  readonly scopes: readonly string[]
  /** Optional human context: what this lane is doing. */
  readonly note: string | null
  /** Epoch milliseconds the lease was taken. */
  readonly createdAt: number
  /** Epoch milliseconds the lease lapses and auto-releases. */
  readonly expiresAt: number
  /** Bumped on every change, so a reader can detect a stale snapshot. */
  readonly revision: number
  /** Observed identity per scope (and per file a check has named). */
  readonly baseline: Readonly<Record<string, ClaimBaseline | null>>
}

/**
 * One workspace's claim ledger. The workspace is the shard: two agents in
 * different repositories never contend, and two in the same repository always
 * read the same file.
 */
export interface ClaimLedger {
  /** Schema version of the on-disk document. */
  readonly version: 1
  /** The absolute workspace root this ledger governs, for provenance and refusal. */
  readonly workspaceRoot: string
  /** Next dense claim number, so ids stay short and stable. */
  readonly nextClaimNumber: number
  /** Every live claim, in creation order. */
  readonly claims: readonly Claim[]
}

const baselineSchema = zod.object({
  mtimeMs: zod.number(),
  size: zod.number().int().nonnegative(),
}).strict()

const claimSchema = zod.object({
  id: zod.string().min(1).max(64),
  lane: zod.string().min(1).max(MAX_LANE),
  holder: zod.string().min(1).max(MAX_HOLDER),
  sessionId: zod.string().min(1).max(MAX_HOLDER).nullable(),
  scopes: zod.array(zod.string().min(1).max(MAX_SCOPE)).min(1).max(MAX_CLAIM_SCOPES),
  note: zod.string().min(1).max(MAX_NOTE).nullable(),
  createdAt: zod.number().int().nonnegative(),
  expiresAt: zod.number().int().nonnegative(),
  revision: zod.number().int().nonnegative(),
  baseline: zod.record(zod.string(), baselineSchema.nullable()),
}).strict()

const ledgerSchema = zod.object({
  version: zod.literal(1),
  workspaceRoot: zod.string().min(1).max(MAX_SCOPE),
  nextClaimNumber: zod.number().int().positive(),
  claims: zod.array(claimSchema).max(MAX_CLAIMS),
}).strict()

/**
 * Parse one durable ledger document, failing loudly.
 *
 * A ledger that cannot be parsed is never silently replaced: doing so would
 * drop live claims and hand a second writer a file another agent believes it
 * owns. The caller surfaces the failure instead, and the on-disk bytes stay
 * put for a human to inspect.
 * @param raw - the document text.
 * @returns the parsed ledger.
 * @throws when the text is not a well-formed ledger.
 */
export function parseLedger(raw: string): ClaimLedger {
  const parsed: unknown = JSON.parse(raw)
  return ledgerSchema.parse(parsed)
}

/** A claim as the tools and the prompt see it: the lease plus its remaining time. */
export interface ClaimView {
  /** Stable claim id. */
  readonly id: string
  /** Lane name. */
  readonly lane: string
  /** Holder identity. */
  readonly holder: string
  /** Taking session, or null. */
  readonly sessionId: string | null
  /**
   * Owned scopes. Mutable because the canonical wire schema infers a mutable
   * array, and the value the tools promise the model is the schema's.
   */
  readonly scopes: string[]
  /** Optional note. */
  readonly note: string | null
  /** Epoch milliseconds the lease was taken. */
  readonly createdAt: number
  /** Epoch milliseconds the lease lapses. */
  readonly expiresAt: number
  /** Milliseconds left before auto-release; never negative. */
  readonly remainingMs: number
}

/** A claim that stops a new one from being taken. */
export interface ScopeConflict {
  /** The holding claim's id. */
  readonly claimId: string
  /** The holding claim's lane. */
  readonly lane: string
  /** Who holds it. */
  readonly holder: string
  /** Its remaining lease, in milliseconds. */
  readonly remainingMs: number
  /** The exact scopes that collide. */
  readonly scopes: readonly string[]
}

/** The result of expiring lapsed leases. */
export interface ExpiryOutcome {
  /** The ledger after lapsed claims were removed. */
  readonly ledger: ClaimLedger
  /** The claims that lapsed, for reporting. */
  readonly released: readonly Claim[]
}

/**
 * One file's drift since the ledger last observed it.
 *
 * `moved` is the signal that matters: it means the bytes a writer read earlier
 * may no longer be the bytes on disk, so the caller must re-read and rebase
 * before writing. `added` is a first observation — there is nothing to compare,
 * so it is informational.
 */
export type DriftKind = 'moved' | 'created' | 'removed' | 'added'

/** One path whose on-disk identity changed since it was last observed. */
export interface DriftFinding {
  /** Workspace-relative POSIX path. */
  readonly path: string
  /** What changed. */
  readonly kind: DriftKind
  /** Identity before, or null when absent or never observed. */
  readonly before: ClaimBaseline | null
  /** Identity now, or null when absent. */
  readonly after: ClaimBaseline | null
}
