// @vitest-environment jsdom
/**
 * DesktopTitleBar chrome smoke: without the desktop preload bridge or on a
 * native frame (plain browsers and macOS keep the system title bar) the
 * application frame renders unwrapped; on a custom frame (Windows) the
 * draggable bar renders the branded product name — Saturn mark plus name —
 * and a menu button labeled from the product name, wired to the bridge
 * popup, above the frame. The optional context prop renders the selected
 * session title as a muted trailing segment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DesktopTitleBar } from '../src/client/DesktopTitleBar.tsx'

afterEach(() => {
  cleanup()
  delete window.dshDesktop
})

describe('DesktopTitleBar', () => {
  it('renders the children without the desktop bridge', () => {
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByTestId('frame')).toBeTruthy()
  })

  it('renders the children without the title bar on a native frame', () => {
    window.dshDesktop = { frame: 'native', productName: 'Saturn AI', appVersion: '', showMenu: () => {}, restart: () => {} }
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByTestId('frame')).toBeTruthy()
    expect(screen.queryByText('Saturn AI')).toBeNull()
  })

  it('renders the brand with the Saturn mark and wires the product-name menu button on a custom frame', () => {
    const showMenu = vi.fn()
    window.dshDesktop = { frame: 'custom', productName: 'Saturn AI', appVersion: '', showMenu, restart: () => {} }
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByText('Saturn AI')).toBeTruthy()
    expect(screen.getByTestId('frame')).toBeTruthy()
    const brand = screen.getByText('Saturn AI').closest('span')
    expect(brand?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64')
    const menu = screen.getByLabelText('Saturn AI menu')
    expect(menu.getAttribute('title')).toBe('Saturn AI menu')
    menu.click()
    expect(showMenu).toHaveBeenCalledOnce()
  })

  it('renders the muted context segment after the brand only when the context prop is defined', () => {
    window.dshDesktop = { frame: 'custom', productName: 'Saturn AI', appVersion: '', showMenu: () => {}, restart: () => {} }
    const { rerender } = render(<DesktopTitleBar context="Debugging the title bar"><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByText('Saturn AI')).toBeTruthy()
    expect(screen.getByText('— Debugging the title bar')).toBeTruthy()
    rerender(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByText('Saturn AI')).toBeTruthy()
    expect(screen.queryByText('— Debugging the title bar')).toBeNull()
  })
})
