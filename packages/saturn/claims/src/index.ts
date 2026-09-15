/**
 * Enforced workspace claims, host half: the durable, TTL-leased ledger of who
 * owns which file surface, and the tools that take, check, and release it.
 *
 * The feature exists because the failure mode it prevents is silent. When two
 * agents write one file the loser does not discover it at the moment of
 * collision; the work is simply gone, and the cost is a rebuild plus the time
 * spent reconciling two states that both believed they were current. SWARM.md
 * §2 records that this happened three times in a single evening, and its
 * conclusion is the design here: **ownership lives in a durable file, never in
 * messages**, and a claim is taken BEFORE the first edit.
 *
 * The neighbouring Agent Teams task board already carries write scopes, but
 * its scopes are advisory in two specific ways that this package closes:
 * overlap is only compared against tasks already marked `in_progress`, and the
 * verdict is a string in a warnings array that nothing consults. So two
 * pending tasks can name the same file, and even a reported overlap blocks
 * nothing. A claim here is denied on overlap and has no advisory mode, which is
 * what makes it a lock rather than a note.
 *
 * It is deliberately independent of Agent Teams, so it works for plain
 * subagents, for several chats driving separate cells, and for a single agent
 * that simply wants to declare a surface before touching it.
 *
 * @module @saturnai/dsh-claims
 */

import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ToolExecutionInput, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the systemPrompt Context merge.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MIN_TTL_MS,
  claimsOfSession,
  driftOf,
  expireClaims,
  extendScopes,
  findConflicts,
  normalizeScopes,
  viewOf,
} from './ledger.ts'
import type { Claim, ClaimBaseline, ClaimLedger, ClaimView, ScopeConflict } from './types.ts'
import { claimStore, statIdentity, type ClaimStore } from './store.ts'
import { canonicalConflicts, installWriteGuard } from './write-guard.ts'

export type { Claim, ClaimBaseline, ClaimLedger, ClaimView, DriftFinding, ScopeConflict } from './types.ts'
export { DEFAULT_TTL_MS, MAX_TTL_MS, MIN_TTL_MS, ROOT_SCOPE } from './ledger.ts'
export { CLAIM_STORE_DIR, workspaceKey } from './store.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'saturn-claims'

/** The tool registry and the prompt section are this plugin's whole surface. */
export const inject = ['tools', 'systemPrompt']

/** The prompt section carrying the claim protocol. */
export const CLAIMS_SECTION = 'claims:policy'

/** The longest lane name a tool call may state. */
const MAX_LANE = 64

/** The longest holder identity a tool call may state. */
const MAX_HOLDER = 200

/** The longest note a tool call may state. */
const MAX_NOTE = 400

/**
 * The standing protocol, shipped as the tool's own prompt section rather than
 * as persona prose. Every line is a rule an agent can act on, and each was
 * paid for — the numbering mirrors SWARM.md §2's mandatory claim protocol.
 */
const POLICY = [
  'File ownership is a LEASE held in a durable ledger, not a courtesy exchanged in messages. Before you write a file another agent might also write, you must hold a claim on it.',
  '',
  '1. BEFORE YOUR FIRST EDIT in a lane, call claim_scope with a short lane name and the exact file or directory prefixes you will write. A claim that collides with a live one is DENIED. If you are denied, pick a different lane or wait for the reported lease to lapse — NEVER write anyway, and never treat the denial as a warning.',
  '2. IMMEDIATELY BEFORE EACH WRITE BURST, call claim_check on your claim. If it reports a file as moved, that file changed since the ledger last observed it: re-read it and rebase before writing. Never write a buffer you read minutes ago.',
  '3. RELEASE YOUR CLAIM with release_scope the moment your unit verifies. Claims also lapse on their own when the lease expires (two hours by default), so an abandoned lane frees itself without a human.',
  '4. ONE WRITER PER SURFACE. If you and another agent both need a file, the second should ask the first to hand the surface over. There is no shared write, and a scope you did not claim is not yours.',
  '5. First-party write, edit, and str_replace_editor calls cannot modify another session\'s active claimed scope. Shell commands, formatters, code generators, and external editors need explicit coordination; never use them to bypass a denied write. Preserve the user\'s commit and review preferences.',
].join('\n')

