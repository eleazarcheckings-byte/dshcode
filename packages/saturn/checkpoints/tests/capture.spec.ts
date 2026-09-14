/**
 * Capture and restore over a real filesystem, in a scratch directory: the
 * round trip that is the whole point of the feature, and the proof that a
 * restore touches nothing outside the recorded set.
 *
 * The round trip is asserted on hashes, not on text: the claim is that the
 * bytes a restore writes are the bytes the capture read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRestore, capturePaths, MAX_CAPTURE_BYTES, verifyRestore } from '../src/capture.ts'
import { planRestore } from '../src/plan.ts'
import { checkpointStore, type CheckpointStore } from '../src/store.ts'
import type { CheckpointRecord } from '../src/types.ts'

/** Lowercase hex sha-256 of a file on disk. */
async function fileHash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

let work: string
let store: CheckpointStore

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-work-'))
  store = checkpointStore(join(await mkdtemp(join(tmpdir(), 'dsh-checkpoint-blobs-')), 'store'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
  await rm(store.root, { recursive: true, force: true })
})

describe('capturePaths', () => {
  it('records the exact bytes of a file, under their own address', async () => {
    await writeFile(join(work, 'a.ts'), 'export const a = 1\n')
    const outcome = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    const expected = await fileHash(join(work, 'a.ts'))
    expect(outcome.skipped).toEqual([])
    expect(outcome.entries).toEqual([{ path: 'a.ts', state: { kind: 'blob', hash: expected, bytes: 19 } }])
    expect(await store.hasBlob(expected)).toBe(true)
  })

  it('records a missing path as the positive fact "absent"', async () => {
    const outcome = await capturePaths({ workspaceRoot: work, paths: ['new.ts'], store })
    expect(outcome.entries).toEqual([{ path: 'new.ts', state: { kind: 'absent' } }])
  })

  it('records each path once, in first-seen order', async () => {
    await writeFile(join(work, 'a.ts'), 'a')
    const outcome = await capturePaths({ workspaceRoot: work, paths: ['a.ts', 'a.ts'], store })
    expect(outcome.entries.map(entry => entry.path)).toEqual(['a.ts'])
  })

  it('skips a file past the capture budget instead of reading it whole', async () => {
    await writeFile(join(work, 'big.bin'), Buffer.alloc(64))
    const outcome = await capturePaths({ workspaceRoot: work, paths: ['big.bin'], store, maxBytes: 8 })
    expect(outcome.entries).toEqual([])
    expect(outcome.skipped).toEqual(['big.bin'])
  })

  it('skips a directory rather than recording it as content', async () => {
    await mkdir(join(work, 'dir'))
    const outcome = await capturePaths({ workspaceRoot: work, paths: ['dir'], store })
    expect(outcome.entries).toEqual([])
    expect(outcome.skipped).toEqual(['dir'])
  })

  it('records nothing without a workspace, and claims nothing was skipped', async () => {
    const outcome = await capturePaths({ workspaceRoot: null, paths: ['a.ts'], store })
    expect(outcome).toEqual({ entries: [], skipped: [] })
  })

  it('has a budget large enough for real source files', () => {
    expect(MAX_CAPTURE_BYTES).toBe(4 * 1024 * 1024)
  })
})

describe('the round trip: capture, mutate, restore', () => {
  it('puts the recorded bytes back, hash for hash', async () => {
    const file = join(work, 'a.ts')
    const original = 'export const a = 1\n'
    await writeFile(file, original)
    const before = await fileHash(file)
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })

    // The mutation the checkpoint protects against.
    await writeFile(file, 'export const a = 2\n')
    expect(await fileHash(file)).not.toBe(before)

    const record = recordFrom(captured, work)
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, record)
    expect(plan.ok).toBe(true)
    expect(await verifyRestore(store, plan)).toEqual([])
    const report = await applyRestore(store, plan)
    expect(report).toEqual({ written: ['a.ts'], removed: [], leftAlone: [], failure: null })

    expect(await fileHash(file)).toBe(before)
    expect(await readFile(file, 'utf8')).toBe(original)
  })

  it('removes a file the turn created, and nothing else', async () => {
    const keep = join(work, 'keep.ts')
    await writeFile(keep, 'keep\n')
    const created: CheckpointRecord['entries'][number] = { path: 'created.ts', state: { kind: 'absent' } }
    const record = recordFrom({ entries: [created], skipped: [] }, work)

    await writeFile(join(work, 'created.ts'), 'created by the turn\n')
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, record)
    const report = await applyRestore(store, plan)

    expect(report.removed).toEqual(['created.ts'])
    await expect(stat(join(work, 'created.ts'))).rejects.toThrow()
    expect(await readFile(keep, 'utf8')).toBe('keep\n')
  })

  it('proves no collateral: a restore writes the recorded set and leaves every neighbour byte-identical', async () => {
    await mkdir(join(work, 'src'))
    await writeFile(join(work, 'src', 'a.ts'), 'a1\n')
    await writeFile(join(work, 'src', 'b.ts'), 'b1\n')
    await writeFile(join(work, 'untouched.txt'), 'neighbour\n')

    const captured = await capturePaths({ workspaceRoot: work, paths: ['src/a.ts'], store })
    const record = recordFrom(captured, work)

    await writeFile(join(work, 'src', 'a.ts'), 'a2\n')
    await writeFile(join(work, 'src', 'b.ts'), 'b2\n')
    const neighbourBefore = await fileHash(join(work, 'src', 'b.ts'))
    const outsideBefore = await fileHash(join(work, 'untouched.txt'))

    const plan = planRestore({ workspaceRoot: work, installRoot: null }, record)
    const report = await applyRestore(store, plan)

    expect(report.written).toEqual(['src/a.ts'])
    expect(report.removed).toEqual([])
    expect(report.leftAlone).toEqual([])
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('a1\n')
    // b.ts was NOT in this checkpoint: its mutation stands, byte for byte.
    expect(await fileHash(join(work, 'src', 'b.ts'))).toBe(neighbourBefore)
    expect(await fileHash(join(work, 'untouched.txt'))).toBe(outsideBefore)
  })

  it('proves the restore is undoable: the pre-restore capture restores the mutated state', async () => {
    const file = join(work, 'a.ts')
    await writeFile(file, 'v1\n')
    const first = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    await writeFile(file, 'v2\n')

    // What `/checkpoint restore` does before it writes: record the current state.
    const undo = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    const undoHash = await fileHash(file)

    const plan = planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(first, work))
    await applyRestore(store, plan)
    expect(await readFile(file, 'utf8')).toBe('v1\n')

    const back = planRestore({ workspaceRoot: work, installRoot: null }, {
      ...recordFrom(undo, work),
      reason: 'pre-restore',
      turn: null,
    })
    const report = await applyRestore(store, back)
    expect(report.failure).toBeNull()
    expect(await fileHash(file)).toBe(undoHash)
    expect(await readFile(file, 'utf8')).toBe('v2\n')
  })

  // POSIX-only: win32 exposes no real permission bits through chmod/stat, so
  // the assertion would measure the platform, not the code.
  it.skipIf(process.platform === 'win32')('keeps a restored file\'s own permission bits', async () => {
    const file = join(work, 'a.ts')
    await writeFile(file, 'v1\n', { mode: 0o600 })
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    await writeFile(file, 'v2\n')
    await applyRestore(store, planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(captured, work)))
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
})

