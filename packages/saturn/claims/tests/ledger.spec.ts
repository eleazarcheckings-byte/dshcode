/**
 * The pure half of the claim ledger, pinned. Every guarantee that makes a
 * claim a lock rather than a note is decided here — a scope cannot leave the
 * workspace, two overlapping writers are detected regardless of any status
 * field, a lapsed lease releases itself, and drift is reported — so this is
 * where those guarantees are falsified.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TTL_MS,
  ROOT_SCOPE,
  claimsOfSession,
  driftOf,
  emptyLedger,
  expireClaims,
  extendScopes,
  findConflicts,
  isExpired,
  normalizeScope,
  normalizeScopes,
  remainingMs,
  scopesOverlap,
  viewOf,
} from '../src/ledger.ts'
import { MAX_CLAIM_SCOPES } from '../src/types.ts'
import type { Claim, ClaimLedger } from '../src/types.ts'

/** One claim, with only the fields a test cares about spelled out. */
function claim(id: string, scopes: readonly string[], overrides: Partial<Claim> = {}): Claim {
  return {
    id,
    lane: `lane-${id}`,
    holder: `holder-${id}`,
    sessionId: 'session-a',
    scopes,
    note: null,
    createdAt: 0,
    expiresAt: 1_000,
    revision: 1,
    baseline: {},
    ...overrides,
  }
}

/** A ledger holding exactly the given claims. */
function ledger(...claims: Claim[]): ClaimLedger {
  return { ...emptyLedger('/work/proj'), claims }
}

describe('normalizeScope', () => {
  it('folds backslashes, trailing separators, and a leading ./ to one spelling', () => {
    expect(normalizeScope('src/api')).toBe('src/api')
    expect(normalizeScope('src\\api')).toBe('src/api')
    expect(normalizeScope('src/api/')).toBe('src/api')
    expect(normalizeScope('./src/api')).toBe('src/api')
    expect(normalizeScope('  src/api  ')).toBe('src/api')
  })

  it('treats the workspace root as its own canonical scope', () => {
    expect(normalizeScope('.')).toBe(ROOT_SCOPE)
    expect(normalizeScope('./')).toBe(ROOT_SCOPE)
    expect(normalizeScope('./.')).toBe(ROOT_SCOPE)
  })

  it('refuses blank, absolute, and escaping spellings', () => {
    expect(normalizeScope('')).toBeNull()
    expect(normalizeScope('   ')).toBeNull()
    expect(normalizeScope('/etc/passwd')).toBeNull()
    expect(normalizeScope('C:\\Windows')).toBeNull()
    expect(normalizeScope('../outside')).toBeNull()
    expect(normalizeScope('src/../../outside')).toBeNull()
    expect(normalizeScope('src/./api')).toBeNull()
    expect(normalizeScope('src//api')).toBeNull()
  })
})

describe('normalizeScopes', () => {
  it('de-duplicates and sorts so two callers naming one surface store identical bytes', () => {
    const outcome = normalizeScopes(['src/b', 'src/a', 'src/b'])
    expect(outcome.scopes).toEqual(['src/a', 'src/b'])
    expect(outcome.rejected).toEqual([])
  })

  it('reports every refused spelling verbatim, in order', () => {
    const outcome = normalizeScopes(['src/a', '/abs', '../up'])
    expect(outcome.scopes).toEqual(['src/a'])
    expect(outcome.rejected).toEqual(['/abs', '../up'])
  })
})

describe('scopesOverlap', () => {
  it('compares by path component, not by string prefix', () => {
    expect(scopesOverlap('src', 'src')).toBe(true)
    expect(scopesOverlap('src', 'src/api')).toBe(true)
    expect(scopesOverlap('src/api', 'src')).toBe(true)
    // The trap a naive startsWith would fall into.
    expect(scopesOverlap('src/a', 'src/ab')).toBe(false)
    expect(scopesOverlap('src', 'lib')).toBe(false)
  })

  it('treats the root scope as covering everything', () => {
    expect(scopesOverlap(ROOT_SCOPE, 'src/api')).toBe(true)
    expect(scopesOverlap('src/api', ROOT_SCOPE)).toBe(true)
  })
})

describe('expireClaims', () => {
  it('releases a lapsed lease and keeps a live one', () => {
    const lapsed = claim('claim-1', ['src'], { expiresAt: 999 })
    const live = claim('claim-2', ['lib'], { expiresAt: 1_001 })
    const outcome = expireClaims(ledger(lapsed, live), 1_000)
    expect(outcome.released.map(released => released.id)).toEqual(['claim-1'])
    expect(outcome.ledger.claims.map(remaining => remaining.id)).toEqual(['claim-2'])
  })

  it('returns the same ledger object when nothing lapsed', () => {
    const current = ledger(claim('claim-1', ['src'], { expiresAt: 2_000 }))
    const outcome = expireClaims(current, 1_000)
    expect(outcome.released).toEqual([])
    expect(outcome.ledger).toBe(current)
  })

  it('treats the exact expiry instant as lapsed, so a lease is never held past its clock', () => {
    expect(isExpired(claim('claim-1', ['src'], { expiresAt: 1_000 }), 1_000)).toBe(true)
    expect(remainingMs(claim('claim-1', ['src'], { expiresAt: 1_000 }), 1_500)).toBe(0)
  })
})