/** One canonical output schema with compact model-facing JSON. */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** The wire spelling of one lease. */
const CLAIM_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    lane: { type: 'string', required: true },
    holder: { type: 'string', required: true },
    sessionId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    scopes: { type: 'array', required: true, items: { type: 'string' } },
    note: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    createdAt: { type: 'integer', required: true },
    expiresAt: { type: 'integer', required: true },
    remainingMs: { type: 'integer', required: true },
  },
} as const

/** One path whose identity drifted since the ledger last observed it. */
const DRIFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    kind: {
      type: 'string',
      required: true,
      enum: ['moved', 'created', 'removed', 'added'],
    },
  },
} as const

/** Mount enforced workspace claims: the ledger tools and the standing policy. */
export function apply(ctx: Context): void {
  const store = claimStore()
  installWriteGuard(ctx, store)

  ctx.systemPrompt.section({
    name: CLAIMS_SECTION,
    // After the done and orchestrate policies: all three are standing
    // collaboration law, and this one governs the write surface itself.
    order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') + 14,
    text: POLICY,
  })

  ctx.tools.register(defineTool({
    name: 'claim_scope',
    description: 'Take an exclusive claim on workspace-relative file or directory scopes before editing them. A claim that overlaps a live claim is DENIED — pick another lane or wait, never write anyway. Re-claiming your own lane extends it.',
    parameters: {
      lane: { type: 'string', required: true, description: `Short lower-kebab lane name, e.g. copy, api, migrations. Max ${MAX_LANE} characters.` },
      scopes: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Workspace-relative file or directory prefixes this lane will write, e.g. src/api or README.md. Use "." only when you genuinely own the whole workspace.',
      },
      holder: { type: 'string', description: 'Who holds this lane, when you have a name for the writer. Defaults to your session id.' },
      note: { type: 'string', description: `Optional one-line context for the lane. Max ${MAX_NOTE} characters.` },
      ttl_ms: { type: 'integer', description: `Lease in milliseconds, ${MIN_TTL_MS} through ${MAX_TTL_MS}. Defaults to ${DEFAULT_TTL_MS} (two hours).` },
    },
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        claim: { ...CLAIM_VIEW_SCHEMA, required: true },
        expired: { type: 'array', required: true, items: CLAIM_VIEW_SCHEMA },
      },
    } as const),
    async execute(args, exec) {
      const now = Date.now()
      const workspace = workspaceOf(exec)
      const sessionId = sessionIdOf(exec)
      const lane = checkedText(args.lane, 'lane', MAX_LANE)
      const holder = args.holder === undefined
        ? `session:${sessionId}`
        : checkedText(args.holder, 'holder', MAX_HOLDER)
      const note = args.note === undefined ? null : checkedText(args.note, 'note', MAX_NOTE)
      const ttlMs = resolveTtlMs(args.ttl_ms)
      const { scopes, rejected } = normalizeScopes(args.scopes)
      // Fail closed: an agent that believes it holds a surface it does not is
      // exactly the collision this package exists to prevent.
      if (rejected.length > 0) {
        throw new Error(`claim_scope: these scopes are not workspace-relative paths, and were NOT claimed: ${rejected.join(', ')}`)
      }
      if (scopes.length === 0) throw new Error('claim_scope: at least one scope is required')

      // Observed BEFORE the lock, since it is filesystem work; the ledger write
      // itself stays a short read-modify-write.
      const baseline = await baselineFor(workspace, scopes)

      return await store.mutate(workspace, async (raw): Promise<ClaimMutation> => {
        const swept = expireClaims(raw, now)
        const ledger = swept.ledger
        // A holder re-claiming its own lane extends that lease instead of
        // colliding with it, so a repeated call can never self-deadlock.
        const own = ledger.claims.find(claim => claim.sessionId === sessionId && claim.lane === lane)
        const fs = ctx.get('fs')
        const conflicts = fs === undefined
          ? findConflicts(ledger.claims, scopes, now, own?.id)
          : await canonicalConflicts(fs, workspace, ledger.claims.filter(claim => claim.id !== own?.id),
            await Promise.all(scopes.map(scope => fs.resolve(scope, { cwd: workspace, signal: exec.signal }))), now, exec.signal)
        if (conflicts.length > 0) throw new ScopeConflictError(conflicts)

        const expired = swept.released.map(claim => viewOf(claim, now))
        const next = own === undefined
          ? createClaim(ledger, { lane, holder, sessionId, scopes, baseline, note, ttlMs, now })
          : extendClaim(ledger, own, { scopes, baseline, ttlMs, now })
        return { ledger: next.ledger, result: { claim: viewOf(next.claim, now), expired } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'release_scope',
    description: 'Release one claim you hold, freeing its scopes immediately. Call this the moment a unit verifies rather than waiting for the lease to lapse.',
    parameters: {
      claim_id: { type: 'string', required: true, description: 'The claim id returned by claim_scope.' },
    },
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: { released: { ...CLAIM_VIEW_SCHEMA, required: true } },
    } as const),
    async execute(args, exec) {
      const now = Date.now()
      const workspace = workspaceOf(exec)
      const id = checkedText(args.claim_id, 'claim_id', 64)
      return await store.mutate(workspace, (raw): { ledger: ClaimLedger; result: { released: ClaimView } } => {
        const swept = expireClaims(raw, now)
        const claim = swept.ledger.claims.find(candidate => candidate.id === id)
        if (claim === undefined) {
          throw new Error(`release_scope: no live claim "${id}" (it may have lapsed, or belong to a workspace you are not in)`)
        }
        if (claim.sessionId !== sessionIdOf(exec)) throw new Error(`release_scope: claim "${id}" belongs to another session; ask its holder to release it`)
        return {
          ledger: { ...swept.ledger, claims: swept.ledger.claims.filter(candidate => candidate.id !== id) },
          result: { released: viewOf(claim, now) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'claim_list',
    description: 'List every live claim in this workspace, including who holds it and how long its lease has left. Check this before choosing a lane.',
    parameters: {},
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace: { type: 'string', required: true },
        claims: { type: 'array', required: true, items: CLAIM_VIEW_SCHEMA },
        expired: { type: 'array', required: true, items: CLAIM_VIEW_SCHEMA },
      },
    } as const),
    async execute(_args, exec) {
      const now = Date.now()
      const workspace = workspaceOf(exec)
      return await store.mutate(workspace, (raw) => {
        const swept = expireClaims(raw, now)
        return {
          // Persist the sweep: listing is the natural moment expired lanes free up.
          ledger: swept.ledger,
          result: {
            workspace,
            claims: swept.ledger.claims.map(claim => viewOf(claim, now)),
            expired: swept.released.map(claim => viewOf(claim, now)),
          },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'claim_check',
    description: 'Re-stat the files of one of your claims immediately before a write burst. Any file reported as moved changed since the ledger last saw it — re-read and rebase before writing it.',
    parameters: {
      claim_id: { type: 'string', required: true, description: 'The claim id returned by claim_scope.' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional specific workspace-relative files about to be written; defaults to the claim\'s own scopes.',
      },
    },
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        claim: { ...CLAIM_VIEW_SCHEMA, required: true },
        findings: { type: 'array', required: true, items: DRIFT_SCHEMA },
        rebased: { type: 'boolean', required: true },
      },
    } as const),
    async execute(args, exec) {
      const now = Date.now()
      const workspace = workspaceOf(exec)
      const id = checkedText(args.claim_id, 'claim_id', 64)
      const requested = args.paths === undefined ? null : normalizeScopes(args.paths)
      if (requested !== null && requested.rejected.length > 0) {
        throw new Error(`claim_check: these paths are not workspace-relative, and were NOT checked: ${requested.rejected.join(', ')}`)
      }

      return await store.mutate(workspace, async (raw) => {
        const swept = expireClaims(raw, now)
        const claim = swept.ledger.claims.find(candidate => candidate.id === id)
        if (claim === undefined) {
          throw new Error(`claim_check: no live claim "${id}" — it lapsed (leases auto-release) or was released; take it again with claim_scope`)
        }
        if (claim.sessionId !== sessionIdOf(exec)) throw new Error(`claim_check: claim "${id}" belongs to another session; only its holder may rebase it`)
        const paths = requested === null ? claim.scopes : requested.scopes
        const findings: DriftFindingWire[] = []
        const baseline: Record<string, { mtimeMs: number; size: number } | null> = { ...claim.baseline }
        for (const path of paths) {
          const after = await statIdentity(join(workspace, path))
          const drift = driftOf(path, claim.baseline[path], after)
          if (drift !== null) findings.push({ path: drift.path, kind: drift.kind })
          baseline[path] = after
        }
        const next: Claim = { ...claim, revision: claim.revision + 1, baseline }
        return {
          ledger: { ...swept.ledger, claims: swept.ledger.claims.map(candidate => candidate.id === id ? next : candidate) },
          result: { claim: viewOf(next, now), findings, rebased: true },
        }
      })
    },
  }))

  // A session that ends must not leave its lanes held: the lease would
  // eventually lapse on the clock, but a peer waiting right now should not have
  // to. Claims taken without a session are unaffected and expire normally.
  ctx.on('session/disposed', (session) => {
    void releaseSessionClaims(store, session).catch((error: unknown) => {
      ctx.logger.warn('saturn-claims: releasing a disposed session\'s claims failed: %o', error)
    })
  })
}

/** The refusal a colliding claim produces, rendered for the model that must react. */
export class ScopeConflictError extends Error {
  /** Every claim that blocked the proposal. */
  readonly conflicts: readonly ScopeConflict[]

  /**
   * @param conflicts - the live claims whose scopes collide.
   */
  constructor(conflicts: readonly ScopeConflict[]) {
    super(renderConflict(conflicts))
    this.name = 'ScopeConflictError'
    this.conflicts = conflicts
  }
}

/** The denial text: what holds each surface, for how long, and what to do instead. */
function renderConflict(conflicts: readonly ScopeConflict[]): string {
  const lines = conflicts.map(conflict =>
    `  "${conflict.scopes.join(', ')}" is held by ${conflict.holder} (lane ${conflict.lane}, claim ${conflict.claimId}, `
    + `${Math.ceil(conflict.remainingMs / 60_000)} min left)`)
  return [
    'claim_scope DENIED: your scopes overlap a live claim. Nothing was claimed.',
    ...lines,
    'Pick a different lane, narrow your scopes to surfaces that are genuinely unowned, or wait for the reported lease to lapse. Do NOT write the overlapping files.',
  ].join('\n')
}

/** The result fields the claim_check tool promises. */
interface DriftFindingWire {
  /** Workspace-relative POSIX path. */
  readonly path: string
  /** What changed since the ledger last observed the path. */
  readonly kind: 'moved' | 'created' | 'removed' | 'added'
}

/** What one claim_scope call hands back to its caller. */
interface ClaimMutation {
  readonly ledger: ClaimLedger
  readonly result: { readonly claim: ClaimView; readonly expired: ClaimView[] }
}

/** A claim with an id equal to one the ledger already assigned, or a fresh one. */
function createClaim(
  ledger: ClaimLedger,
  input: {
    readonly lane: string
    readonly holder: string
    readonly sessionId: string
    readonly scopes: readonly string[]
    readonly baseline: Readonly<Record<string, ClaimBaseline | null>>
    readonly note: string | null
    readonly ttlMs: number
    readonly now: number
  },
): { readonly ledger: ClaimLedger; readonly claim: Claim } {
  const claim: Claim = {
    id: `claim-${ledger.nextClaimNumber}`,
    lane: input.lane,
    holder: input.holder,
    sessionId: input.sessionId,
    scopes: input.scopes,
    note: input.note,
    createdAt: input.now,
    expiresAt: input.now + input.ttlMs,
    revision: 1,
    baseline: input.baseline,
  }
  return {
    ledger: {
      ...ledger,
      nextClaimNumber: ledger.nextClaimNumber + 1,
      claims: [...ledger.claims, claim],
    },
    claim,
  }
}

/** Union one holder's own claim with more scopes and a refreshed lease. */
function extendClaim(
  ledger: ClaimLedger,
  claim: Claim,
  input: {
    readonly scopes: readonly string[]
    readonly baseline: Readonly<Record<string, ClaimBaseline | null>>
    readonly ttlMs: number
    readonly now: number
  },
): { readonly ledger: ClaimLedger; readonly claim: Claim } {
  const union = extendScopes(claim.scopes, input.scopes)
  if (union === null) {
    throw new Error(`claim_scope: extending lane "${claim.lane}" would exceed the scope cap; release it and claim the surface you need`)
  }
  const next: Claim = {
    ...claim,
    scopes: union,
    // A scope already observed keeps its ORIGINAL baseline: the point of the
    // record is the state the holder first saw, so re-claiming must not quietly
    // forget drift that happened since.
    baseline: { ...input.baseline, ...claim.baseline },
    expiresAt: input.now + input.ttlMs,
    revision: claim.revision + 1,
  }
  return {
    ledger: { ...ledger, claims: ledger.claims.map(candidate => candidate.id === claim.id ? next : candidate) },
    claim: next,
  }
}

/**
 * Observe each scope's identity at claim time.
 *
 * Recording this up front is what makes the FIRST `claim_check` meaningful:
 * with an empty starting baseline, a file that changed between the claim and
 * the write burst would be reported as merely first-seen instead of as moved,
 * which is exactly the drift the protocol exists to catch.
 */
async function baselineFor(
  workspace: string,
  scopes: readonly string[],
): Promise<Record<string, ClaimBaseline | null>> {
  const baseline: Record<string, ClaimBaseline | null> = {}
  for (const scope of scopes) baseline[scope] = await statIdentity(join(workspace, scope))
  return baseline
}

/** Release every claim one departing session holds. */
async function releaseSessionClaims(store: ClaimStore, session: Session): Promise<void> {
  const workspace = session.header.cwd
  if (workspace === undefined || workspace === '') return
  const now = Date.now()
  await store.mutate(workspace, (raw) => {
    const swept = expireClaims(raw, now)
    const mine = claimsOfSession(swept.ledger, session.id)
    if (mine.length === 0) return { ledger: swept.ledger, result: null }
    const released = new Set(mine.map(claim => claim.id))
    return {
      ledger: { ...swept.ledger, claims: swept.ledger.claims.filter(claim => !released.has(claim.id)) },
      result: null,
    }
  })
}

/** The workspace a claim tool call operates in. */
function workspaceOf(exec: ToolExecutionInput): string {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd === '') {
    throw new Error('claim tools require an owning agent session with a workspace')
  }
  return cwd
}

/** The claiming session's id, which also scopes the release-on-exit sweep. */
function sessionIdOf(exec: ToolExecutionInput): string {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('claim tools require an owning agent session')
  return session.id
}

/** Trim and bound one required text argument. */
function checkedText(value: string, field: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field} must not be blank`)
  if (trimmed.length > max) throw new Error(`${field} must be at most ${max} characters`)
  return trimmed
}

/** Clamp a requested lease into the admitted range. */
function resolveTtlMs(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_TTL_MS
  if (!Number.isSafeInteger(requested)) throw new Error('ttl_ms must be a safe integer')
  if (requested < MIN_TTL_MS || requested > MAX_TTL_MS) {
    throw new Error(`ttl_ms must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`)
  }
  return requested
}

export { emptyLedger, driftOf } from './ledger.ts'
