/**
 * Playwright Chromium launcher for browser verify tools. Browsers are not
 * downloaded at install time (`playwright-core`); the first navigation
 * auto-fetches a matching Chromium build when the deployment did not pin an
 * `executablePath`/`channel` and none is cached yet, then retries the launch
 * once. A pinned binary, or a download that fails, surfaces a model-visible
 * error naming the manual install command instead.
 * @module @deepseek-ai/dsh-tool-browser/playwright
 */

import { chromium, type LaunchOptions, type Page, type Request as PwRequest } from 'playwright-core'
import { downloadChromium as defaultDownloadChromium, MANUAL_INSTALL_COMMAND } from './downloader.ts'
import type { ChromiumDownloader, DownloadProgressListener } from './downloader.ts'
import type { BrowserProcess, BrowserTab, ConsoleMessageRecord, NetworkRequestRecord, TabLocator } from './session.ts'

/** Validated Chromium launch facts forwarded to playwright-core. */
export interface PlaywrightLaunchSpec {
  /** Headless Chromium when true; headed when false. */
  headless: boolean
  /** Absolute browser binary, when the deployment pins one. */
  executablePath?: string
  /** Playwright channel name such as `chrome` or `msedge`, when set. */
  channel?: string
  /** Ring-buffer cap on captured console messages, per tab. */
  consoleLimit: number
  /** Ring-buffer cap on captured network requests, per tab. */
  networkLimit: number
  /** Auto-fetch a matching Chromium build on first launch when none is found. Ignored when `executablePath` or `channel` is set. */
  autoDownload: boolean
  /** Called with each installer output line during an auto-fetch. */
  onDownloadProgress: DownloadProgressListener
  /** Test-only override for the real installer. */
  downloadChromium?: ChromiumDownloader
}

/**
 * Recognize playwright-core's own "no matching browser build on disk" error
 * text, so auto-fetch triggers only for that case and not for an unrelated
 * launch failure (a sandbox refusal, a bad `executablePath`, …).
 * @param error - the error `chromium.launch` rejected with.
 * @returns whether the failure is a missing-executable error.
 */
export function isMissingExecutableError(error: unknown): boolean {
  return error instanceof Error && /executable doesn't exist/iu.test(error.message)
}

/**
 * Wrap a Chromium launch failure with install guidance.
 * @param error - the raw launch error.
 * @returns a model-visible error naming the manual fallback.
 */
function wrapLaunchError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(
    `browser: failed to launch Chromium (${detail}). `
    + `Install it with \`${MANUAL_INSTALL_COMMAND}\`, or set executablePath or channel.`,
  )
}

/**
 * Compute the viewport scroll delta for one directional step.
 * @param direction - the axis and sign to scroll.
 * @param amount - pixels to scroll.
 * @returns the `{ dx, dy }` passed to `window.scrollBy`.
 */
function directionDelta(direction: 'up' | 'down' | 'left' | 'right', amount: number): { dx: number; dy: number } {
  switch (direction) {
    case 'up': return { dx: 0, dy: -amount }
    case 'down': return { dx: 0, dy: amount }
    case 'left': return { dx: -amount, dy: 0 }
    case 'right': return { dx: amount, dy: 0 }
  }
}

/**
 * Wrap one Playwright locator resolution as the session's `TabLocator`
 * surface. Resolution is lazy — `page.locator(selector)` never itself
 * rejects; failures surface from the first action.
 * @param page - the owning page.
 * @param selector - a raw selector or an `aria-ref=` handle.
 * @returns the action surface `BrowserSession` calls.
 */
function wrapLocator(page: Page, selector: string): TabLocator {
  const locator = page.locator(selector)
  return {
    click: timeoutMs => locator.click({ timeout: timeoutMs }),
    fill: (value, timeoutMs) => locator.fill(value, { timeout: timeoutMs }),
    pressSequentially: (text, timeoutMs) => locator.pressSequentially(text, { timeout: timeoutMs }),
    press: (key, timeoutMs) => locator.press(key, { timeout: timeoutMs }),
    hover: timeoutMs => locator.hover({ timeout: timeoutMs }),
    scrollIntoView: timeoutMs => locator.scrollIntoViewIfNeeded({ timeout: timeoutMs }),
  }
}

