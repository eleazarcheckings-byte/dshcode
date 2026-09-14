/**
 * Fleet fold: published session facts → one route line per delegated worker.
 *
 * This spec is the proof of the mapping the surface rests on: real state →
 * `waiting-for-you` / `blocked on X` / `running` / `done`, the precedence
 * between them, and the empty case (no lines at all).
 */
import { describe, expect, it } from 'vitest'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  deriveFleet, fleetLine, fleetRoster, fleetWorkers,
  type FleetJobView, type FleetLine, type FleetPendingView, type FleetSessionView,
  type FleetWorker,
} from '../src/client/fleet.ts'

const sid = (id: string): SessionId => id as SessionId
const gid = (id: string): GoalId => id as GoalId

/** A delegated worker with no news: the shape most assertions start from. */
function worker(over: Partial<FleetWorker> = {}): FleetWorker {
  return {
    id: sid('child'),
    parentId: sid('root'),
    origin: 'subagent',
    label: 'Fix the sidebar filter',
    running: false,
    ...over,
  }
}

/** A roster keyed by id, in the order given (host-list order). */
function roster(...workers: readonly FleetWorker[]): Record<SessionId, FleetWorker> {
  return Object.fromEntries(workers.map(item => [item.id, item]))
}

function fields(line: FleetLine | undefined): string {
  if (line === undefined) return 'no line'
  return line.status === 'waiting-for-you'
    ? `${line.status}:${line.need}`
    : line.status === 'blocked' ? `${line.status}:${line.blocker}` : line.status
}

describe('fleet line derivation', () => {
  it('reports a pending interaction as the worker waiting on the human', () => {
    expect(fields(fleetLine(worker({ pendingKind: 'approval' })))).toBe('waiting-for-you:approval')
    expect(fields(fleetLine(worker({ pendingKind: 'plan-review' })))).toBe('waiting-for-you:plan-review')
    expect(fields(fleetLine(worker({ pendingKind: 'question' })))).toBe('waiting-for-you:question')
  })

  it('names the blocker the worker\'s own goal published', () => {
    expect(fields(fleetLine(worker({ blockedReason: 'needs the AWS key from you' }))))
      .toBe('blocked:needs the AWS key from you')
  })

  it('names a failed job the worker still holds', () => {
    expect(fields(fleetLine(worker({ failedJob: 'pnpm run build' })))).toBe('blocked:pnpm run build')
  })

  it('reports live work as running', () => {
    expect(fields(fleetLine(worker({ running: true })))).toBe('running')
  })

  it('reports the completion reminder as done', () => {
    expect(fields(fleetLine(worker({ completed: true })))).toBe('done')
  })

  it('prints nothing for a settled worker with no news', () => {
    expect(fleetLine(worker())).toBeUndefined()
    expect(deriveFleet(sid('root'), roster(worker()))).toEqual([])
  })

  it('orders a human decision above a blocker above activity above settlement', () => {
    const waiting = fleetLine(worker({ pendingKind: 'approval', blockedReason: 'x', running: true, completed: true }))
    expect(fields(waiting)).toBe('waiting-for-you:approval')
    const blocked = fleetLine(worker({ blockedReason: 'x', running: true, completed: true }))
    expect(fields(blocked)).toBe('blocked:x')
    const failed = fleetLine(worker({ failedJob: 'npm test', running: true, completed: true }))
    expect(fields(failed)).toBe('blocked:npm test')
    const running = fleetLine(worker({ running: true, completed: true }))
    expect(fields(running)).toBe('running')
  })
})

