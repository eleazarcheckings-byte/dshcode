/**
 * The durable half, pinned: the `checkpoints` fold and the wire view a client
 * row renders. The fold keeps every checkpoint (so an older one is still
 * restorable from `/checkpoint`); the wire view is bounded and newest-first, so
 * a long session's change feed stays small.
 */
import { describe, expect, it } from 'vitest'
import { checkpointsProjectionDefinition, defaultInstallRoot } from '../src/index.ts'
import { MAX_WIRE_CHECKPOINTS, type CheckpointRecord, type CheckpointsUnitState } from '../src/types.ts'

/** A minimal record with a controlled id and file count. */
function record(id: string, files = 1, reason: CheckpointRecord['reason'] = 'turn'): CheckpointRecord {
  return {
    id,
    createdAt: 1_700_000_000_000 + Number(id),
    reason,
    turn: reason === 'turn' ? Number(id) : null,
    workspaceRoot: '/work/proj',
    entries: Array.from({ length: files }, (_, index) => ({
      path: `file-${String(index)}.ts`,
      state: { kind: 'absent' as const },
    })),
    skipped: [],
  }
}

/**
 * One `checkpoints/change` event as the log carries it. The projection reads
 * only `type` and `data.next`; the envelope's `seq`/`time` belong to the log,
 * not to this fold, so the cast supplies what the fold never looks at.
 */
function change(next: CheckpointRecord): Parameters<typeof checkpointsProjectionDefinition.apply>[1] {
  return { type: 'checkpoints/change', data: { next } } as Parameters<typeof checkpointsProjectionDefinition.apply>[1]
}

/** Fold one list of records through the projection, oldest first. */
function fold(records: readonly CheckpointRecord[]): CheckpointsUnitState {
  let state = checkpointsProjectionDefinition.init()
  for (const next of records) {
    state = checkpointsProjectionDefinition.apply(state, change(next))
  }
  return state
}

describe('the checkpoints projection', () => {
  it('is an empty catalog on a log with no checkpoint', () => {
    const state = fold([])
    expect(state).toEqual({ byId: {}, order: [] })
    expect(checkpointsProjectionDefinition.wire.view(state)).toEqual({ count: 0, latest: null, entries: [] })
  })

  it('ignores events outside its own vocabulary', () => {
    const state = checkpointsProjectionDefinition.apply(
      checkpointsProjectionDefinition.init(),
      { type: 'done/change', data: { next: {} } } as Parameters<typeof checkpointsProjectionDefinition.apply>[1],
    )
    expect(state).toEqual({ byId: {}, order: [] })
  })

  it('counts each checkpoint once, newest first on the wire', () => {
    const state = fold([record('1'), record('2', 3)])
    expect(state.order).toEqual(['1', '2'])
    const view = checkpointsProjectionDefinition.wire.view(state)
    expect(view.count).toBe(2)
    expect(view.latest).toEqual({ id: '2', createdAt: 1_700_000_000_002, reason: 'turn', turn: 2, files: 3 })
    expect(view.entries.map(entry => entry.id)).toEqual(['2', '1'])
  })

  it('re-emits one checkpoint as an extended whole value without duplicating it', () => {
    let state = fold([record('1', 1)])
    state = checkpointsProjectionDefinition.apply(state, change(record('1', 2)))
    expect(state.order).toEqual(['1'])
    const view = checkpointsProjectionDefinition.wire.view(state)
    expect(view.count).toBe(1)
    expect(view.latest?.files).toBe(2)
  })

  it('bounds the wire view while the fold keeps every checkpoint', () => {
    const ids = Array.from({ length: MAX_WIRE_CHECKPOINTS + 5 }, (_, index) => String(index + 1))
    const state = fold(ids.map(id => record(id)))
    const view = checkpointsProjectionDefinition.wire.view(state)
    expect(state.order).toHaveLength(MAX_WIRE_CHECKPOINTS + 5)
    expect(view.count).toBe(MAX_WIRE_CHECKPOINTS + 5)
    expect(view.entries).toHaveLength(MAX_WIRE_CHECKPOINTS)
    expect(view.entries[0]?.id).toBe(String(MAX_WIRE_CHECKPOINTS + 5))
    expect(view.latest?.id).toBe(String(MAX_WIRE_CHECKPOINTS + 5))
  })

  it('reports a pre-restore checkpoint with no turn', () => {
    const state = fold([record('1'), record('2', 1, 'pre-restore')])
    expect(checkpointsProjectionDefinition.wire.view(state).latest)
      .toEqual({ id: '2', createdAt: 1_700_000_000_002, reason: 'pre-restore', turn: null, files: 1 })
  })

  it('declares its key, version, and schemas as the registry requires', () => {
    expect(checkpointsProjectionDefinition.key).toBe('checkpoints')
    expect(checkpointsProjectionDefinition.stateVersion).toBe(1)
    expect(checkpointsProjectionDefinition.stateSchema.safeParse({ byId: {}, order: [] }).success).toBe(true)
    expect(checkpointsProjectionDefinition.stateSchema.safeParse({ byId: {}, order: [1] }).success).toBe(false)
    expect(checkpointsProjectionDefinition.wire.viewSchema.safeParse({
      count: 0,
      latest: null,
      entries: [],
    }).success).toBe(true)
    expect(checkpointsProjectionDefinition.wire.viewSchema.safeParse({
      count: 1,
      latest: { id: '1', createdAt: 0, reason: 'turn', turn: 1, files: 1 },
      entries: [],
    }).success).toBe(true)
  })

  it('refuses a record whose state does not fit the durable schema', () => {
    const bad = { ...record('1'), entries: [{ path: 'a.ts', state: { kind: 'blob', hash: 'NOT-HEX', bytes: 1 } }] }
    expect(checkpointsProjectionDefinition.stateSchema.safeParse({ byId: { 1: bad }, order: ['1'] }).success).toBe(false)
  })
})

describe('defaultInstallRoot', () => {
  // LOCALAPPDATA names a Windows tree, so the answer is a Windows path on every
  // host that asks. Joining through the ambient `path` made the separator follow
  // the runner instead of the value, which is why the Linux CI leg read back a
  // mixed-separator root while this Windows machine passed.
  it('names the installed app under LOCALAPPDATA, whatever host asks', () => {
    expect(defaultInstallRoot({ LOCALAPPDATA: 'C:\\Users\\izzy\\AppData\\Local' }))
      .toBe('C:\\Users\\izzy\\AppData\\Local\\Programs\\@dshcodedesktop')
    expect(defaultInstallRoot({ LOCALAPPDATA: 'C:\\Users\\izzy\\AppData\\Local' })).not.toContain('/')
  })

  it('is null when this machine cannot name the install, so the guard stays silent', () => {
    expect(defaultInstallRoot({})).toBeNull()
    expect(defaultInstallRoot({ LOCALAPPDATA: '  ' })).toBeNull()
  })
})
