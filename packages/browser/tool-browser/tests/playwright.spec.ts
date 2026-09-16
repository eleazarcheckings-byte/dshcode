import { describe, expect, it, vi } from 'vitest'
import { launchPlaywright } from '../src/playwright.ts'

const { launch } = vi.hoisted(() => ({
  launch: vi.fn((_options?: unknown): Promise<unknown> => {
    return Promise.reject(new Error('playwright launch mock not configured'))
  }),
}))

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (options?: unknown): Promise<unknown> => launch(options),
  },
}))

describe('launchPlaywright', () => {
  it('wraps the first page and forwards headless, executablePath, and channel', async () => {
    const close = vi.fn(async () => {})
    const page = {
      goto: vi.fn(),
      url: vi.fn(() => 'http://127.0.0.1/'),
      title: vi.fn(async () => 'T'),
      locator: vi.fn(() => ({ ariaSnapshot: vi.fn(async () => '- heading "T"') })),
      screenshot: vi.fn(async () => Buffer.from('png')),
    }
    launch.mockResolvedValueOnce({
      newPage: async () => page,
      close,
    })

    const process = await launchPlaywright({
      headless: false,
      executablePath: '/opt/chrome',
      channel: 'chrome',
    })
    expect(launch).toHaveBeenCalledWith({
      headless: false,
      executablePath: '/opt/chrome',
      channel: 'chrome',
    })
    const tab = await process.newTab()
    await tab.goto('http://127.0.0.1/', { waitUntil: 'domcontentloaded', timeout: 10 })
    expect(page.goto).toHaveBeenCalledWith('http://127.0.0.1/', { waitUntil: 'domcontentloaded', timeout: 10 })
    expect(tab.url()).toBe('http://127.0.0.1/')
    expect(await tab.title()).toBe('T')
    expect(await tab.ariaSnapshot()).toBe('- heading "T"')
    expect(await tab.screenshot({ type: 'png', fullPage: true })).toEqual(Buffer.from('png'))
    await process.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rewrites a launch failure with install guidance', async () => {
    launch.mockRejectedValueOnce(new Error('Executable does not exist'))
    await expect(launchPlaywright({ headless: true })).rejects.toThrow(
      /browser: failed to launch Chromium \(Executable does not exist\)/,
    )
    launch.mockRejectedValueOnce('boom')
    await expect(launchPlaywright({ headless: true })).rejects.toThrow(
      /browser: failed to launch Chromium \(boom\)/,
    )
  })
})