describe('fleet subtree', () => {
  // `exactOptionalPropertyTypes` forbids setting an optional prop to explicit
  // `undefined`, so a root and an ordinary fork omit the keys the helper's
  // defaults would otherwise supply.
  const root: FleetWorker = { id: sid('root'), label: 'izzy-la', running: false }
  const child = worker({ id: sid('child'), parentId: sid('root'), running: true })
  const grandchild = worker({ id: sid('grandchild'), parentId: sid('child'), running: true })
  const fork: FleetWorker = { id: sid('fork'), parentId: sid('child'), label: 'Fix the sidebar filter', running: true }
  const forkChild = worker({ id: sid('fork-child'), parentId: sid('fork'), origin: 'subagent', running: true })
  const stranger = worker({ id: sid('stranger'), parentId: sid('other-root'), running: true })

  it('takes nested subagent descendants and stops at an ordinary fork', () => {
    const all = roster(root, child, grandchild, fork, forkChild, stranger)
    expect(fleetWorkers(sid('root'), all).map(item => item.id))
      .toEqual([sid('child'), sid('grandchild')])
  })

  it('stays empty without a root, and survives a cycle', () => {
    expect(fleetWorkers(undefined, roster(child))).toEqual([])
    const cycleA = worker({ id: sid('a'), parentId: sid('b'), running: true })
    const cycleB = worker({ id: sid('b'), parentId: sid('a'), running: true })
    expect(fleetWorkers(sid('a'), roster(cycleA, cycleB)).map(item => item.id)).toEqual([sid('b')])
  })

  it('puts the human\'s attention first and settlement last', () => {
    const lines = deriveFleet(sid('root'), roster(
      root,
      worker({ id: sid('settled'), parentId: sid('root'), completed: true }),
      worker({ id: sid('live'), parentId: sid('root'), running: true }),
      worker({ id: sid('stopped'), parentId: sid('root'), blockedReason: 'no credentials' }),
      worker({ id: sid('needs-you'), parentId: sid('root'), pendingKind: 'question' }),
    ))
    expect(lines.map(fields)).toEqual([
      'waiting-for-you:question',
      'blocked:no credentials',
      'running',
      'done',
    ])
  })
})

describe('fleet adapter', () => {
  const session = (over: Partial<FleetSessionView> = {}): FleetSessionView => ({
    id: sid('child'),
    displayTitle: 'Fix the sidebar filter',
    parentId: sid('root'),
    origin: 'subagent',
    running: false,
    ...over,
  })

  const jobs: readonly FleetJobView[] = [
    { label: 'pnpm run build', status: 'failed' },
    { label: 'pnpm test', status: 'killed' },
  ]

  const pending = new Map<SessionId, FleetPendingView>([[sid('child'), { kind: 'approval' }]])

  it('reads each fact from its one authority', () => {
    const all = fleetRoster(
      {
        [sid('child')]: session({
          running: true,
          projectionValues: {
            goal: {
              goal: {
                id: gid('goal-1'),
                revision: 1,
                objective: 'Fix the sidebar filter',
                phase: 'blocked',
                blockedReason: { code: 'needs-input', message: 'waiting on the API key' },
                maxGoalRounds: 6,
              },
              roundsStarted: 1,
              createdAt: 0,
              updatedAt: 1,
            },
          },
        }),
      },
      { [sid('child')]: jobs },
      pending,
    )
    expect(all[sid('child')]).toEqual({
      id: sid('child'),
      label: 'Fix the sidebar filter',
      running: true,
      parentId: sid('root'),
      origin: 'subagent',
      pendingKind: 'approval',
      blockedReason: 'waiting on the API key',
      failedJob: 'pnpm run build',
    })
  })

  it('ignores a goal that is not blocked, a job that was stopped, and a blank kind', () => {
    const all = fleetRoster(
      {
        [sid('child')]: session({
          projectionValues: {
            goal: {
              goal: {
                id: gid('goal-2'),
                revision: 1,
                objective: 'Rewrite the ledger',
                phase: 'active',
                maxGoalRounds: 6,
              },
              roundsStarted: 0,
              createdAt: 0,
              updatedAt: 0,
            },
          },
        }),
      },
      { [sid('child')]: [{ label: 'pnpm test', status: 'killed' }] },
      new Map([[sid('child'), { kind: '  ' }]]),
    )
    expect(all[sid('child')]).toEqual({
      id: sid('child'),
      label: 'Fix the sidebar filter',
      running: false,
      parentId: sid('root'),
      origin: 'subagent',
    })
    expect(deriveFleet(sid('root'), all)).toEqual([])
  })

  it('carries a root session with no descendants to no lines at all', () => {
    const all = fleetRoster({
      [sid('root')]: { id: sid('root'), displayTitle: 'izzy-la', running: true },
    })
    expect(all[sid('root')]?.origin).toBeUndefined()
    expect(deriveFleet(sid('root'), all)).toEqual([])
  })
})
