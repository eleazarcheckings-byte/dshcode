/**
 * One shared browser session for verify tools: a managed set of tabs over one
 * Chromium process. Launch is deferred until the first navigation or the first
 * `browser_tabs` "new" call so schema harvest and plugin load do not start
 * Chromium. Every read this module returns (page text, console text, network
 * URLs) is untrusted page content — the caller must never treat it as an
 * instruction, only as data to inspect.
 * @module @deepseek-ai/dsh-tool-browser/session
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Footer appended when an accessibility tree is cut to {@link SnapshotRequest.maxChars}. */
export const SNAPSHOT_TRUNCATION_FOOTER = '\n(Snapshot truncated.)'
/** Footer appended when captured page text is cut to a caller's `maxChars`. */
export const PAGE_TEXT_TRUNCATION_FOOTER = '\n(Text truncated.)'

/** One captured `console.*` call, in the order the page produced it. */
export interface ConsoleMessageRecord {
  /** Playwright console message type (`log`, `error`, `warning`, …). */
  type: string
  /** The message text. */
  text: string
  /** `Date.now()` at capture time. */
  time: number
}

/** One captured outgoing request, in the order the tab issued it. */
export interface NetworkRequestRecord {
  /** HTTP method. */
  method: string
  /** Absolute request URL. */
  url: string
  /** Playwright resource type (`document`, `xhr`, `fetch`, `script`, …). */
  resourceType: string
  /** Response status, once the response arrives; absent for a request still in flight or one that failed. */
  status?: number
  /** `Date.now()` at request-issued time. */
  time: number
}

/** One tab's identity for `browser_tabs list`. */
export interface TabInfo {
  /** Session-scoped id, stable for the tab's lifetime (`tab-1`, `tab-2`, …). */
  id: string
  /** Current URL. */
  url: string
  /** Current document title. */
  title: string
  /** Whether this is the tab every other tool call operates on. */
  active: boolean
}

/**
 * One element or coordinate-free target: a stable accessibility-tree `ref`
 * from the most recent snapshot, or a raw selector understood by the
 * underlying engine. Exactly one must be set.
 */
export interface ElementTarget {
  ref?: string | undefined
  selector?: string | undefined
}

/** One resolved locator's action surface, addressed by a single selector string. */
export interface TabLocator {
  click(timeoutMs: number): Promise<void>
  fill(value: string, timeoutMs: number): Promise<void>
  pressSequentially(text: string, timeoutMs: number): Promise<void>
  press(key: string, timeoutMs: number): Promise<void>
  hover(timeoutMs: number): Promise<void>
  scrollIntoView(timeoutMs: number): Promise<void>
}

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
  /** Playwright ARIA snapshot of the root document, including stable `[ref=eN]` handles. */
  ariaSnapshot(): Promise<string>
  /**
   * Encode the current page as a PNG.
   * @param options - PNG encoding options.
   */
  screenshot(options: { type: 'png'; fullPage: boolean }): Promise<Buffer>
  /**
   * Resolve one selector string (a raw selector, or `aria-ref=<ref>`) to an
   * action surface. Resolution itself is lazy; failures surface on the call.
   * @param selector - the selector to resolve.
   */
  locator(selector: string): TabLocator
  /**
   * Press one key at the page level (no target element).
   * @param key - a Playwright key name (`Enter`, `Tab`, `ArrowDown`, …).
   * @param timeoutMs - cooperative timeout budget.
   */
  keyboardPress(key: string, timeoutMs: number): Promise<void>
  /**
   * Scroll the viewport by one directional step.
   * @param direction - the axis and sign to scroll.
   * @param amount - pixels to scroll.
   */
  scrollViewport(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>
  /** The rendered document's visible text (`body.innerText`). */
  innerText(): Promise<string>
  /** Console messages captured since the tab opened, oldest first, capped at the deployment's configured limit. */
  consoleMessages(): readonly ConsoleMessageRecord[]
  /** Outgoing requests captured since the tab opened, oldest first, capped at the deployment's configured limit. */
  networkRequests(): readonly NetworkRequestRecord[]
  /** Close this tab. */
  close(): Promise<void>
}

/** The process that owns tabs; closing it tears the engine down. */
export interface BrowserProcess {
  /** Open one new tab. */
  newTab(): Promise<BrowserTab>
  /** Shut the engine down. */
  close(): Promise<void>
}

/** Launch Chromium (or a test double) when the first tab needs one. */
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

/** Canonical screenshot-only value returned to the tool registry. */
export interface ScreenshotValue {
  url: string
  title: string
  screenshotPath: string
  mediaType: 'image/png'
  bytes: number
  png: Buffer
}

