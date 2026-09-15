// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate, registerDomSnapshotSerializer } from '@deepseek-ai/dsh-client-test-runtime'
import { Dashboard } from '../src/client/Dashboard.tsx'
import { Approvals, Memory } from '../src/client/History.tsx'
import { parseAdvanced } from '../src/client/Configuration.tsx'
import { en } from '../src/client/locales.ts'
import { actions, at, branch, id, snapshot, state } from './fixtures.client.ts'

const t = makeTranslate(en)
registerDomSnapshotSerializer()
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('SaturnBot messenger', () => {
  it('opens an honest first conversation with five selectable roles and real context', () => {
    render(<Dashboard state={state()} workspaces={[]} actions={actions()} t={t} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Chief of Staff')
    expect(screen.getByRole('button', { name: /Developer/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Growth/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Operations/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Finance/ })).toBeTruthy()
    expect(screen.getByRole('log').textContent).toContain(en['chat.noMessages'])
    expect(screen.queryByText(/screen feed|trial expires|\d+%/i)).toBeNull()
  })

  it('keeps separate role drafts, sends the selected role, and clears only after success', async () => {
    const api = actions()
    render(<Dashboard state={state()} workspaces={[]} actions={api} t={t} />)
    const chiefDraft = screen.getByRole('textbox', { name: /Message Chief/ })
    fireEvent.change(chiefDraft, { target: { value: 'Plan the week' } })
    fireEvent.click(screen.getByRole('button', { name: /Developer/ }))
    const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Message Developer/ })
    fireEvent.change(draft, { target: { value: 'Review navigation' } })
    fireEvent.keyDown(draft, { key: 'Enter', shiftKey: true })
    expect(api.message).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en['chat.send'] }))
    await waitFor(() => { expect(api.message).toHaveBeenCalledWith('developer', 'Review navigation'); expect(draft.value).toBe('') })
    fireEvent.click(screen.getByRole('button', { name: 'Chief of Staff' }))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Message Chief/ }).value).toBe('Plan the week')
  })

  it('retains a rejected message and reports the actual error', async () => {
    const api = actions(); vi.mocked(api.message).mockRejectedValue(new Error('The team is already running.'))
    render(<Dashboard state={state()} workspaces={[]} actions={api} t={t} />)
    const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Message Chief/ })
    fireEvent.change(draft, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: en['chat.send'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('The team is already running.') })
    expect(draft.value).toBe('Keep this draft')
  })

  it('shows only the selected role timeline and disables dispatch during an active cycle', () => {
    const data = snapshot({ status: 'running', activeCycle: { id: id('cycle-1'), status: 'running', startedAt: at, finishedAt: null, plan: 'Review', branches: [branch] }, messages: [
      { id: id('m1'), role: 'developer', sender: 'agent', content: 'Navigation inspected.', at, cycleId: id('cycle-1') },
      { id: id('m2'), role: 'finance', sender: 'agent', content: 'Ledger reviewed.', at, cycleId: id('cycle-1') },
    ] })
    render(<Dashboard state={state(data)} workspaces={[]} actions={actions()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Developer/ }))
    expect(within(screen.getByRole('log')).getByText('Navigation inspected.')).toBeTruthy()
    expect(within(screen.getByRole('log')).queryByText('Ledger reviewed.')).toBeNull()
    const timeline = screen.getByRole('log').cloneNode(true) as HTMLElement
    // Preserve the machine-readable time while keeping the snapshot independent of the host locale and time zone.
    timeline.querySelectorAll('time').forEach((time) => { time.textContent = time.dateTime })
    expect(timeline).toMatchSnapshot()
    fireEvent.change(screen.getByRole('textbox', { name: /Message Developer/ }), { target: { value: 'Next task' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['chat.send'] }).disabled).toBe(true)
  })

  it('takes incomplete setup to configuration instead of dispatching or resuming', () => {
    const api = actions(), data = snapshot({ status: 'needs-setup', config: { ...snapshot().config, goal: '', workspace: '' } })
    render(<Dashboard state={state(data)} workspaces={[]} actions={api} t={t} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure SaturnBot' })[0]!)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings')
    expect(api.runNow).not.toHaveBeenCalled()
    expect(api.configure).not.toHaveBeenCalled()
  })

  it('pauses only the visualization while live execution context continues to update', () => {
    const api = actions()
    const cycle = { id: id('cycle-1'), status: 'running' as const, startedAt: at, finishedAt: null, plan: 'Review', branches: [branch] }
    const view = render(<Dashboard state={state(snapshot({ status: 'running', activeCycle: cycle }))} workspaces={[]} actions={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: en['chat.showInspector'] }))
    const pause = screen.getByRole<HTMLButtonElement>('button', { name: en['canvas.pause'] })
    expect(pause.type).toBe('button')
    pause.focus()
    expect(document.activeElement).toBe(pause)
    expect(pause).toMatchSnapshot('pause visualization action')
    fireEvent.click(pause)
    expect(screen.getByRole('button', { name: en['canvas.resume'] })).toMatchSnapshot('resume visualization action')
    view.rerender(<Dashboard state={state(snapshot({ status: 'awaiting-approval', activeCycle: { ...cycle, status: 'awaiting-approval', branches: [{ ...branch, status: 'awaiting-approval' }] } }))} workspaces={[]} actions={api} t={t} />)
    const inspector = screen.getByRole('complementary', { name: en['chat.inspector'] })
    expect(within(inspector).getAllByText(en['status.awaiting-approval']).length).toBeGreaterThan(0)
    expect(within(inspector).getByRole('button', { name: en['canvas.resume'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['chat.hideInspector'] }))
    fireEvent.click(screen.getByRole('button', { name: en['chat.showInspector'] }))
    fireEvent.click(screen.getByRole('button', { name: en['canvas.resume'] }))
    expect(screen.getByRole('button', { name: en['canvas.pause'] })).toBeTruthy()
    expect(api.pause).not.toHaveBeenCalled()
    expect(api.cancel).not.toHaveBeenCalled()
    expect(api.configure).not.toHaveBeenCalled()
  })

  it('reviews the exact approval payload before one-action decisions', () => {
    const decide = vi.fn()
    const data = snapshot({ approvals: [{ id: id('approval-1'), cycleId: id('cycle-1'), branchId: branch.id, actionIndex: 0, tool: 'files.write', input: { path: 'src/app.ts', content: 'reviewable content' }, stage: { path: 'C:/stage/branch-1', revision: 'abc123' }, status: 'pending', createdAt: at, decidedAt: null }] })
    render(<Approvals snapshot={data} busy={false} decide={decide} t={t} />)
    expect(screen.getByText(/reviewable content/)).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(decide).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }))
    expect(decide).toHaveBeenCalledWith(id('approval-1'), true)
  })

  it('preserves the host newest-first briefing order and shows actual stored memory', () => {
    const data = snapshot({ reports: [
      { id: id('new'), cycleId: id('cycle-2'), date: '2026-09-14', title: 'Latest briefing', markdown: 'Latest recorded outcome', channel: 'daily' },
      { id: id('old'), cycleId: id('cycle-1'), date: '2026-09-13', title: 'Older briefing', markdown: 'Old outcome', channel: 'daily' },
    ] })
    render(<Memory snapshot={data} records={{ ...state(data), memory: [{ key: 'release.target', value: 'Monday', updatedAt: at }] }} search={vi.fn()} t={t} />)
    expect(screen.getByRole('heading', { name: 'Latest briefing' })).toBeTruthy()
    expect(screen.queryByText('Old outcome')).toBeNull()
    expect(screen.getByText('release.target')).toBeTruthy()
    expect(screen.getByText('Monday')).toBeTruthy()
  })
})

it('validates editable advanced configuration at the input boundary', () => {
  expect(parseAdvanced('[["npm","test"]]', '{"mail":{"credentialEnv":"MAIL_TOKEN"}}')).toEqual({ validationCommands: [['npm', 'test']], integrations: { mail: { credentialEnv: 'MAIL_TOKEN' } } })
  expect(() => parseAdvanced('[["npm",7]]', '{}')).toThrow()
  expect(() => parseAdvanced('[[]]', '{}')).toThrow()
  expect(() => parseAdvanced('[]', '{"mail":{"token":"secret"}}')).toThrow()
})
