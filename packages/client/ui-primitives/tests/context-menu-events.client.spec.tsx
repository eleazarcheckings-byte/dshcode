// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from '../src/ContextMenu.tsx'

afterEach(cleanup)

describe('ContextMenu portal events', () => {
  it('selects the action without activating or reopening its invoking control', () => {
    const activate = vi.fn(), reopen = vi.fn(), select = vi.fn()
    render(<button type="button" aria-label="Open session" onClick={activate} onContextMenu={reopen}>
      <ContextMenu open target={{ kind: 'point', x: 20, y: 20 }} label="Session actions"
        items={[{ id: 'rename', label: 'Rename' }]} onSelect={select} onClose={vi.fn()} />
    </button>)
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(select).toHaveBeenCalledExactlyOnceWith('rename')
    expect(activate).not.toHaveBeenCalled()
    fireEvent.contextMenu(menu)
    expect(reopen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
    expect(activate).toHaveBeenCalledOnce()
  })
})
