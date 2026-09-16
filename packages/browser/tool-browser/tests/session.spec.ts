import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  boundPageText,
  boundSnapshot,
  BrowserSession,
  PAGE_TEXT_TRUNCATION_FOOTER,
  raceAbort,
  resolveElementSelector,
  SNAPSHOT_TRUNCATION_FOOTER,
  writeScreenshot,
} from '../src/session.ts'
import type { BrowserProcess, BrowserTab, ConsoleMessageRecord, NetworkRequestRecord, TabLocator } from '../src/session.ts'

class FakeTab implements BrowserTab {
  href = 'about:blank'
  documentTitle = ''
  tree = '- heading "Hi" [level=1]'
  png = Buffer.from('png-bytes')
  text = 'body text'
  gotoCalls: string[] = []
  delayGoto: Promise<void> | undefined
  locatorCalls: string[] = []
  actionCalls: string[] = []
  keyboardPressCalls: string[] = []
  scrollCalls: Array<{ direction: 'up' | 'down' | 'left' | 'right'; amount: number }> = []
  console_: ConsoleMessageRecord[] = []
  network: NetworkRequestRecord[] = []
  closeCount = 0

  async goto(url: string, _options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<void> {
    this.gotoCalls.push(url)
    if (this.delayGoto !== undefined) await this.delayGoto
    this.href = url
    this.documentTitle = 'Example Domain'
  }

  url(): string {
    return this.href
  }

  title(): Promise<string> {
    return Promise.resolve(this.documentTitle)
  }

  ariaSnapshot(): Promise<string> {
    return Promise.resolve(this.tree)
  }

  screenshot(): Promise<Buffer> {
    return Promise.resolve(this.png)
  }

  locator(selector: string): TabLocator {
    this.locatorCalls.push(selector)
    return {
      click: async (timeoutMs) => {
        this.actionCalls.push(`click:${selector}:${timeoutMs}`)
      },
      fill: async (value, timeoutMs) => {
        this.actionCalls.push(`fill:${selector}:${value}:${timeoutMs}`)
      },
      pressSequentially: async (text, timeoutMs) => {
        this.actionCalls.push(`type:${selector}:${text}:${timeoutMs}`)
      },
      press: async (key, timeoutMs) => {
        this.actionCalls.push(`press:${selector}:${key}:${timeoutMs}`)
      },
      hover: async (timeoutMs) => {
        this.actionCalls.push(`hover:${selector}:${timeoutMs}`)
      },
      scrollIntoView: async (timeoutMs) => {
        this.actionCalls.push(`scrollIntoView:${selector}:${timeoutMs}`)
      },
    }
  }

  async keyboardPress(key: string, _timeoutMs: number): Promise<void> {
    this.keyboardPressCalls.push(key)
  }

  async scrollViewport(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
    this.scrollCalls.push({ direction, amount })
  }

  innerText(): Promise<string> {
    return Promise.resolve(this.text)
  }

  consoleMessages(): readonly ConsoleMessageRecord[] {
    return this.console_
  }

  networkRequests(): readonly NetworkRequestRecord[] {
    return this.network
  }

  async close(): Promise<void> {
    this.closeCount += 1
  }
}

class FakeProcess implements BrowserProcess {
  /** The tab the first `newTab()` call returns, pre-created so a test can configure it (e.g. `delayGoto`) before triggering that call. */
  readonly tab = new FakeTab()
  /** Every tab beyond the first, in creation order — a real multi-tab session. */
  readonly extraTabs: FakeTab[] = []
  closeCount = 0
  delayNewTab: Promise<void> | undefined
  tabOpening = false
  private opened = 0

  async newTab(): Promise<BrowserTab> {
    this.tabOpening = true
    if (this.delayNewTab !== undefined) await this.delayNewTab
    if (this.opened === 0) {
      this.opened += 1
      return this.tab
    }
    const extra = new FakeTab()
    this.extraTabs.push(extra)
    this.opened += 1
    return extra
  }

  close(): Promise<void> {
    this.closeCount += 1
    return Promise.resolve()
  }
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(task => task()))
})

