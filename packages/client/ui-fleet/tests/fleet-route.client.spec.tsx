// @vitest-environment jsdom
/**
 * Fleet route surface, component level: what the seat actually paints, what a
 * row is called, and what clicking one does. The derivation itself is proved in
 * `fleet.client.spec.ts`; this file proves the seat around it, including the
 * empty state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FleetRoute, type FleetRouteProps } from '../src/client/FleetRoute.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ROOT = 'root' as SessionId
const CHILD = 'child' as SessionId
const OTHER = 'other' as SessionId
const t: FleetRouteProps['t'] = makeTranslate(zh)

/** Default activation spy: a row click with nothing to observe. */
function noop(): void {}

/** One delegated worker row, with the facts under test. */
function summary(over: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: 'Fix the sidebar filter',
    running: false,
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

function props(input: {
  sessions: readonly SessionSummary[]
  jobs?: Readonly<Record<SessionId, readonly JobView[]>>
  pending?: readonly (readonly [SessionId, { kind: string }])[]
  openWorker?: (id: SessionId) => void
}): FleetRouteProps {
  const state = {
    ids: input.sessions.map(session => session.id),
    byId: Object.fromEntries(input.sessions.map(session => [session.id, session])),
    current: ROOT,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: input.jobs ?? {},
    currentAddress: undefined,
  } satisfies SessionListState
  // The pending-interaction union's members are nominal (private fields), so no
  // structural stand-in is assignable, let alone comparable -- the same stand-in
  // problem this file's `FleetRouteProps` return already solves. The fixture is
  // asserted at its one boundary, and the fold reads only `kind`.
  const pending = new Map(input.pending ?? []) as unknown as SessionPendingInteractionSnapshot
  const useSessions = <T,>(select: (snapshot: SessionListState) => T): T => select(state)
  const useSessionPendingInteraction = <T,>(select: (snapshot: SessionPendingInteractionSnapshot) => T): T =>
    select(pending)
  return {
    sessionId: ROOT,
    useSessions,
    useSessionPendingInteraction,
    openWorker: input.openWorker ?? noop,
    t,
  } as unknown as FleetRouteProps
}

describe('fleet route surface', () => {
  it('reads as designed when nothing is delegated', () => {
    const { container } = render(<FleetRoute {...props({ sessions: [summary({ id: ROOT })] })} />)
    expect(container.querySelector('[data-fleet="empty"]')).not.toBeNull()
    expect(screen.getByText(zh['empty'])).toBeDefined()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('carries a settled worker no line at all', () => {
    render(<FleetRoute {...props({ sessions: [summary({ id: ROOT }), summary({ id: CHILD, parentId: ROOT, origin: 'subagent' })] })} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('paints one line per non-settled worker, word and label together', () => {
    render(<FleetRoute {...props({
      sessions: [
        summary({ id: ROOT }),
        summary({ id: CHILD, parentId: ROOT, origin: 'subagent', running: true }),
        summary({ id: OTHER, parentId: ROOT, origin: 'subagent', displayTitle: 'Rewrite the ledger' }),
      ],
      pending: [[OTHER, { kind: 'approval' }]],
    })} />)
    const rows = screen.getAllByRole('button')
    expect(rows.map(node => node.textContent)).toEqual([
      `Rewrite the ledger${zh['need.approval']}`,
      `Fix the sidebar filter${zh['status.running']}`,
    ])
    expect(screen.getByRole('button', {
      name: `Rewrite the ledger. ${zh['need.approval']}. ${zh['row.open']}`,
    })).toBeDefined()
  })

  it('names the blocker a failed job left behind', () => {
    const jobs = {
      [CHILD]: [{
        id: 'bash-1' as JobView['id'],
        kind: 'bash',
        label: 'pnpm run build',
        status: 'failed',
        startedAt: 0,
      }],
    } as unknown as Readonly<Record<SessionId, readonly JobView[]>>
    render(<FleetRoute {...props({
      sessions: [summary({ id: ROOT }), summary({ id: CHILD, parentId: ROOT, origin: 'subagent' })],
      jobs,
    })} />)
    expect(screen.getByRole('button', {
      name: `Fix the sidebar filter. ${zh['status.blocked'].replace('{blocker}', 'pnpm run build')}. ${zh['row.open']}`,
    })).toBeDefined()
  })

  it('opens the worker\'s parent context with the worker id', () => {
    const openWorker = vi.fn()
    render(<FleetRoute {...props({
      sessions: [
        summary({ id: ROOT }),
        summary({ id: CHILD, parentId: ROOT, origin: 'subagent', running: true }),
      ],
      openWorker,
    })} />)
    fireEvent.click(screen.getByRole('button'))
    expect(openWorker).toHaveBeenCalledWith(CHILD)
  })
})
