import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  launch.mockClear()
})

describe('launchPlaywright', () => {
  it('wraps the first page and forwards headless, executablePath, and channel', async () => {
    const close = vi.fn(async () => {})
    const page = {
      goto: vi.fn(),
      url: vi.fn(() => 'http://127.0.0.1/'),
      title: vi.fn(async () => 'T'),
      locator: vi.fn((selector: string) => selector === 'html'
        ? { ariaSnapshot: vi.fn(async () => '- heading "T"') }
        : { innerText: vi.fn(async () => 'body text') }),
      screenshot: vi.fn(async () => Buffer.from('png')),
      keyboard: { press: vi.fn(async () => {}) },
      evaluate: vi.fn(async () => {}),
      on: vi.fn(),
      close: vi.fn(async () => {}),
    }
    launch.mockResolvedValueOnce({
      newPage: async () => page,
      close,
    })

    const process = await launchPlaywright({
      headless: false,
      executablePath: '/opt/chrome',
      channel: 'chrome',
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: () => {},
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
    expect(page.on).toHaveBeenCalledWith('console', expect.any(Function))
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function))
    expect(page.on).toHaveBeenCalledWith('response', expect.any(Function))
    await process.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rewrites a launch failure with install guidance', async () => {
    const baseSpec = {
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: () => {},
    }
    launch.mockRejectedValueOnce(new Error('Executable does not exist'))
    await expect(launchPlaywright(baseSpec)).rejects.toThrow(
      /browser: failed to launch Chromium \(Executable does not exist\)/,
    )
    launch.mockRejectedValueOnce('boom')
    await expect(launchPlaywright(baseSpec)).rejects.toThrow(
      /browser: failed to launch Chromium \(boom\)/,
    )
  })

  it('auto-fetches Chromium once on a missing-executable failure, then retries the launch', async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /fake/path"))
    const page = {
      goto: vi.fn(),
      url: vi.fn(() => 'http://127.0.0.1/'),
      title: vi.fn(async () => 'T'),
      locator: vi.fn(() => ({ ariaSnapshot: vi.fn(async () => '- heading "T"') })),
      screenshot: vi.fn(async () => Buffer.from('png')),
      keyboard: { press: vi.fn(async () => {}) },
      evaluate: vi.fn(async () => {}),
      on: vi.fn(),
      close: vi.fn(async () => {}),
    }
    const closeAfterDownload = vi.fn(async () => {})
    launch.mockResolvedValueOnce({ newPage: async () => page, close: closeAfterDownload })

    const progressLines: string[] = []
    const downloadChromium = vi.fn(async (onProgress: (line: string) => void) => {
      onProgress('Downloading Chromium 50%')
      onProgress('Downloading Chromium 100%, done')
    })

    const process = await launchPlaywright({
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: line => progressLines.push(line),
      downloadChromium,
    })

    expect(downloadChromium).toHaveBeenCalledTimes(1)
    expect(progressLines).toEqual(['Downloading Chromium 50%', 'Downloading Chromium 100%, done'])
    expect(launch).toHaveBeenCalledTimes(2)
    const tab = await process.newTab()
    expect(await tab.title()).toBe('T')
  })

  it('does not auto-fetch when executablePath is pinned, even on a missing-executable failure', async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /pinned/chrome"))
    const downloadChromium = vi.fn(async () => {})
    await expect(launchPlaywright({
      headless: true,
      executablePath: '/pinned/chrome',
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: () => {},
      downloadChromium,
    })).rejects.toThrow(/browser: failed to launch Chromium/)
    expect(downloadChromium).not.toHaveBeenCalled()
  })

  it('does not auto-fetch when autoDownload is false', async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /fake/path"))
    const downloadChromium = vi.fn(async () => {})
    await expect(launchPlaywright({
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: false,
      onDownloadProgress: () => {},
      downloadChromium,
    })).rejects.toThrow(/browser: failed to launch Chromium/)
    expect(downloadChromium).not.toHaveBeenCalled()
  })

  it('surfaces a failed download as a model-visible error naming the manual command', async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /fake/path"))
    const downloadChromium = vi.fn(async () => {
      throw new Error('browser: Chromium download failed (installer exited with code 1). Install it yourself with `pnpm exec playwright install chromium`.')
    })
    await expect(launchPlaywright({
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: () => {},
      downloadChromium,
    })).rejects.toThrow(/pnpm exec playwright install chromium/)
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('does not auto-fetch on an unrelated launch failure', async () => {
    launch.mockRejectedValueOnce(new Error('spawn EACCES'))
    const downloadChromium = vi.fn(async () => {})
    await expect(launchPlaywright({
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: true,
      onDownloadProgress: () => {},
      downloadChromium,
    })).rejects.toThrow(/browser: failed to launch Chromium \(spawn EACCES\)/)
    expect(downloadChromium).not.toHaveBeenCalled()
  })
})