describe('boundSnapshot', () => {
  it('returns the tree unchanged when it fits', () => {
    expect(boundSnapshot('abc', 10)).toEqual({ snapshot: 'abc', truncated: false })
  })

  it('appends the truncation footer when the tree exceeds the cap', () => {
    const cap = SNAPSHOT_TRUNCATION_FOOTER.length + 2
    expect(boundSnapshot('a'.repeat(cap + 4), cap)).toEqual({
      snapshot: `aa${SNAPSHOT_TRUNCATION_FOOTER}`,
      truncated: true,
    })
  })

  it('slices without the footer when the cap is smaller than the footer', () => {
    expect(boundSnapshot('abcdef', 3)).toEqual({ snapshot: 'abc', truncated: true })
  })
})

describe('writeScreenshot', () => {
  it('creates an exclusive PNG under the destination directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-browser-shot-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const path = await writeScreenshot(dir, Buffer.from('png'))
    expect(await readFile(path)).toEqual(Buffer.from('png'))
  })
})

describe('raceAbort', () => {
  it('rejects with the abort Error when the signal fires first', async () => {
    const abort = new AbortController()
    let release: () => void = () => {}
    const pending = new Promise<string>((resolve) => {
      release = () => {
        resolve('late')
      }
    })
    const raced = raceAbort(abort.signal, pending)
    abort.abort(new Error('stop'))
    await expect(raced).rejects.toThrow('stop')
    release()
  })

  it('wraps a non-Error abort reason', async () => {
    const abort = new AbortController()
    const pending = new Promise<string>(() => {})
    const raced = raceAbort(abort.signal, pending)
    abort.abort('nope')
    await expect(raced).rejects.toThrow('browser: aborted')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const abort = new AbortController()
    abort.abort(new Error('already'))
    await expect(raceAbort(abort.signal, Promise.resolve('ok'))).rejects.toThrow('already')
  })
})