/** Canonical page-text value returned to the tool registry. */
export interface PageTextValue {
  url: string
  title: string
  text: string
  truncated: boolean
}

/** Canonical console-read value returned to the tool registry. */
export interface ConsoleValue {
  url: string
  messages: ConsoleMessageRecord[]
}

/** Canonical network-read value returned to the tool registry. */
export interface NetworkValue {
  url: string
  requests: NetworkRequestRecord[]
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
 * Bound a string and record whether the footer was applied.
 * @param value - the raw string.
 * @param maxChars - inclusive cap on the returned string.
 * @param footer - truncation footer to append when cut.
 * @returns the possibly truncated string and a truncation flag.
 */
function boundText(value: string, maxChars: number, footer: string): { value: string; truncated: boolean } {
  if (value.length <= maxChars) return { value, truncated: false }
  if (maxChars <= footer.length) {
    return { value: value.slice(0, maxChars), truncated: true }
  }
  return {
    value: `${value.slice(0, maxChars - footer.length)}${footer}`,
    truncated: true,
  }
}

/**
 * Bound an accessibility tree and record whether the footer was applied.
 * @param snapshot - the raw ARIA tree.
 * @param maxChars - inclusive cap on the returned string.
 * @returns the possibly truncated tree and a truncation flag.
 */
export function boundSnapshot(snapshot: string, maxChars: number): { snapshot: string; truncated: boolean } {
  const bounded = boundText(snapshot, maxChars, SNAPSHOT_TRUNCATION_FOOTER)
  return { snapshot: bounded.value, truncated: bounded.truncated }
}

/**
 * Bound captured page text and record whether the footer was applied.
 * @param text - the raw `body.innerText`.
 * @param maxChars - inclusive cap on the returned string.
 * @returns the possibly truncated text and a truncation flag.
 */
export function boundPageText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const bounded = boundText(text, maxChars, PAGE_TEXT_TRUNCATION_FOOTER)
  return { text: bounded.value, truncated: bounded.truncated }
}

/**
 * Resolve one {@link ElementTarget} into the selector string tools pass to
 * {@link BrowserTab.locator}. A `ref` resolves through the `aria-ref=` engine
 * against the most recent accessibility snapshot; a `selector` passes through
 * unchanged. Exactly one of the two must be a non-empty string.
 * @param target - the caller-supplied ref/selector pair.
 * @returns the selector string to resolve.
 * @throws when neither or both are set.
 */
export function resolveElementSelector(target: ElementTarget): string {
  const ref = target.ref?.trim()
  const selector = target.selector?.trim()
  const hasRef = ref !== undefined && ref.length > 0
  const hasSelector = selector !== undefined && selector.length > 0
  if (hasRef && hasSelector) throw new Error('browser: pass only one of ref or selector, not both')
  if (hasRef) return `aria-ref=${ref}`
  if (hasSelector) return selector
  throw new Error('browser: ref or selector is required')
}

/** One managed tab: its session-scoped id and the underlying handle. */
interface ManagedTab {
  id: string
  tab: BrowserTab
}

/**
 * Shared Chromium session: one engine, a set of tabs, closed with the plugin
 * fiber. Every tool operates on the active tab unless it targets a specific
 * tab id through `browser_tabs`.
 */
export class BrowserSession {
  private process: BrowserProcess | undefined
  private tabs: ManagedTab[] = []
  private activeId: string | undefined
  private closed = false
  private nextTabSeq = 1

  /**
   * @param launch - starts Chromium on first use.
   */
  constructor(private readonly launch: BrowserLauncher) {}

