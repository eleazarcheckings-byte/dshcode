import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  boundSnapshot,
  BrowserSession,
  raceAbort,
  SNAPSHOT_TRUNCATION_FOOTER,
  writeScreenshot,
} from '../src/session.ts'
import type { BrowserProcess, BrowserTab } from '../src/session.ts'

class FakeTab implements BrowserTab {
  href = 'about:blank'
  documentTitle = ''
  tree = '- heading "Hi" [level=1]'
  png = Buffer.from('png-bytes')
  gotoCalls: string[] = []
  delayGoto: Promise<void> | undefined

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
}

class FakeProcess implements BrowserProcess {
  readonly tab = new FakeTab()
  closeCount = 0
  delayNewTab: Promise<void> | undefined
  tabOpening = false

  async newTab(): Promise<BrowserTab> {
    this.tabOpening = true
    if (this.delayNewTab !== undefined) await this.delayNewTab
    return this.tab
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
