import { describe, expect, it, vi } from 'vitest'
import {
  buildApplicationMenu,
  buildTrayMenu,
  buildWindowMenu,
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopBridgePayload,
  desktopIpcSenderIsApplication,
  desktopLaunchArguments,
  desktopWebArguments,
  ensureMainModuleArgument,
  navigationDisposition,
  trayIconFile,
  windowCloseDisposition,
} from '../src/lifecycle.ts'

describe('desktop web service policy', () => {
  it('binds loopback on an OS-assigned port and accepts only the activated address', () => {
    expect(desktopWebArguments()).toEqual(['--host', '127.0.0.1', '--port', '0', '--no-open'])
    expect(desktopApplicationUrl('127.0.0.1', 43_127)).toBe('http://127.0.0.1:43127/')
    expect(() => desktopApplicationUrl('0.0.0.0', 43_127)).toThrow('unexpected host')
    expect(() => desktopApplicationUrl('127.0.0.1', 0)).toThrow('invalid port')
  })

  it('supplies only a packaged launch that omitted the main-module argument', () => {
    const packaged = ['/Applications/DSHCode.app/Contents/MacOS/DSHCode']
    ensureMainModuleArgument(packaged, '/Applications/DSHCode.app/Contents/Resources/app/lib/main.js')
    expect(packaged[1]).toBe('/Applications/DSHCode.app/Contents/Resources/app/lib/main.js')

    const development = ['/path/to/electron', '/workspace/apps/desktop']
    ensureMainModuleArgument(development, '/workspace/apps/desktop/lib/main.js')
    expect(development[1]).toBe('/workspace/apps/desktop')
  })
})

describe('desktop navigation policy', () => {
  const origin = 'http://127.0.0.1:43127'

  it('keeps same-origin navigation in the application', () => {
    expect(navigationDisposition(`${origin}/settings`, origin)).toBe('application')
  })

  it('opens only HTTPS destinations externally', () => {
    expect(navigationDisposition('https://deepseek.com/', origin)).toBe('external')
    expect(navigationDisposition('http://example.com/', origin)).toBe('blocked')
    expect(navigationDisposition('file:///tmp/secret', origin)).toBe('blocked')
    expect(navigationDisposition('not a url', origin)).toBe('blocked')
  })
})

describe('desktop quit coordination', () => {
  it('coalesces requests and exits only after Harness teardown settles', async () => {
    let settle: (() => void) | undefined
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    const exit = vi.fn()
    const coordinator = createQuitCoordinator({ shutdown }, exit)

    const first = coordinator.request(0)
    const repeated = coordinator.request(1)
    expect(coordinator.requested).toBe(true)
    expect(first).toBe(repeated)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    settle?.()
    await first
    expect(exit).toHaveBeenCalledWith(0)
  })
})

