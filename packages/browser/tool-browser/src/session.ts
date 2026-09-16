/**
 * One shared browser tab for verify tools. Launch is deferred until the first
 * navigation so schema harvest and plugin load do not start Chromium.
 * @module @deepseek-ai/dsh-tool-browser/session
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Footer appended when an accessibility tree is cut to {@link SnapshotRequest.maxChars}. */
export const SNAPSHOT_TRUNCATION_FOOTER = '\n(Snapshot truncated.)'

/** One tab the session drives. */
export interface BrowserTab {
  /**
   * Navigate to an absolute URL.
   * @param url - canonical http(s) href.
   * @param options - Playwright-compatible navigation options.
   */
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>
  /** The tab's current URL after redirects. */
  url(): string
  /** The document title. */
  title(): Promise<string>
  /** Playwright ARIA snapshot of the root document. */
  ariaSnapshot(): Promise<string>
  /**
   * Encode the current page as a PNG.
   * @param options - PNG encoding options.
   */
  screenshot(options: { type: 'png'; fullPage: boolean }): Promise<Buffer>
}

/** The process that owns tabs; closing it tears the engine down. */
export interface BrowserProcess {
  /** Open the single tab this session keeps. */
  newTab(): Promise<BrowserTab>
  /** Shut the engine down. */
  close(): Promise<void>
}

/** Launch Chromium (or a test double) when the first navigation needs a tab. */
export type BrowserLauncher = () => Promise<BrowserProcess>

/** Inputs for one accessibility snapshot, with an optional PNG write. */
export interface SnapshotRequest {
  /** Whether to write a PNG beside the accessibility tree. */
  screenshot: boolean
  /** Character cap on the accessibility tree, including any truncation footer. */
  maxChars: number
  /** Byte cap on a PNG before it is written. */
  screenshotMaxBytes: number
  /** Directory that receives exclusive owner-only PNG files. */
  screenshotDir: string
}

/** Canonical snapshot value returned to the tool registry. */
export interface SnapshotValue {
  url: string
  title: string
  snapshot: string
  truncated: boolean
  screenshotPath?: string
}

/**
 * Race a tab operation against caller cancellation. The losing work is not
 * aborted inside Playwright; the next call still uses the same tab.
 * @param signal - caller cancellation.
 * @param work - the tab operation.
 * @returns the operation's result.
 */
export async function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  throwIfBrowserAborted(signal)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Throw when `signal` is already aborted, wrapping a non-Error reason.
 * @param signal - caller cancellation.
 */
function throwIfBrowserAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

/**
 * Prefer the abort Error when one was supplied; otherwise use a stable message.
 * @param signal - aborted signal.
 * @returns the error to throw.
 */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('browser: aborted')
}

/**
 * Bound an accessibility tree and record whether the footer was applied.
 * @param snapshot - the raw ARIA tree.
 * @param maxChars - inclusive cap on the returned string.
 * @returns the possibly truncated tree and a truncation flag.
 */
export function boundSnapshot(snapshot: string, maxChars: number): { snapshot: string; truncated: boolean } {
  if (snapshot.length <= maxChars) return { snapshot, truncated: false }
  if (maxChars <= SNAPSHOT_TRUNCATION_FOOTER.length) {
    return { snapshot: snapshot.slice(0, maxChars), truncated: true }
  }
  return {
    snapshot: `${snapshot.slice(0, maxChars - SNAPSHOT_TRUNCATION_FOOTER.length)}${SNAPSHOT_TRUNCATION_FOOTER}`,
    truncated: true,
  }
}

/**
 * Shared Chromium tab: one engine, one page, closed with the plugin fiber.
 */
export class BrowserSession {
  private process: BrowserProcess | undefined
  private tab: BrowserTab | undefined
  private closed = false

  /**
   * @param launch - starts Chromium on first use.
   */
  constructor(private readonly launch: BrowserLauncher) {}

  /**
   * Open `url` in the shared tab, launching Chromium on the first call.
   * @param url - canonical http(s) href.
   * @param timeoutMs - navigation timeout forwarded to Playwright.
   * @param signal - caller cancellation.
   * @returns the post-redirect URL and document title.
   */
  async navigate(url: string, timeoutMs: number, signal: AbortSignal): Promise<{ url: string; title: string }> {
    const tab = await this.ensureTab(signal)
    await raceAbort(signal, tab.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }))
    return { url: tab.url(), title: await raceAbort(signal, tab.title()) }
  }

  /**
   * Capture the current tab's accessibility tree, and optionally a PNG.
   * @param request - caps and screenshot destination.
   * @param signal - caller cancellation.
   * @returns the canonical snapshot value.
   */
  async snapshot(request: SnapshotRequest, signal: AbortSignal): Promise<SnapshotValue> {
    const tab = this.tab
    if (tab === undefined) throw new Error('browser: no open page; call browser_navigate first')
    throwIfBrowserAborted(signal)
    const raw = await raceAbort(signal, tab.ariaSnapshot())
    const bounded = boundSnapshot(raw, request.maxChars)
    if (!request.screenshot) {
      return { url: tab.url(), title: await raceAbort(signal, tab.title()), ...bounded }
    }
    const png = await raceAbort(signal, tab.screenshot({ type: 'png', fullPage: true }))
    if (png.byteLength > request.screenshotMaxBytes) {
      throw new Error(`browser: screenshot is ${png.byteLength} bytes, above the ${request.screenshotMaxBytes}-byte bound`)
    }
    const screenshotPath = await writeScreenshot(request.screenshotDir, png)
    return {
      url: tab.url(),
      title: await raceAbort(signal, tab.title()),
      ...bounded,
      screenshotPath,
    }
  }

  /**
   * Close the engine if it was launched. Further calls fail.
   */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const process = this.process
    this.process = undefined
    this.tab = undefined
    if (process !== undefined) await process.close()
  }

  /**
   * Launch the engine on first use and refuse work after dispose.
   * @param signal - caller cancellation.
   * @returns the shared tab.
   */
  private async ensureTab(signal: AbortSignal): Promise<BrowserTab> {
    throwIfBrowserAborted(signal)
    if (this.closed) throw new Error('browser: session has been disposed')
    if (this.tab !== undefined) return this.tab
    const process = await this.launch()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/abort can race the awaited launch.
    if (this.closed || signal.aborted) {
      await process.close()
      throwIfBrowserAborted(signal)
      throw new Error('browser: session has been disposed')
    }
    const tab = await process.newTab()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/abort can race the awaited newTab.
    if (this.closed || signal.aborted) {
      await process.close()
      throwIfBrowserAborted(signal)
      throw new Error('browser: session has been disposed')
    }
    this.process = process
    this.tab = tab
    return tab
  }
}

/**
 * Write a PNG under an owner-only directory with an exclusive create.
 * @param directory - destination directory, created at mode 0700 when missing.
 * @param png - PNG bytes.
 * @returns the written absolute path.
 */
export async function writeScreenshot(directory: string, png: Buffer): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${randomBytes(16).toString('hex')}.png`)
  await writeFile(path, png, { flag: 'wx', mode: 0o600 })
  return path
}
