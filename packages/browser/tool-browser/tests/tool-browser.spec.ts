import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const { launch, close, goto } = vi.hoisted(() => ({
  launch: vi.fn((_options?: unknown): Promise<unknown> => {
    return Promise.reject(new Error('playwright launch mock not configured'))
  }),
  close: vi.fn(async () => {}),
  goto: vi.fn(),
}))
let href = 'about:blank'
let title = 'Example Domain'
let tree = '- heading "Example Domain" [level=1]'
let png = Buffer.from('png-bytes')

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (options?: unknown): Promise<unknown> => launch(options),
  },
}))

function installBrowser(): void {
  goto.mockImplementation(async (url: string) => {
    href = url
  })
  launch.mockResolvedValue({
    newPage: async () => ({
      goto,
      url: () => href,
      title: async () => title,
      locator: () => ({ ariaSnapshot: async () => tree }),
      screenshot: async () => png,
    }),
    close,
  })
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  launch.mockReset()
  close.mockReset()
  goto.mockReset()
  goto.mockImplementation(async (url: string) => {
    href = url
  })
  href = 'about:blank'
  title = 'Example Domain'
  tree = '- heading "Example Domain" [level=1]'
  png = Buffer.from('png-bytes')
  await Promise.all(cleanup.splice(0).map(task => task()))
})

async function setup(over: Partial<tool.Config> = {}): Promise<{ ctx: Context; toolFiber: Awaited<ReturnType<Context['plugin']>> }> {
  installBrowser()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const toolFiber = await ctx.plugin(tool, over)
  cleanup.push(async () => {
    await ctx.fiber.dispose()
  })
  return { ctx, toolFiber }
}

function execute(ctx: Context, name: string, args: Record<string, unknown>, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId('browser-call'),
    name,
    arguments: args,
  })
}

