/**
 * Session auto-claim arithmetic: first write takes lane `auto`, a holder
 * writing again extends that lease, and the acting session never collides
 * with itself.
 */
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_CLAIM_LANE,
  AUTO_CLAIM_NOTE,
  applySessionClaim,
  mutationScope,
  refreshClaimLeases,
} from '../src/auto-claim.ts'
import { DEFAULT_TTL_MS, emptyLedger } from '../src/ledger.ts'
import type { Claim, ClaimLedger } from '../src/types.ts'

function claim(id: string, scopes: readonly string[], overrides: Partial<Claim> = {}): Claim {
  return {
    id,
    lane: AUTO_CLAIM_LANE,
    holder: 'session:session-a',
    sessionId: 'session-a',
    scopes,
    note: AUTO_CLAIM_NOTE,
    createdAt: 0,
    expiresAt: 1_000,
    revision: 1,
    baseline: {},
    ...overrides,
  }
}

function ledger(...claims: Claim[]): ClaimLedger {
  return { ...emptyLedger('/work/proj'), nextClaimNumber: claims.length + 1, claims }
}

describe('mutationScope', () => {
  it('keeps a relative path and folds backslashes', () => {
    expect(mutationScope('src/app.ts', '/work/proj')).toBe('src/app.ts')
    expect(mutationScope('src\\app.ts', '/work/proj')).toBe('src/app.ts')
  })

  it('projects an absolute path inside the cwd', () => {
    const cwd = resolve('/work/proj')
    expect(mutationScope(join(cwd, 'src', 'app.ts'), cwd)).toBe('src/app.ts')
  })

  it('refuses a path that leaves the cwd', () => {
    expect(mutationScope('../outside.ts', resolve('/work/proj'))).toBeNull()
    const cwd = resolve('/work/proj')
    expect(mutationScope(resolve('/elsewhere/file.ts'), cwd)).toBeNull()
  })
})

describe('applySessionClaim', () => {
  it('creates lane auto with the default TTL on the first unclaimed path', () => {
    const next = applySessionClaim(ledger(), {
      sessionId: 'session-a',
      holder: 'session:session-a',
      scopes: ['notes.md'],
      now: 5_000,
    })
    expect(next.claims).toHaveLength(1)
    expect(next.claims[0]).toMatchObject({
      id: 'claim-1',
      lane: AUTO_CLAIM_LANE,
      sessionId: 'session-a',
      scopes: ['notes.md'],
      note: AUTO_CLAIM_NOTE,
      expiresAt: 5_000 + DEFAULT_TTL_MS,
    })
  })

  it('extends a covering holder lease instead of creating a second claim', () => {
    const held = claim('claim-1', ['notes.md'], { expiresAt: 2_000, revision: 1 })
    const next = applySessionClaim(ledger(held), {
      sessionId: 'session-a',
      holder: 'session:session-a',
      scopes: ['notes.md'],
      now: 5_000,
    })
    expect(next.claims).toHaveLength(1)
    expect(next.claims[0]?.id).toBe('claim-1')
    expect(next.claims[0]?.expiresAt).toBe(5_000 + DEFAULT_TTL_MS)
    expect(next.claims[0]?.revision).toBe(2)
  })

  it('unions a new file onto the session auto lane', () => {
    const held = claim('claim-1', ['notes.md'])
    const next = applySessionClaim(ledger(held), {
      sessionId: 'session-a',
      holder: 'session:session-a',
      scopes: ['readme.md'],
      now: 9_000,
    })
    expect(next.claims).toHaveLength(1)
    expect(next.claims[0]?.scopes).toEqual(['notes.md', 'readme.md'])
    expect(next.claims[0]?.expiresAt).toBe(9_000 + DEFAULT_TTL_MS)
  })

  it('does not treat a peer lease as extendable', () => {
    const peer = claim('claim-1', ['notes.md'], { sessionId: 'session-b', holder: 'session:session-b', lane: 'api' })
    const next = applySessionClaim(ledger(peer), {
      sessionId: 'session-a',
      holder: 'session:session-a',
      scopes: ['other.md'],
      now: 1,
    })
    expect(next.claims.map(item => item.sessionId)).toEqual(['session-b', 'session-a'])
  })
})

describe('refreshClaimLeases', () => {
  it('bumps only the named claims', () => {
    const mine = claim('claim-1', ['a.ts'], { expiresAt: 10 })
    const theirs = claim('claim-2', ['b.ts'], { sessionId: 'session-b', expiresAt: 10 })
    const next = refreshClaimLeases(ledger(mine, theirs), ['claim-1'], 100, 50)
    expect(next.claims[0]?.expiresAt).toBe(150)
    expect(next.claims[1]?.expiresAt).toBe(10)
  })
})