describe('desktop tray and close-to-tray policy', () => {
  it('hides a window close unless a real quit owns teardown', () => {
    expect(windowCloseDisposition(false)).toBe('hide')
    expect(windowCloseDisposition(true)).toBe('close')
  })

  it('builds the tray menu with show, about, and quit actions', () => {
    const show = vi.fn()
    const about = vi.fn()
    const quit = vi.fn()
    const menu = buildTrayMenu({ productName: 'Saturn AI', show, about, quit })

    expect(menu.map(item => item.type === 'separator' ? '---' : item.label))
      .toEqual(['Show Saturn AI', '---', 'About Saturn AI\u2026', '---', 'Quit Saturn AI'])
    const [showItem, , aboutItem, , quitItem] = menu
    if (showItem === undefined || aboutItem === undefined || quitItem === undefined
      || showItem.type === 'separator' || aboutItem.type === 'separator' || quitItem.type === 'separator') {
      throw new Error('menu items must be actions')
    }
    showItem.click?.()
    expect(show).toHaveBeenCalledOnce()
    aboutItem.click?.()
    expect(about).toHaveBeenCalledOnce()
    quitItem.click?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('composes every product-naming tray label from the supplied product name', () => {
    const menu = buildTrayMenu({ productName: 'Forked Name', show: vi.fn(), about: vi.fn(), quit: vi.fn() })
    const labels = menu.flatMap(item => item.label === undefined ? [] : [item.label])
    expect(labels).toEqual(['Show Forked Name', 'About Forked Name\u2026', 'Quit Forked Name'])
  })

  it('selects the 16 px logo on macOS and the 32 px one elsewhere', () => {
    expect(trayIconFile('darwin')).toBe('tray16.png')
    expect(trayIconFile('win32')).toBe('tray.png')
    expect(trayIconFile('linux')).toBe('tray.png')
  })
})

describe('desktop preload bridge policy', () => {
  it('round-trips the launch arguments with an encoded product name and version', () => {
    const args = desktopLaunchArguments('DSHCode', '1.0.0')
    expect(args).toEqual(['--dsh-product-name=DSHCode', '--dsh-app-version=1.0.0'])
    expect(desktopBridgePayload(args, 'darwin'))
      .toEqual({ frame: 'native', productName: 'DSHCode', appVersion: '1.0.0' })
  })

  it('reports the custom frame only when the caller appends the frame argument', () => {
    const args = ['--dsh-frame=custom', ...desktopLaunchArguments('DSHCode', '1.0.0')]
    expect(desktopBridgePayload(args, 'win32'))
      .toEqual({ frame: 'custom', productName: 'DSHCode', appVersion: '1.0.0' })
  })

  it('defaults to a native frame and empty product name and version without the arguments', () => {
    expect(desktopBridgePayload([], 'darwin')).toEqual({ frame: 'native', productName: '', appVersion: '' })
    expect(desktopBridgePayload(['--some-other=flag'], 'linux'))
      .toEqual({ frame: 'native', productName: '', appVersion: '' })
  })

  it('accepts only application-origin IPC senders', () => {
    const origin = 'http://127.0.0.1:43127'
    expect(desktopIpcSenderIsApplication(`${origin}/settings`, origin)).toBe(true)
    expect(desktopIpcSenderIsApplication('https://evil.example/', origin)).toBe(false)
    expect(desktopIpcSenderIsApplication(undefined, origin)).toBe(false)
    expect(desktopIpcSenderIsApplication('not a url', origin)).toBe(false)
  })

  it('builds the window menu with about, restart, hide, and quit actions', () => {
    const about = vi.fn()
    const hide = vi.fn()
    const restart = vi.fn()
    const quit = vi.fn()
    const menu = buildWindowMenu({ productName: 'Saturn AI', about, hide, restart, quit })

    expect(menu.map(item => item.type === 'separator' ? '---' : item.label))
      .toEqual(['About Saturn AI\u2026', '---', 'Restart Saturn AI', 'Hide to Tray', '---', 'Quit Saturn AI'])
    const [aboutItem, , restartItem, hideItem, , quitItem] = menu
    if (aboutItem === undefined || restartItem === undefined || hideItem === undefined || quitItem === undefined
      || aboutItem.type === 'separator' || restartItem.type === 'separator'
      || hideItem.type === 'separator' || quitItem.type === 'separator') {
      throw new Error('menu items must be actions')
    }
    aboutItem.click?.()
    expect(about).toHaveBeenCalledOnce()
    restartItem.click?.()
    expect(restart).toHaveBeenCalledOnce()
    hideItem.click?.()
    expect(hide).toHaveBeenCalledOnce()
    quitItem.click?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('declares no window-menu accelerator Electron would display without binding', () => {
    const menu = buildWindowMenu({
      productName: 'Saturn AI',
      about: vi.fn(),
      hide: vi.fn(),
      restart: vi.fn(),
      quit: vi.fn(),
    })
    expect(menu.every(item => !('accelerator' in item))).toBe(true)
  })
})

describe('desktop application menu policy', () => {
  it('replaces the stock menu bar with the four branded top-level menus', () => {
    const menu = buildApplicationMenu({ productName: 'Saturn AI', about: vi.fn() })
    expect(menu.map(item => item.label)).toEqual(['Saturn AI', 'Edit', 'View', 'Window'])
  })

  it('routes the app menu About row to the shell About surface', () => {
    const about = vi.fn()
    const appMenu = buildApplicationMenu({ productName: 'Saturn AI', about }).at(0)
    expect(appMenu?.submenu?.map(item => item.type === 'separator' ? '---' : item.label ?? item.role))
      .toEqual(['About Saturn AI\u2026', '---', 'services', '---', 'hide', 'hideOthers', 'unhide', '---', 'quit'])
    appMenu?.submenu?.[0]?.click?.()
    expect(about).toHaveBeenCalledOnce()
  })

  it('keeps every stock role binding the system menu bar supplied', () => {
    const menu = buildApplicationMenu({ productName: 'Saturn AI', about: vi.fn() })
    const rolesOf = (label: string) => menu.find(item => item.label === label)?.submenu
      ?.map(item => item.role)
      .filter((role): role is NonNullable<typeof role> => role !== undefined)

    expect(rolesOf('Edit')).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    expect(rolesOf('View')).toEqual([
      'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen',
    ])
    expect(rolesOf('Window')).toEqual(['minimize', 'zoom', 'front'])
  })

  it('drops the stock Help menu and its upstream Electron link', () => {
    const menu = buildApplicationMenu({ productName: 'Saturn AI', about: vi.fn() })
    expect(menu.some(item => item.label === 'Help')).toBe(false)
    expect(JSON.stringify(menu)).not.toContain('electronjs.org')
  })
})