describe('verifyRestore', () => {
  it('refuses the whole restore when a recorded blob is missing', async () => {
    await writeFile(join(work, 'a.ts'), 'a1\n')
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(captured, work))
    await rm(join(store.root, 'blobs'), { recursive: true, force: true })

    const issues = await verifyRestore(store, plan)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('a.ts')
    expect(issues[0]?.reason).toContain('missing')
  })

  it('refuses when the recorded blob no longer hashes to its address', async () => {
    await writeFile(join(work, 'a.ts'), 'a1\n')
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    const hash = (captured.entries[0]?.state as { hash: string }).hash
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(captured, work))
    // Same length, different bytes: the address no longer identifies the content.
    await writeFile(join(store.root, 'blobs', hash.slice(0, 2), hash), 'a2\n')

    const issues = await verifyRestore(store, plan)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.reason).toContain('does not hash to its address')
  })

  it('refuses a tampered blob whose length alone gives it away', async () => {
    await writeFile(join(work, 'a.ts'), 'a1\n')
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts'], store })
    const hash = (captured.entries[0]?.state as { hash: string }).hash
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(captured, work))
    await writeFile(join(store.root, 'blobs', hash.slice(0, 2), hash), 'replaced by longer content')

    const issues = await verifyRestore(store, plan)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.reason).toContain('bytes, not 3')
  })

  it('refuses to remove a path that has become a directory', async () => {
    const record = recordFrom({ entries: [{ path: 'was-file.ts', state: { kind: 'absent' } }], skipped: [] }, work)
    await mkdir(join(work, 'was-file.ts'))
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, record)
    const issues = await verifyRestore(store, plan)
    expect(issues).toEqual([{ path: 'was-file.ts', reason: 'a directory now stands where the record says no file existed' }])
  })

  it('treats an already-absent path as a no-op, not a problem', async () => {
    const record = recordFrom({ entries: [{ path: 'gone.ts', state: { kind: 'absent' } }], skipped: [] }, work)
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, record)
    expect(await verifyRestore(store, plan)).toEqual([])
  })
})

describe('applyRestore failures', () => {
  it('stops at the first failure and reports what was already applied', async () => {
    await writeFile(join(work, 'a.ts'), 'a1\n')
    await writeFile(join(work, 'b.ts'), 'b1\n')
    const captured = await capturePaths({ workspaceRoot: work, paths: ['a.ts', 'b.ts'], store })
    const plan = planRestore({ workspaceRoot: work, installRoot: null }, recordFrom(captured, work))
    // The second blob disappears after verification: the write must fail loudly,
    // naming the path, rather than half-restoring in silence.
    const second = captured.entries[1]?.state as { hash: string }
    await rm(join(store.root, 'blobs', second.hash.slice(0, 2), second.hash))

    const report = await applyRestore(store, plan)
    expect(report.written).toEqual(['a.ts'])
    expect(report.failure?.path).toBe('b.ts')
    expect(report.failure?.message).toContain('missing')
  })

  it('throws on a refused plan rather than silently restoring nothing', async () => {
    const plan = planRestore({ workspaceRoot: null, installRoot: null }, recordFrom({ entries: [], skipped: [] }, work))
    expect(plan.ok).toBe(false)
    await expect(applyRestore(store, plan)).rejects.toThrow(/refusing to apply a refused restore plan/u)
  })
})

/** A checkpoint record over one capture outcome, as the plugin would log it. */
function recordFrom(outcome: { entries: CheckpointRecord['entries']; skipped: readonly string[] }, workspaceRoot: string): CheckpointRecord {
  return {
    id: '1',
    createdAt: 1_700_000_000_000,
    reason: 'turn',
    turn: 1,
    workspaceRoot,
    entries: outcome.entries,
    skipped: outcome.skipped,
  }
}