describe('BrowserSession', () => {
  const signal = new AbortController().signal

  it('navigates the shared tab and snapshots its accessibility tree', async () => {
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await expect(session.snapshot({
      screenshot: false,
      maxChars: 100,
      screenshotMaxBytes: 100,
      screenshotDir: tmpdir(),
    }, signal)).rejects.toThrow('browser: no open page; call browser_navigate first')

    expect(await session.navigate('http://127.0.0.1:1/', 1_000, signal)).toEqual({
      url: 'http://127.0.0.1:1/',
      title: 'Example Domain',
    })
    expect(process.tab.gotoCalls).toEqual(['http://127.0.0.1:1/'])
    expect(await session.snapshot({
      screenshot: false,
      maxChars: 100,
      screenshotMaxBytes: 100,
      screenshotDir: tmpdir(),
    }, signal)).toEqual({
      url: 'http://127.0.0.1:1/',
      title: 'Example Domain',
      snapshot: '- heading "Hi" [level=1]',
      truncated: false,
    })
    expect(await session.navigate('http://127.0.0.1:2/', 1_000, signal)).toEqual({
      url: 'http://127.0.0.1:2/',
      title: 'Example Domain',
    })
    expect(process.tab.gotoCalls).toEqual(['http://127.0.0.1:1/', 'http://127.0.0.1:2/'])
    expect(process.closeCount).toBe(0)
  })

  it('writes a PNG when screenshot is requested and rejects an oversized PNG', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-browser-session-shot-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.navigate('http://127.0.0.1:1/', 1_000, signal)
    const value = await session.snapshot({
      screenshot: true,
      maxChars: 100,
      screenshotMaxBytes: 100,
      screenshotDir: dir,
    }, signal)
    expect(value.screenshotPath).toBeDefined()
    expect(await readFile(value.screenshotPath!)).toEqual(Buffer.from('png-bytes'))

    process.tab.png = Buffer.alloc(8)
    await expect(session.snapshot({
      screenshot: true,
      maxChars: 100,
      screenshotMaxBytes: 4,
      screenshotDir: dir,
    }, signal)).rejects.toThrow('browser: screenshot is 8 bytes, above the 4-byte bound')
  })

  it('closes a launch that settles after dispose', async () => {
    const process = new FakeProcess()
    let finishLaunch: (value: FakeProcess) => void = () => {}
    const session = new BrowserSession(() => new Promise((resolve) => {
      finishLaunch = resolve
    }))
    const navigating = session.navigate('http://127.0.0.1:1/', 1_000, signal)
    await session.dispose()
    finishLaunch(process)
    await expect(navigating).rejects.toThrow('browser: session has been disposed')
    expect(process.closeCount).toBe(1)
    await expect(session.navigate('http://127.0.0.1:1/', 1_000, signal)).rejects.toThrow(
      'browser: session has been disposed',
    )
    await session.dispose()
    expect(process.closeCount).toBe(1)
  })

  it('closes a process whose tab is still opening when dispose wins', async () => {
    const process = new FakeProcess()
    let finishTab: () => void = () => {}
    process.delayNewTab = new Promise((resolve) => {
      finishTab = () => {
        resolve()
      }
    })
    const session = new BrowserSession(() => Promise.resolve(process))
    const navigating = session.navigate('http://127.0.0.1:1/', 1_000, signal)
    const started = Date.now()
    while (!process.tabOpening) {
      if (Date.now() - started > 1_000) throw new Error('newTab never started')
      await Promise.resolve()
    }
    await session.dispose()
    finishTab()
    await expect(navigating).rejects.toThrow('browser: session has been disposed')
    expect(process.closeCount).toBe(1)
  })

  it('closes a launch that settles after the caller aborts', async () => {
    const process = new FakeProcess()
    let finishLaunch: (value: FakeProcess) => void = () => {}
    const abort = new AbortController()
    const session = new BrowserSession(() => new Promise((resolve) => {
      finishLaunch = resolve
    }))
    const navigating = session.navigate('http://127.0.0.1:1/', 1_000, abort.signal)
    abort.abort(new Error('cancel'))
    finishLaunch(process)
    await expect(navigating).rejects.toThrow('cancel')
    expect(process.closeCount).toBe(1)
  })

  it('closes a process whose tab is still opening when the caller aborts', async () => {
    const process = new FakeProcess()
    let finishTab: () => void = () => {}
    process.delayNewTab = new Promise((resolve) => {
      finishTab = () => {
        resolve()
      }
    })
    const abort = new AbortController()
    const session = new BrowserSession(() => Promise.resolve(process))
    const navigating = session.navigate('http://127.0.0.1:1/', 1_000, abort.signal)
    const started = Date.now()
    while (!process.tabOpening) {
      if (Date.now() - started > 1_000) throw new Error('newTab never started')
      await Promise.resolve()
    }
    abort.abort(new Error('cancel'))
    finishTab()
    await expect(navigating).rejects.toThrow('cancel')
    expect(process.closeCount).toBe(1)
  })

  it('rejects a hung navigation when the caller aborts', async () => {
    const process = new FakeProcess()
    let resumeGoto: () => void = () => {}
    process.tab.delayGoto = new Promise((resolve) => {
      resumeGoto = () => {
        resolve()
      }
    })
    const abort = new AbortController()
    const session = new BrowserSession(() => Promise.resolve(process))
    const navigating = session.navigate('http://127.0.0.1:1/', 1_000, abort.signal)
    const started = Date.now()
    while (process.tab.gotoCalls.length === 0) {
      if (Date.now() - started > 1_000) throw new Error('goto never started')
      await Promise.resolve()
    }
    abort.abort('nope')
    await expect(navigating).rejects.toThrow('browser: aborted')
    resumeGoto()
  })

  it('propagates a tab failure from goto', async () => {
    const process = new FakeProcess()
    process.tab.delayGoto = Promise.reject(new Error('net'))
    const session = new BrowserSession(() => Promise.resolve(process))
    await expect(session.navigate('http://127.0.0.1:1/', 1_000, signal)).rejects.toThrow('net')
  })

  it('wraps a non-Error tab failure from goto', async () => {
    const process = new FakeProcess()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- covers raceAbort wrapping a non-Error rejection.
    process.tab.delayGoto = Promise.reject('net')
    const session = new BrowserSession(() => Promise.resolve(process))
    await expect(session.navigate('http://127.0.0.1:1/', 1_000, signal)).rejects.toThrow('net')
  })

  it('dispose without a launch is a no-op', async () => {
    const session = new BrowserSession(() => Promise.reject(new Error('should not launch')))
    await session.dispose()
    await expect(session.navigate('http://127.0.0.1:1/', 1_000, signal)).rejects.toThrow(
      'browser: session has been disposed',
    )
  })
})