describe('parseBrowserUrl', () => {
  it('accepts http(s) and rejects other forms', () => {
    expect(tool.parseBrowserUrl(' https://example.com/path ')).toBe('https://example.com/path')
    expect(tool.parseBrowserUrl('https://example.com')).toBe('https://example.com/')
    expect(tool.parseBrowserUrl('http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/')
    expect(() => tool.parseBrowserUrl('')).toThrow('browser: url must be a non-empty http(s) URL')
    expect(() => tool.parseBrowserUrl('example.com')).toThrow('browser: url is not a valid absolute URL')
    expect(() => tool.parseBrowserUrl('file:///tmp/x.html')).toThrow('browser: only http(s) URLs are supported (got file:)')
    expect(() => tool.parseBrowserUrl('ftp://example.com/')).toThrow('browser: only http(s) URLs are supported (got ftp:)')
    expect(() => tool.parseBrowserUrl('https://user:pass@example.com/')).toThrow(
      'browser: url must not include user credentials',
    )
  })
})

describe('resolveConfig', () => {
  it('applies defaults and rejects empty optional strings and non-positive caps', () => {
    expect(tool.resolveConfig({})).toMatchObject({
      headless: true,
      timeoutMs: tool.DEFAULT_TIMEOUT_MS,
      snapshotMaxChars: tool.DEFAULT_SNAPSHOT_MAX_CHARS,
      screenshotMaxBytes: tool.DEFAULT_SCREENSHOT_MAX_BYTES,
    })
    expect(tool.resolveConfig({
      headless: false,
      timeoutMs: 12,
      executablePath: '/opt/chrome',
      channel: 'msedge',
      snapshotMaxChars: 9,
      screenshotMaxBytes: 8,
      screenshotDir: '/tmp/shots',
    })).toEqual({
      headless: false,
      timeoutMs: 12,
      executablePath: '/opt/chrome',
      channel: 'msedge',
      snapshotMaxChars: 9,
      screenshotMaxBytes: 8,
      screenshotDir: '/tmp/shots',
    })
    expect(() => tool.resolveConfig({ timeoutMs: 0 })).toThrow('browser: timeoutMs must be a positive safe integer')
    expect(() => tool.resolveConfig({ timeoutMs: 1.5 })).toThrow('browser: timeoutMs must be a positive safe integer')
    expect(() => tool.resolveConfig({ snapshotMaxChars: -1 })).toThrow(
      'browser: snapshotMaxChars must be a positive safe integer',
    )
    expect(() => tool.resolveConfig({ screenshotMaxBytes: 0 })).toThrow(
      'browser: screenshotMaxBytes must be a positive safe integer',
    )
    expect(() => tool.resolveConfig({ executablePath: '  ' })).toThrow('browser: executablePath must be non-empty when set')
    expect(() => tool.resolveConfig({ channel: '' })).toThrow('browser: channel must be non-empty when set')
    expect(() => tool.resolveConfig({ screenshotDir: ' ' })).toThrow('browser: screenshotDir must be non-empty when set')
  })
})

describe('presenters and renderers', () => {
  it('builds fetch/read cards and model-facing text', () => {
    expect(tool.presentNavigateCall({ url: 'https://example.com/' })).toEqual({
      card: 'generic',
      title: 'https://example.com/',
      kind: 'fetch',
      rawInput: 'https://example.com/',
    })
    expect(tool.presentSnapshotCall({})).toEqual({
      card: 'generic',
      title: 'Page snapshot',
      kind: 'read',
      rawInput: {},
    })
    expect(tool.presentSnapshotCall({ screenshot: true })).toEqual({
      card: 'generic',
      title: 'Page snapshot',
      kind: 'read',
      rawInput: { screenshot: true },
    })
    expect(tool.renderNavigate({ url: 'https://example.com/' }, { url: 'https://example.com/', title: 'Example' }))
      .toEqual([{ type: 'text', text: 'Navigated to https://example.com/\nExample' }])
    expect(tool.renderNavigate({ url: 'https://example.com/' }, { url: 'https://example.com/', title: '  ' }))
      .toEqual([{ type: 'text', text: 'Navigated to https://example.com/' }])
    expect(tool.renderSnapshot({}, {
      url: 'https://example.com/',
      title: 'Example',
      snapshot: '- heading "Example"',
      truncated: false,
    })).toEqual([{ type: 'text', text: 'https://example.com/\nExample\n- heading "Example"' }])
    expect(tool.renderSnapshot({}, {
      url: 'https://example.com/',
      title: '',
      snapshot: '- heading "Example"',
      truncated: false,
      screenshotPath: '/tmp/a.png',
    })).toEqual([{ type: 'text', text: 'https://example.com/\n- heading "Example"\nScreenshot: /tmp/a.png' }])
  })
})

describe('browser verify tools', () => {
  it('navigates then snapshots through the real tool registry', async () => {
    const { ctx } = await setup({ timeoutMs: 1_500 })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(
      expect.arrayContaining(['browser_navigate', 'browser_snapshot']),
    )
    expect(ctx.tools.get('browser_navigate')?.isConcurrencySafe?.({ url: 'https://example.com/' })).toBe(false)
    expect(ctx.tools.get('browser_snapshot')?.isConcurrencySafe?.({})).toBe(false)

    const bad = await execute(ctx, 'browser_navigate', { url: 'file:///tmp/x.html' })
    expect(bad.isError).toBe(true)
    if (!bad.isError) throw new Error('expected navigate failure')
    expect(bad.content[0]).toMatchObject({ type: 'text' })

    const tooSoon = await execute(ctx, 'browser_snapshot', {})
    expect(tooSoon.isError).toBe(true)
    if (!tooSoon.isError) throw new Error('expected snapshot failure')
    const tooSoonBlock = tooSoon.content[0]
    expect(tooSoonBlock?.type).toBe('text')
    if (tooSoonBlock?.type === 'text') {
      expect(tooSoonBlock.text).toContain('browser: no open page')
    }

    const navigated = await execute(ctx, 'browser_navigate', { url: 'https://example.com/' })
    expect(navigated.isError).toBe(false)
    if (navigated.isError) throw new Error('expected navigate success')
    expect(navigated.value).toEqual({ url: 'https://example.com/', title: 'Example Domain' })
    expect(launch).toHaveBeenCalledWith({ headless: true })

    const snapshot = await execute(ctx, 'browser_snapshot', {})
    expect(snapshot.isError).toBe(false)
    if (snapshot.isError) throw new Error('expected snapshot success')
    expect(snapshot.value).toMatchObject({
      url: 'https://example.com/',
      title: 'Example Domain',
      snapshot: '- heading "Example Domain" [level=1]',
      truncated: false,
    })
  })

  it('writes a screenshot path when requested and unregisters on dispose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-browser-tool-shot-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const { ctx, toolFiber } = await setup({ screenshotDir: dir, headless: false, channel: 'chrome' })
    const navigated = await execute(ctx, 'browser_navigate', { url: 'http://127.0.0.1:9/' })
    expect(navigated.isError).toBe(false)
    expect(launch).toHaveBeenCalledWith({ headless: false, channel: 'chrome' })

    const snapshot = await execute(ctx, 'browser_snapshot', { screenshot: true })
    expect(snapshot.isError).toBe(false)
    if (snapshot.isError) throw new Error('expected snapshot success')
    const value = snapshot.value as { screenshotPath: string }
    expect(await readFile(value.screenshotPath)).toEqual(Buffer.from('png-bytes'))

    await toolFiber.dispose()
    expect(close).toHaveBeenCalled()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toEqual(
      expect.arrayContaining(['browser_navigate', 'browser_snapshot']),
    )
  })

  it('fails loading when a cap is invalid', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(tool, { snapshotMaxChars: -1 })).rejects.toThrow(
      'browser: snapshotMaxChars must be a positive safe integer',
    )
  })
})
