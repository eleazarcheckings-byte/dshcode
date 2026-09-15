// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createSaturnBotWindowLauncher } from '../src/client/window-launcher.ts'

// The shell owns the full Window declaration; fixtures install only the capability under test.
const desktopWindow = window as unknown as { dshDesktop?: { restoreSaturnBot?: () => Promise<boolean> } }
afterEach(() => { delete desktopWindow.dshDesktop; vi.restoreAllMocks() })

it('opens synchronously in the browser gesture, reuses the popup, and replaces a closed one', async () => {
  const popup = { closed: false, focus: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  const launch = createSaturnBotWindowLauncher()
  const first = launch()
  expect(open).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledWith(`${window.location.origin}/?saturnbot=1`, 'saturnbot', expect.any(String))
  expect(await first).toBe(true)
  expect(await launch()).toBe(true)
  expect(popup.focus).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledOnce()
  popup.closed = true
  expect(await launch()).toBe(true)
  expect(open).toHaveBeenCalledTimes(2)
})

it('restores the native popup instead of navigating it or depending on browser focus', async () => {
  const restore = vi.fn(async () => true)
  desktopWindow.dshDesktop = { restoreSaturnBot: restore }
  const open = vi.spyOn(window, 'open')
  expect(await createSaturnBotWindowLauncher()()).toBe(true)
  expect(restore).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
})

it('creates the first desktop popup and coalesces concurrent requests', async () => {
  let settle!: (exists: boolean) => void
  const restore = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
  desktopWindow.dshDesktop = { restoreSaturnBot: restore }
  const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window)
  const launch = createSaturnBotWindowLauncher()
  const first = launch()
  expect(launch()).toBe(first)
  expect(open).not.toHaveBeenCalled()
  settle(false)
  expect(await first).toBe(true)
  expect(restore).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledOnce()
})

it('reports popup blocking and propagates native failures without opening another window', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const launch = createSaturnBotWindowLauncher()
  expect(await launch()).toBe(false)
  desktopWindow.dshDesktop = { restoreSaturnBot: vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValueOnce(true) }
  await expect(launch()).rejects.toThrow('transport')
  expect(await launch()).toBe(true)
  expect(open).toHaveBeenCalledOnce()
})