describe('resolveElementSelector', () => {
  it('resolves a ref through the aria-ref engine and passes a selector through unchanged', () => {
    expect(resolveElementSelector({ ref: 'e3' })).toBe('aria-ref=e3')
    expect(resolveElementSelector({ selector: '#submit' })).toBe('#submit')
  })

  it('rejects neither or both being set, and trims whitespace-only values as unset', () => {
    expect(() => resolveElementSelector({})).toThrow('browser: ref or selector is required')
    expect(() => resolveElementSelector({ ref: '  ' })).toThrow('browser: ref or selector is required')
    expect(() => resolveElementSelector({ ref: 'e3', selector: '#submit' })).toThrow(
      'browser: pass only one of ref or selector, not both',
    )
  })
})

describe('boundPageText', () => {
  it('returns text unchanged when it fits, and appends the footer when it does not', () => {
    expect(boundPageText('abc', 10)).toEqual({ text: 'abc', truncated: false })
    const cap = PAGE_TEXT_TRUNCATION_FOOTER.length + 2
    expect(boundPageText('a'.repeat(cap + 4), cap)).toEqual({
      text: `aa${PAGE_TEXT_TRUNCATION_FOOTER}`,
      truncated: true,
    })
  })
})

describe('BrowserSession interaction tools', () => {
  const signal = new AbortController().signal

  it('clicks, hovers, fills, types, and presses through a ref, resolving to aria-ref=', async () => {
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.navigate('http://127.0.0.1:1/', 1_000, signal)

    await session.click({ ref: 'e3' }, 500, signal)
    await session.hover({ ref: 'e4' }, 500, signal)
    await session.fill({ ref: 'e5' }, 'hello', 500, signal)
    await session.type({ ref: 'e5' }, 'hi', false, 500, signal)
    await session.type({ ref: 'e5' }, 'hi', true, 500, signal)
    await session.press('Enter', { selector: '#q' }, 500, signal)
    await session.press('Tab', {}, 500, signal)

    expect(process.tab.actionCalls).toEqual([
      'click:aria-ref=e3:500',
      'hover:aria-ref=e4:500',
      'fill:aria-ref=e5:hello:500',
      'type:aria-ref=e5:hi:500',
      'type:aria-ref=e5:hi:500',
      'press:aria-ref=e5:Enter:500',
      'press:#q:Enter:500',
    ])
    expect(process.tab.keyboardPressCalls).toEqual(['Tab'])
  })

  it('scrolls an element into view when targeted, otherwise the viewport by direction', async () => {
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.navigate('http://127.0.0.1:1/', 1_000, signal)

    await session.scroll({ ref: 'e3', amount: 800 }, 500, signal)
    await session.scroll({ direction: 'down', amount: 400 }, 500, signal)
    expect(process.tab.actionCalls).toEqual(['scrollIntoView:aria-ref=e3:500'])
    expect(process.tab.scrollCalls).toEqual([{ direction: 'down', amount: 400 }])

    await expect(session.scroll({ amount: 400 }, 500, signal)).rejects.toThrow(
      'browser: scroll requires a ref, a selector, or a direction',
    )
  })

  it('reads page text, console messages, and network requests from the active tab', async () => {
    const process = new FakeProcess()
    process.tab.text = 'Hello world'
    process.tab.console_ = [
      { type: 'log', text: 'a', time: 1 },
      { type: 'error', text: 'b', time: 2 },
      { type: 'error', text: 'c', time: 3 },
    ]
    process.tab.network = [
      { method: 'GET', url: 'http://x/a', resourceType: 'document', time: 1 },
      { method: 'GET', url: 'http://x/b.json', resourceType: 'xhr', status: 200, time: 2 },
    ]
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.navigate('http://127.0.0.1:1/', 1_000, signal)

    expect(await session.pageText(100, signal)).toMatchObject({ text: 'Hello world', truncated: false })
    expect(session.consoleMessages(10, false).messages).toHaveLength(3)
    expect(session.consoleMessages(10, true).messages).toEqual([
      { type: 'error', text: 'b', time: 2 },
      { type: 'error', text: 'c', time: 3 },
    ])
    expect(session.consoleMessages(1, false).messages).toEqual([{ type: 'error', text: 'c', time: 3 }])
    expect(session.networkRequests(10, undefined).requests).toHaveLength(2)
    expect(session.networkRequests(10, '.json').requests).toEqual([
      { method: 'GET', url: 'http://x/b.json', resourceType: 'xhr', status: 200, time: 2 },
    ])
  })

  it('requires an active tab for every interaction and read', async () => {
    const session = new BrowserSession(() => Promise.reject(new Error('should not launch')))
    await expect(session.click({ ref: 'e3' }, 500, signal)).rejects.toThrow('browser: no open page; call browser_navigate first')
    await expect(session.pageText(100, signal)).rejects.toThrow('browser: no open page; call browser_navigate first')
    expect(() => session.consoleMessages(10, false)).toThrow('browser: no open page; call browser_navigate first')
    expect(() => session.networkRequests(10, undefined)).toThrow('browser: no open page; call browser_navigate first')
  })
})

