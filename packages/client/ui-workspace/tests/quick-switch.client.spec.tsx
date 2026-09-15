// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { QuickSwitch } from '../src/client/QuickSwitch.tsx'
import { quickDestinations } from '../src/client/quick-switch.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = (id: string): SessionId => id as SessionId
const t = makeTranslate(en)
const row = (id: string, title: string, updatedAt: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: title, blank: false, running: false, updatedAt, ...extra,
})
const rows = [row('old', 'Fix checkout', 1), row('new', 'Design Saturn', 3, { running: true }), row('archived', 'Old design', 5), row('blank', 'Untitled', 6, { blank: true })]
const sessions: SessionListState = {
  ids: rows.map(item => item.id), byId: Object.fromEntries(rows.map(item => [item.id, item])), current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}
const workspaces: WorkspaceSnapshot = {
  items: [{ workspaceId: 'saturn' as WorkspaceId, title: 'Saturn', path: 'C:\\Projects\\saturn', sessionIds: [sid('new')], createdAt: '', updatedAt: '' }],
  archivedSessionIds: [sid('archived')], state: 'idle', phase: 'ready', error: null,
}
const hook = <T,>(snapshot: T) => <S,>(selector: (value: T) => S): S => selector(snapshot)

function mount() {
  const open = vi.fn()
  const startSession = vi.fn()
  render(<QuickSwitch wide useSessions={hook(sessions)} useWorkspaces={hook(workspaces)}
    useSessionPendingInteraction={hook(new Map())} open={open} startSession={startSession} t={t} />)
  return { open, startSession }
}

describe('quick destinations', () => {
  it('ranks recent conversations and excludes archived and blank rows', () => {
    expect(quickDestinations(sessions, workspaces, '').map(item => item.id)).toEqual(['new', 'old', 'saturn'])
  })
  it('matches title and project path without a remote content-search request', () => {
    expect(quickDestinations(sessions, workspaces, 'DESIGN saturn').map(item => item.id)).toEqual(['new'])
    expect(quickDestinations(sessions, workspaces, 'projects').map(item => item.id)).toEqual(['saturn'])
    expect(quickDestinations(sessions, workspaces, 'unfindable')).toEqual([])
  })
})

describe('quick switch navigation', () => {
  it('opens with Ctrl+K, searches, opens the actual selected conversation, and restores focus', () => {
    const b = mount()
    const launcher = screen.getByRole('button', { name: 'Quick switch' })
    launcher.focus()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = screen.getByRole('combobox')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'checkout' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.open).toHaveBeenCalledWith('old')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })
  it('uses arrow navigation, keeps Tab inside the dialog, and opens a workspace through the existing action', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Quick switch' }))
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Saturn' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    // A workspace title prefix ranks before the conversation's contains match.
    expect(b.open).toHaveBeenCalledWith('new')
    fireEvent.click(screen.getByRole('button', { name: 'Quick switch' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'projects' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(b.startSession).toHaveBeenCalledWith('saturn')
  })
  it('shows an honest empty state and ignores Enter with no match', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Quick switch' }))
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'zzzz' } })
    expect(screen.getByRole('status').textContent).toContain('No matches yet')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.open).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('does not steal the shortcut from another modal and removes its global listener on unmount', () => {
    mount()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.queryByRole('combobox')).toBeNull()
    modal.remove()
    cleanup()
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