/**
 * Wrap one live Playwright page as a {@link BrowserTab}, attaching bounded
 * console/network capture for the tab's lifetime. Buffers evict the oldest
 * entry once they exceed the configured limit, so a long-lived tab cannot
 * grow them without bound.
 * @param page - the page to wrap.
 * @param consoleLimit - ring-buffer cap on captured console messages.
 * @param networkLimit - ring-buffer cap on captured network requests.
 * @returns the wrapped tab.
 */
function wrapPage(page: Page, consoleLimit: number, networkLimit: number): BrowserTab {
  const consoleBuffer: ConsoleMessageRecord[] = []
  const networkBuffer: NetworkRequestRecord[] = []
  const recordsByRequest = new WeakMap<PwRequest, NetworkRequestRecord>()

  page.on('console', (message) => {
    consoleBuffer.push({ type: message.type(), text: message.text(), time: Date.now() })
    if (consoleBuffer.length > consoleLimit) consoleBuffer.shift()
  })
  page.on('request', (request) => {
    const record: NetworkRequestRecord = {
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      time: Date.now(),
    }
    recordsByRequest.set(request, record)
    networkBuffer.push(record)
    if (networkBuffer.length > networkLimit) networkBuffer.shift()
  })
  page.on('response', (response) => {
    const record = recordsByRequest.get(response.request())
    if (record !== undefined) record.status = response.status()
  })

  return {
    goto: (url, options) => page.goto(url, options),
    url: () => page.url(),
    title: () => page.title(),
    ariaSnapshot: () => page.locator('html').ariaSnapshot({ mode: 'ai' }),
    screenshot: options => page.screenshot(options),
    locator: selector => wrapLocator(page, selector),
    keyboardPress: async (key, _timeoutMs) => {
      // Playwright's Keyboard has no per-call timeout; the caller's cooperative
      // deadline and `signal` govern cancellation at the session layer.
      await page.keyboard.press(key)
    },
    scrollViewport: async (direction, amount) => {
      const delta = directionDelta(direction, amount)
      await page.evaluate(({ dx, dy }) => {
        window.scrollBy(dx, dy)
      }, delta)
    },
    innerText: () => page.locator('body').innerText(),
    consoleMessages: () => consoleBuffer.slice(),
    networkRequests: () => networkBuffer.slice(),
    close: () => page.close(),
  }
}

/**
 * Start Chromium through playwright-core, auto-fetching a matching build on
 * the first missing-executable failure when the deployment did not pin one.
 * @param spec - validated launch facts.
 * @returns a process whose `newTab` opens additional pages and `close` shuts the engine down.
 */
export async function launchPlaywright(spec: PlaywrightLaunchSpec): Promise<BrowserProcess> {
  const launchOptions: LaunchOptions = { headless: spec.headless }
  if (spec.executablePath !== undefined) launchOptions.executablePath = spec.executablePath
  if (spec.channel !== undefined) launchOptions.channel = spec.channel

  let browser
  try {
    browser = await chromium.launch(launchOptions)
  } catch (error) {
    const canAutoFetch = spec.autoDownload
      && spec.executablePath === undefined
      && spec.channel === undefined
      && isMissingExecutableError(error)
    if (!canAutoFetch) throw wrapLaunchError(error)
    const downloader = spec.downloadChromium ?? defaultDownloadChromium
    await downloader(spec.onDownloadProgress)
    try {
      browser = await chromium.launch(launchOptions)
    } catch (retryError) {
      throw wrapLaunchError(retryError)
    }
  }
  const openBrowser = browser
  return {
    async newTab(): Promise<BrowserTab> {
      const page = await openBrowser.newPage()
      return wrapPage(page, spec.consoleLimit, spec.networkLimit)
    },
    close: () => openBrowser.close(),
  }
}
