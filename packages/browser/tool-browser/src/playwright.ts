/**
 * Playwright Chromium launcher for browser verify tools. Browsers are not
 * downloaded at install time (`playwright-core`); the first navigation fails
 * with install guidance when no executable is available.
 * @module @deepseek-ai/dsh-tool-browser/playwright
 */

import { chromium, type LaunchOptions } from 'playwright-core'
import type { BrowserProcess, BrowserTab } from './session.ts'

/** Validated Chromium launch facts forwarded to playwright-core. */
export interface PlaywrightLaunchSpec {
  /** Headless Chromium when true; headed when false. */
  headless: boolean
  /** Absolute browser binary, when the deployment pins one. */
  executablePath?: string
  /** Playwright channel name such as `chrome` or `msedge`, when set. */
  channel?: string
}

/**
 * Start Chromium through playwright-core and wrap the first page as a tab.
 * @param spec - validated launch facts.
 * @returns a process whose `close` shuts the engine down.
 */
export async function launchPlaywright(spec: PlaywrightLaunchSpec): Promise<BrowserProcess> {
  const launchOptions: LaunchOptions = { headless: spec.headless }
  if (spec.executablePath !== undefined) launchOptions.executablePath = spec.executablePath
  if (spec.channel !== undefined) launchOptions.channel = spec.channel
  let browser
  try {
    browser = await chromium.launch(launchOptions)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `browser: failed to launch Chromium (${detail}). `
      + 'Install it with `pnpm exec playwright install chromium`, or set executablePath or channel.',
    )
  }
  return {
    async newTab(): Promise<BrowserTab> {
      const page = await browser.newPage()
      return {
        goto: (url, options) => page.goto(url, options),
        url: () => page.url(),
        title: () => page.title(),
        ariaSnapshot: () => page.locator('html').ariaSnapshot(),
        screenshot: options => page.screenshot(options),
      }
    },
    close: () => browser.close(),
  }
}