describe('findConflicts', () => {
  it('denies a proposal that overlaps a live claim regardless of any status or progress field', () => {
    // This is the specific hole in the neighbouring task board: it only compares
    // against tasks already marked in_progress, so two pending writers naming one
    // file never see each other. A claim has no status — holding it is the whole
    // signal — so an untouched claim still blocks.
    const held = claim('claim-1', ['src/api'])
    const conflicts = findConflicts([held], ['src/api/handlers.ts'], 500)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.claimId).toBe('claim-1')
    expect(conflicts[0]?.scopes).toEqual(['src/api'])
  })

  it('names only the scopes that actually collide', () => {
    const held = claim('claim-1', ['src/api', 'lib'])
    const conflicts = findConflicts([held], ['src/api'], 500)
    expect(conflicts[0]?.scopes).toEqual(['src/api'])
  })

  it('reports no conflict for disjoint surfaces', () => {
    expect(findConflicts([claim('claim-1', ['src'])], ['lib'], 500)).toEqual([])
  })

  it('ignores one claim by id, so a holder can extend its own lease', () => {
    const held = claim('claim-1', ['src'])
    expect(findConflicts([held], ['src/deeper'], 500, 'claim-1')).toEqual([])
  })

  it('reports each conflicting holder separately, with its remaining lease', () => {
    const first = claim('claim-1', ['src'], { expiresAt: 2_000 })
    const second = claim('claim-2', ['src/api'], { expiresAt: 3_000 })
    const conflicts = findConflicts([first, second], ['src'], 1_000)
    expect(conflicts.map(conflict => conflict.claimId)).toEqual(['claim-1', 'claim-2'])
    expect(conflicts[0]?.remainingMs).toBe(1_000)
    expect(conflicts[1]?.remainingMs).toBe(2_000)
  })

  it('lets a root claim block every other surface', () => {
    expect(findConflicts([claim('claim-1', [ROOT_SCOPE])], ['src/deep/file.ts'], 0)).toHaveLength(1)
  })
})

describe('driftOf', () => {
  const before = { mtimeMs: 100, size: 10 }

  it('reports a never-observed path as added rather than as drift', () => {
    expect(driftOf('src/a.ts', undefined, before)).toMatchObject({ kind: 'added' })
  })

  it('reports nothing when a path is unchanged', () => {
    expect(driftOf('src/a.ts', before, { ...before })).toBeNull()
    expect(driftOf('src/a.ts', null, null)).toBeNull()
  })

  it('reports a moved file when either mtime or size differs', () => {
    expect(driftOf('src/a.ts', before, { mtimeMs: 101, size: 10 })).toMatchObject({ kind: 'moved' })
    expect(driftOf('src/a.ts', before, { mtimeMs: 100, size: 11 })).toMatchObject({ kind: 'moved' })
  })

  it('distinguishes a creation from a removal, since they call for opposite reactions', () => {
    expect(driftOf('src/a.ts', null, before)).toMatchObject({ kind: 'created' })
    expect(driftOf('src/a.ts', before, null)).toMatchObject({ kind: 'removed' })
  })
})

describe('extendScopes', () => {
  it('unions and sorts, so an extension keeps the canonical spelling', () => {
    expect(extendScopes(['src/b'], ['src/a'])).toEqual(['src/a', 'src/b'])
  })

  it('refuses an extension past the cap rather than silently truncating ownership', () => {
    const full = Array.from({ length: MAX_CLAIM_SCOPES }, (_value, index) => `dir/${index}`)
    expect(extendScopes(full, ['one/more'])).toBeNull()
  })
})

describe('claimsOfSession and viewOf', () => {
  it('selects exactly the departing session\'s lanes', () => {
    const mine = claim('claim-1', ['src'], { sessionId: 'session-a' })
    const theirs = claim('claim-2', ['lib'], { sessionId: 'session-b' })
    expect(claimsOfSession(ledger(mine, theirs), 'session-a').map(found => found.id)).toEqual(['claim-1'])
  })

  it('never reports a negative remaining lease', () => {
    const view = viewOf(claim('claim-1', ['src'], { expiresAt: 1_000 }), 5_000)
    expect(view.remainingMs).toBe(0)
    expect(view.scopes).toEqual(['src'])
  })

  it('defaults to the two-hour window SWARM.md §2 treats as "taken"', () => {
    expect(DEFAULT_TTL_MS).toBe(2 * 60 * 60 * 1000)
  })
})