describe('BrowserSession tabs', () => {
  const signal = new AbortController().signal

  it('lists, opens, selects, and closes tabs, tracking which one is active', async () => {
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))

    expect(await session.listTabs(signal)).toEqual([])

    const first = await session.newTab('http://127.0.0.1:1/', 1_000, signal)
    expect(first).toMatchObject({ id: 'tab-1', url: 'http://127.0.0.1:1/', active: true })

    const second = await session.newTab(undefined, 1_000, signal)
    expect(second).toMatchObject({ id: 'tab-2', active: true })

    const listed = await session.listTabs(signal)
    expect(listed).toHaveLength(2)
    expect(listed.find(tabInfo => tabInfo.id === 'tab-1')?.active).toBe(false)
    expect(listed.find(tabInfo => tabInfo.id === 'tab-2')?.active).toBe(true)

    session.selectTab('tab-1')
    expect((await session.listTabs(signal)).find(tabInfo => tabInfo.id === 'tab-1')?.active).toBe(true)

    expect(() => session.selectTab('tab-9')).toThrow('browser: no open tab with id "tab-9"')

    await session.closeTab('tab-2')
    const afterClose = await session.listTabs(signal)
    expect(afterClose).toHaveLength(1)
    expect(afterClose[0]).toMatchObject({ id: 'tab-1', active: true })
    expect(process.extraTabs[0]?.closeCount).toBe(1)

    await expect(session.closeTab('tab-9')).rejects.toThrow('browser: no open tab with id "tab-9"')
  })

  it('promotes the next tab to active when the active tab is closed', async () => {
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.newTab('http://127.0.0.1:1/', 1_000, signal)
    await session.newTab('http://127.0.0.1:2/', 1_000, signal)
    await session.closeTab('tab-2')
    const remaining = await session.listTabs(signal)
    expect(remaining).toEqual([{ id: 'tab-1', url: 'http://127.0.0.1:1/', title: 'Example Domain', active: true }])
  })
})

describe('BrowserSession screenshotOnly', () => {
  const signal = new AbortController().signal

  it('writes a PNG and returns its bytes without an accessibility tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-browser-session-shot-only-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const process = new FakeProcess()
    const session = new BrowserSession(() => Promise.resolve(process))
    await session.navigate('http://127.0.0.1:1/', 1_000, signal)
    const value = await session.screenshotOnly({ screenshotMaxBytes: 100, screenshotDir: dir }, signal)
    expect(value.mediaType).toBe('image/png')
    expect(value.bytes).toBe(Buffer.from('png-bytes').byteLength)
    expect(value.png).toEqual(Buffer.from('png-bytes'))
    expect(await readFile(value.screenshotPath)).toEqual(Buffer.from('png-bytes'))
  })
})
