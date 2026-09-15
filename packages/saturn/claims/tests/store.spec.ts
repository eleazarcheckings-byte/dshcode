/**
 * The durable half of the claim ledger, against a real filesystem. These are
 * the properties that make a claim trustworthy across processes and across
 * time: a commit is never lost to a concurrent writer, a lapsed lease frees
 * itself, a ledger that will not parse is never silently replaced, and a lock
 * left behind by a dead owner is recovered while one held by a live owner is
 * respected.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimStore, statIdentity, workspaceKey } from '../src/store.ts'

/** A pid that no process holds, used to plant a lock owned by a dead writer. */
const DEAD_PID = 2_147_483_647

let root = ''
let workspace = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claims-store-'))
  workspace = await mkdtemp(join(tmpdir(), 'claims-ws-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

/** Open a store whose lock timeout is short, so contention tests stay fast. */
function store(lockWaitMs = 2_000): ReturnType<typeof claimStore> {
  return claimStore(root, { lockWaitMs })
}

describe('workspaceKey', () => {
  it('is stable for one root and distinct across roots', () => {
    expect(workspaceKey(workspace)).toBe(workspaceKey(workspace))
    expect(workspaceKey(workspace)).not.toBe(workspaceKey(`${workspace}-other`))
  })

  it('folds case on Windows, so one workspace cannot split into two blind ledgers', () => {
    const upper = workspace.toUpperCase()
    if (process.platform === 'win32') expect(workspaceKey(upper)).toBe(workspaceKey(workspace))
    else expect(workspaceKey(upper)).not.toBe(workspaceKey(workspace))
  })
})

describe('read', () => {
  it('returns an empty ledger when no ledger exists yet, without creating one', async () => {
    const ledger = await store().read(workspace)
    expect(ledger.claims).toEqual([])
    expect(ledger.nextClaimNumber).toBe(1)
    expect(ledger.workspaceRoot).toContain(workspace.split(/[\\/]/u).pop() ?? '')
    // Reading is not a commit: nothing may be created by a peek.
    await expect(readFile(store().ledgerPath(workspace))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to replace a ledger that exists but does not parse', async () => {
    const path = store().ledgerPath(workspace)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{ this is not a ledger', 'utf8')

    await expect(store().read(workspace)).rejects.toThrow()
    // The on-disk bytes must survive: silently starting fresh would drop live
    // claims and hand a second writer a file another agent still owns.
    await expect(store().mutate(workspace, () => ({
      ledger: { version: 1, workspaceRoot: workspace, nextClaimNumber: 1, claims: [] },
      result: null,
    }))).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('{ this is not a ledger')
  })
})

describe('mutate', () => {
  it('commits and reads back one claim', async () => {
    const claims = store()
    await claims.mutate(workspace, ledger => ({
      ledger: {
        ...ledger,
        nextClaimNumber: 2,
        claims: [{
          id: 'claim-1',
          lane: 'copy',
          holder: 'session:a',
          sessionId: 'a',
          scopes: ['src'],
          note: null,
          createdAt: 1,
          expiresAt: 2,
          revision: 1,
          baseline: {},
        }],
      },
      result: null,
    }))

    const ledger = await claims.read(workspace)
    expect(ledger.claims).toHaveLength(1)
    expect(ledger.claims[0]?.lane).toBe('copy')
    expect(ledger.nextClaimNumber).toBe(2)
  })

  it('never loses a commit to a concurrent writer', async () => {
    const claims = store(5_000)
    // Twenty racing mutators each append one claim. Without the cross-process
    // lock this is the textbook lost-update race and lands far short of twenty.
    await Promise.all(Array.from({ length: 20 }, async (_value, index) => {
      await claims.mutate(workspace, ledger => ({
        ledger: {
          ...ledger,
          nextClaimNumber: ledger.nextClaimNumber + 1,
          claims: [...ledger.claims, {
            id: `claim-${index}`,
            lane: `lane-${index}`,
            holder: 'racer',
            sessionId: 'racer',
            scopes: [`dir/${index}`],
            note: null,
            createdAt: index,
            expiresAt: index + 1_000,
            revision: 1,
            baseline: {},
          }],
        },
        result: null,
      }))
    }))

    const ledger = await claims.read(workspace)
    expect(ledger.claims).toHaveLength(20)
    expect(new Set(ledger.claims.map(claim => claim.id)).size).toBe(20)
  })

  it('releases the lock on a throwing operation, so one failure cannot wedge the ledger', async () => {
    const claims = store(1_000)
    await expect(claims.mutate(workspace, () => {
      throw new Error('the work itself failed')
    })).rejects.toThrow('the work itself failed')

    // The next writer must proceed normally.
    await expect(claims.mutate(workspace, ledger => ({ ledger, result: 'ok' }))).resolves.toBe('ok')
  })
})

describe('lock recovery', () => {
  it('breaks a lock whose recorded owner is provably gone, instead of wedging forever', async () => {
    const claims = store(50)
    const path = claims.ledgerPath(workspace)
    await mkdir(dirname(path), { recursive: true })
    // A swarm cell killed mid-claim leaves exactly this: a lock whose owner no
    // longer exists. Without recovery, every later writer fails until a human
    // notices — which defeats a ledger whose value is self-healing leases.
    await writeFile(`${path}.lock`, `${DEAD_PID}\n`, 'utf8')

    await expect(claims.mutate(workspace, ledger => ({ ledger, result: 'recovered' })))
      .resolves.toBe('recovered')
    // The recovered lock must be gone, not merely bypassed.
    await expect(readFile(`${path}.lock`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('respects a lock held by a live owner rather than stealing it', async () => {
    const claims = store(50)
    const path = claims.ledgerPath(workspace)
    await mkdir(dirname(path), { recursive: true })
    // This process is alive by definition, so the lock must be treated as held.
    await writeFile(`${path}.lock`, `${process.pid}\n`, 'utf8')

    await expect(claims.mutate(workspace, ledger => ({ ledger, result: null })))
      .rejects.toThrow(/timed out/u)
    // A contended lock is left in place: proving an owner stopped is the only
    // thing that justifies removing it.
    expect(await readFile(`${path}.lock`, 'utf8')).toBe(`${process.pid}\n`)
  })

  it('will not break a fresh, ownerless lock on age alone, since age cannot prove the owner stopped', async () => {
    const claims = store(50)
    const path = claims.ledgerPath(workspace)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(`${path}.lock`, 'not-a-pid\n', 'utf8')

    await expect(claims.mutate(workspace, ledger => ({ ledger, result: null })))
      .rejects.toThrow(/timed out/u)
  })
})

describe('statIdentity', () => {
  it('reports a missing path as absent and an existing one by its identity', async () => {
    expect(await statIdentity(join(workspace, 'nothing-here'))).toBeNull()

    const file = join(workspace, 'file.txt')
    await writeFile(file, 'hello', 'utf8')
    const identity = await statIdentity(file)
    expect(identity?.size).toBe(5)
    expect(identity?.mtimeMs).toBeGreaterThan(0)
  })
})