  /**
   * Open `url` in the active tab, launching Chromium and the first tab on the
   * first call.
   * @param url - canonical http(s) href.
   * @param timeoutMs - navigation timeout forwarded to Playwright.
   * @param signal - caller cancellation.
   * @returns the post-redirect URL and document title.
   */
  async navigate(url: string, timeoutMs: number, signal: AbortSignal): Promise<{ url: string; title: string }> {
    const tab = await this.ensureActiveTab(signal)
    await raceAbort(signal, tab.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }))
    return { url: tab.url(), title: await raceAbort(signal, tab.title()) }
  }

  /**
   * Read the active tab's URL and title, typically after an interaction tool
   * changed the page (a click that navigated, a submit).
   * @param signal - caller cancellation.
   * @returns the active tab's current URL and title.
   */
  async activeTabState(signal: AbortSignal): Promise<{ url: string; title: string }> {
    const tab = this.requireActiveTab()
    throwIfBrowserAborted(signal)
    return { url: tab.url(), title: await raceAbort(signal, tab.title()) }
  }

  /**
   * Capture the active tab's accessibility tree, and optionally a PNG.
   * @param request - caps and screenshot destination.
   * @param signal - caller cancellation.
   * @returns the canonical snapshot value.
   */
  async snapshot(request: SnapshotRequest, signal: AbortSignal): Promise<SnapshotValue> {
    const tab = this.requireActiveTab()
    throwIfBrowserAborted(signal)
    const raw = await raceAbort(signal, tab.ariaSnapshot())
    const bounded = boundSnapshot(raw, request.maxChars)
    if (!request.screenshot) {
      return { url: tab.url(), title: await raceAbort(signal, tab.title()), ...bounded }
    }
    const png = await this.capturePng(tab, request.screenshotMaxBytes, signal)
    const screenshotPath = await writeScreenshot(request.screenshotDir, png)
    return {
      url: tab.url(),
      title: await raceAbort(signal, tab.title()),
      ...bounded,
      screenshotPath,
    }
  }

  /**
   * Capture the active tab as a PNG only, without the accessibility tree.
   * @param request - byte cap and screenshot destination.
   * @param signal - caller cancellation.
   * @returns the canonical screenshot value, including the raw bytes for an
   *   in-band image content block.
   */
  async screenshotOnly(
    request: { screenshotMaxBytes: number; screenshotDir: string },
    signal: AbortSignal,
  ): Promise<ScreenshotValue> {
    const tab = this.requireActiveTab()
    throwIfBrowserAborted(signal)
    const png = await this.capturePng(tab, request.screenshotMaxBytes, signal)
    const screenshotPath = await writeScreenshot(request.screenshotDir, png)
    return {
      url: tab.url(),
      title: await raceAbort(signal, tab.title()),
      screenshotPath,
      mediaType: 'image/png',
      bytes: png.byteLength,
      png,
    }
  }

  /**
   * Click one element addressed by ref or selector.
   * @param target - the element to click.
   * @param timeoutMs - cooperative timeout budget.
   * @param signal - caller cancellation.
   */
  async click(target: ElementTarget, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const tab = this.requireActiveTab()
    const selector = resolveElementSelector(target)
    throwIfBrowserAborted(signal)
    await raceAbort(signal, tab.locator(selector).click(timeoutMs))
  }

  /**
   * Hover one element addressed by ref or selector.
   * @param target - the element to hover.
   * @param timeoutMs - cooperative timeout budget.
   * @param signal - caller cancellation.
   */
  async hover(target: ElementTarget, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const tab = this.requireActiveTab()
    const selector = resolveElementSelector(target)
    throwIfBrowserAborted(signal)
    await raceAbort(signal, tab.locator(selector).hover(timeoutMs))
  }

  /**
   * Set one element's value instantly (no per-key input events).
   * @param target - the element to fill.
   * @param value - the value to set.
   * @param timeoutMs - cooperative timeout budget.
   * @param signal - caller cancellation.
   */
  async fill(target: ElementTarget, value: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const tab = this.requireActiveTab()
    const selector = resolveElementSelector(target)
    throwIfBrowserAborted(signal)
    await raceAbort(signal, tab.locator(selector).fill(value, timeoutMs))
  }

  /**
   * Type text into one element key by key, then optionally submit with Enter.
   * @param target - the element to type into.
   * @param text - the text to type.
   * @param submit - when true, press Enter on the same element after typing.
   * @param timeoutMs - cooperative timeout budget, applied per step.
   * @param signal - caller cancellation.
   */
  async type(
    target: ElementTarget,
    text: string,
    submit: boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const tab = this.requireActiveTab()
    const selector = resolveElementSelector(target)
    throwIfBrowserAborted(signal)
    const locator = tab.locator(selector)
    await raceAbort(signal, locator.pressSequentially(text, timeoutMs))
    if (submit) await raceAbort(signal, locator.press('Enter', timeoutMs))
  }

  /**
   * Press one key, either on a target element or at the page level.
   * @param key - a Playwright key name.
   * @param target - the element to press on; omit both fields for a page-level press.
   * @param timeoutMs - cooperative timeout budget.
   * @param signal - caller cancellation.
   */
  async press(key: string, target: ElementTarget, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const tab = this.requireActiveTab()
    const hasTarget = (target.ref?.trim().length ?? 0) > 0 || (target.selector?.trim().length ?? 0) > 0
    throwIfBrowserAborted(signal)
    if (!hasTarget) {
      await raceAbort(signal, tab.keyboardPress(key, timeoutMs))
      return
    }
    const selector = resolveElementSelector(target)
    await raceAbort(signal, tab.locator(selector).press(key, timeoutMs))
  }

  /**
   * Scroll the active tab: an element into view when a ref/selector is given,
   * otherwise the viewport by one directional step.
   * @param request - the target or direction/amount to scroll.
   * @param timeoutMs - cooperative timeout budget.
   * @param signal - caller cancellation.
   */
  async scroll(
    request: ElementTarget & { direction?: 'up' | 'down' | 'left' | 'right' | undefined; amount: number },
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const tab = this.requireActiveTab()
    const hasTarget = (request.ref?.trim().length ?? 0) > 0 || (request.selector?.trim().length ?? 0) > 0
    throwIfBrowserAborted(signal)
    if (hasTarget) {
      const selector = resolveElementSelector(request)
      await raceAbort(signal, tab.locator(selector).scrollIntoView(timeoutMs))
      return
    }
    if (request.direction === undefined) {
      throw new Error('browser: scroll requires a ref, a selector, or a direction')
    }
    await raceAbort(signal, tab.scrollViewport(request.direction, request.amount))
  }

  /**
   * Read the active tab's visible text.
   * @param maxChars - inclusive cap on the returned string.
   * @param signal - caller cancellation.
   * @returns the canonical page-text value.
   */
  async pageText(maxChars: number, signal: AbortSignal): Promise<PageTextValue> {
    const tab = this.requireActiveTab()
    throwIfBrowserAborted(signal)
    const raw = await raceAbort(signal, tab.innerText())
    const bounded = boundPageText(raw, maxChars)
    return {
      url: tab.url(),
      title: await raceAbort(signal, tab.title()),
      ...bounded,
    }
  }

  /**
   * Read console messages captured on the active tab.
   * @param limit - maximum number of messages to return (most recent first is
   *   NOT applied here — callers get the oldest-first tail of at most `limit`).
   * @param onlyErrors - when true, keep only `error`-type messages.
   * @returns the canonical console value.
   */
  consoleMessages(limit: number, onlyErrors: boolean): ConsoleValue {
    const tab = this.requireActiveTab()
    const all = tab.consoleMessages()
    const filtered = onlyErrors ? all.filter(message => message.type === 'error') : all
    return { url: tab.url(), messages: filtered.slice(-limit) }
  }

  /**
   * Read network requests captured on the active tab.
   * @param limit - maximum number of requests to return.
   * @param urlPattern - when set, keep only requests whose URL contains this substring.
   * @returns the canonical network value.
   */
  networkRequests(limit: number, urlPattern: string | undefined): NetworkValue {
    const tab = this.requireActiveTab()
    const all = tab.networkRequests()
    const filtered = urlPattern === undefined ? all : all.filter(request => request.url.includes(urlPattern))
    return { url: tab.url(), requests: filtered.slice(-limit) }
  }

  /**
   * List every open tab with the active one flagged.
   * @param signal - caller cancellation.
   * @returns tab identities in creation order.
   */
  async listTabs(signal: AbortSignal): Promise<TabInfo[]> {
    throwIfBrowserAborted(signal)
    const infos: TabInfo[] = []
    for (const managed of this.tabs) {
      infos.push({
        id: managed.id,
        url: managed.tab.url(),
        title: await raceAbort(signal, managed.tab.title()),
        active: managed.id === this.activeId,
      })
    }
    return infos
  }

  /**
   * Open a new tab, optionally navigating it, and make it active.
   * @param url - when set, navigate the new tab before returning.
   * @param timeoutMs - navigation timeout, used only when `url` is set.
   * @param signal - caller cancellation.
   * @returns the new tab's identity.
   */
  async newTab(url: string | undefined, timeoutMs: number, signal: AbortSignal): Promise<TabInfo> {
    const { id, tab } = await this.launchAndOpenTab(signal)
    if (url !== undefined) {
      await raceAbort(signal, tab.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }))
    }
    return { id, url: tab.url(), title: await raceAbort(signal, tab.title()), active: true }
  }

  /**
   * Make one existing tab active.
   * @param id - the tab id from `browser_tabs list`.
   * @throws when no tab with that id is open.
   */
  selectTab(id: string): void {
    if (!this.tabs.some(managed => managed.id === id)) {
      throw new Error(`browser: no open tab with id "${id}"`)
    }
    this.activeId = id
  }

  /**
   * Close one tab. When it was active, the next remaining tab (in open
   * order) becomes active, or no tab is active when it was the last one.
   * @param id - the tab id to close.
   * @throws when no tab with that id is open.
   */
  async closeTab(id: string): Promise<void> {
    const index = this.tabs.findIndex(managed => managed.id === id)
    if (index === -1) throw new Error(`browser: no open tab with id "${id}"`)
    const removed = this.tabs[index]
    if (removed === undefined) throw new Error(`browser: no open tab with id "${id}"`)
    this.tabs.splice(index, 1)
    await removed.tab.close()
    if (this.activeId === id) {
      this.activeId = this.tabs[0]?.id
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
    this.tabs = []
    this.activeId = undefined
    if (process !== undefined) await process.close()
  }

  /**
   * Capture a PNG within the configured byte bound.
   * @param tab - the tab to capture.
   * @param maxBytes - inclusive byte bound.
   * @param signal - caller cancellation.
   * @returns the PNG bytes.
   */
  private async capturePng(tab: BrowserTab, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
    const png = await raceAbort(signal, tab.screenshot({ type: 'png', fullPage: true }))
    if (png.byteLength > maxBytes) {
      throw new Error(`browser: screenshot is ${png.byteLength} bytes, above the ${maxBytes}-byte bound`)
    }
    return png
  }

  /**
   * Return the active tab, or throw the standard not-open-yet error.
   */
  private requireActiveTab(): BrowserTab {
    const managed = this.tabs.find(candidate => candidate.id === this.activeId)
    if (managed === undefined) throw new Error('browser: no open page; call browser_navigate first')
    return managed.tab
  }

  /**
   * Launch the engine and its first tab on first use and refuse work after
   * dispose. Later calls reuse the active tab.
   * @param signal - caller cancellation.
   * @returns the active tab.
   */
  private async ensureActiveTab(signal: AbortSignal): Promise<BrowserTab> {
    throwIfBrowserAborted(signal)
    if (this.closed) throw new Error('browser: session has been disposed')
    const existing = this.tabs.find(candidate => candidate.id === this.activeId)
    if (existing !== undefined) return existing.tab
    const { tab } = await this.launchAndOpenTab(signal)
    return tab
  }

  /**
   * Launch the engine when it is not already running, then open one new tab
   * and make it active. Nothing durable is recorded until a step succeeds, so
   * a concurrent {@link dispose} or abort during either await is responsible
   * for closing exactly the resource it raced, exactly once: `this.process`
   * is set only once the launch itself is committed (so a dispose racing the
   * launch finds nothing to close, and this function closes what it just
   * launched instead), while a dispose racing the OPEN of this tab has
   * already closed the whole (now-visible) process itself, so this function
   * must not close it a second time.
   * @param signal - caller cancellation.
   * @returns the newly active tab's id and handle.
   */
  private async launchAndOpenTab(signal: AbortSignal): Promise<{ id: string; tab: BrowserTab }> {
    throwIfBrowserAborted(signal)
    if (this.closed) throw new Error('browser: session has been disposed')
    let process = this.process
    if (process === undefined) {
      const launched = await this.launch()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/abort can race the awaited launch.
      if (this.closed || signal.aborted) {
        await launched.close()
        throwIfBrowserAborted(signal)
        throw new Error('browser: session has been disposed')
      }
      this.process = launched
      process = launched
    }
    // Not raced against `signal`: a caller-visible cancellation here must
    // still wait for the real tab handle so it, and only it, can be closed.
    const tab = await process.newTab()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/abort can race the awaited newTab.
    if (this.closed || signal.aborted) {
      // `dispose()` already closed the process (and therefore every tab on
      // it) when it observed `this.process` set; closing it again here would
      // double-close. Only close it ourselves when dispose has not run.
      if (!this.closed) await process.close()
      throwIfBrowserAborted(signal)
      throw new Error('browser: session has been disposed')
    }
    const id = `tab-${this.nextTabSeq}`
    this.nextTabSeq += 1
    this.tabs.push({ id, tab })
    this.activeId = id
    return { id, tab }
  }
}

/**
 * Write a PNG under an owner-only-on-POSIX directory with an exclusive
 * create. On Windows, `mkdir`/`writeFile` modes are best-effort — Windows has
 * no POSIX owner-only bit, so the directory is protected by ACL inheritance
 * from its parent (typically the user's own temp directory), not by mode 0700.
 * @param directory - destination directory, created when missing.
 * @param png - PNG bytes.
 * @returns the written absolute path.
 */
export async function writeScreenshot(directory: string, png: Buffer): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${randomBytes(16).toString('hex')}.png`)
  await writeFile(path, png, { flag: 'wx', mode: 0o600 })
  return path
}
