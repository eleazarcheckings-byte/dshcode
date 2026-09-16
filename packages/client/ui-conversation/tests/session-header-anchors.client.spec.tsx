// @vitest-environment jsdom
/**
 * The conversation header's durable anchors (SPEC §8 M2, Mars r1 finding 1).
 *
 * At phone size the global mobile sheet (ui-theme `styles/mobile.css`) has to
 * raise every control in this row to a 44px touch target — the session crumbs,
 * the view tabs, and whatever the `actions` / `utilities` seats are filled with
 * by packages the sheet does not own. It can only do that through attributes
 * this component publishes on purpose: a hashed CSS-module class is private and
 * free to change. These cases are that contract, held from the DOM side.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import { en } from '../src/client/locales.ts'
import {
  ConversationSessionHeader, type ConversationSessionHeaderProps,
} from '../src/client/skeleton/ConversationSession.tsx'

afterEach(cleanup)

const SID = 'session-mobile-header' as SessionId
const session: SessionSnapshot = sessionSnapshot(SID)
const sessions = {
  byId: { [SID]: { id: SID, displayTitle: 'Seeded session', origin: 'user' } },
} as unknown as SessionListState
const VIEWS = [{ id: 'chat', label: 'Chat' }, { id: 'trajectory', label: 'Trajectory' }]

/**
 * Render the header over stubbed shares — the component reads everything
 * through the four props shares, so no store or context is needed.
 * @returns the testing-library result.
 */
function header() {
  const props = {
    sessionId: SID,
    useSession: (select: (value: SessionSnapshot) => unknown) => select(session),
    useSessions: (select: (value: SessionListState) => unknown) => select(sessions),
    useConversation: (select: (value: typeof EMPTY_CONVERSATION_SNAPSHOT) => unknown) =>
      select(EMPTY_CONVERSATION_SNAPSHOT),
    useConversationViews: (select: (value: typeof VIEWS) => unknown) => select(VIEWS),
    useStore: (select: (value: { view: string }) => unknown) => select({ view: 'chat' }),
    renderSlot: vi.fn(() => null),
    open: vi.fn(),
    selectView: vi.fn(),
    t: makeTranslate(en, commonEn),
  } as unknown as ConversationSessionHeaderProps
  return render(<ConversationSessionHeader {...props} />)
}

describe('conversation session header anchors', () => {
  it('publishes the header anchor the mobile sheet reaches the whole row through', () => {
    const { container } = header()
    const row = container.querySelector('[data-conversation-header]')
    expect(row, '[data-conversation-header]').not.toBeNull()
    expect(row!.tagName).toBe('HEADER')
  })

  it('carries every control of the row, the slot seats included, inside that anchor', () => {
    const { container } = header()
    const row = container.querySelector('[data-conversation-header]')!
    // The crumb button is the row's own control; the actions and utilities
    // seats render inside it too, which is why one anchor covers them all.
    expect(row.querySelectorAll('button').length).toBeGreaterThan(0)
    for (const button of container.querySelectorAll('button')) {
      expect(row.contains(button), button.textContent ?? '').toBe(true)
    }
  })

  it('marks each view tab so the sheet can keep its label on the selected bar', () => {
    const { container } = header()
    const tabs = container.querySelectorAll('[data-conversation-tab]')
    expect(tabs.length).toBe(VIEWS.length)
    for (const tab of tabs) {
      expect(tab.getAttribute('role')).toBe('tab')
    }
    expect([...tabs].map(tab => tab.textContent)).toEqual(['Chat', 'Trajectory'])
  })

  it('anchors the tablist itself, so a single-tab session is still reachable', () => {
    const { container } = header()
    expect(container.querySelector('[data-conversation-tabs]')?.getAttribute('role')).toBe('tablist')
  })
})
