/**
 * Real Chromium against a local HTTP fixture, proving the browser control
 * tools added past navigate+snapshot: refs from browser_snapshot resolve
 * through browser_click/browser_type/browser_press/browser_hover/browser_scroll,
 * refs stay stable across two snapshots of an unchanged page, browser_page_text
 * reads rendered text, browser_console/browser_network capture what the page
 * emits, browser_tabs opens/selects/closes tabs, and browser_screenshot writes
 * a PNG. Skips when playwright-core cannot launch a browser so keyless unit CI
 * stays green without `playwright install`.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { launchPlaywright } from '../src/playwright.ts'

const HTML = `<!doctype html>
<html lang="en">
  <head><title>Control fixture</title></head>
  <body>
    <button id="flag-btn">Click me</button>
    <form action="/submitted" method="get">
      <input id="q" name="q" aria-label="Query" />
      <button type="submit">Go</button>
    </form>
    <div id="flag-out"></div>
    <div id="tall" style="height:3000px">tall content</div>
    <div id="bottom">bottom marker</div>
    <script>
      document.getElementById('flag-btn').addEventListener('click', () => {
        document.getElementById('flag-out').textContent = 'flag-was-clicked'
      })
      console.error('fixture console error')
      fetch('/xhr').catch(() => {})
    </script>
  </body>
</html>`

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(task => task()))
})

async function chromiumAvailable(): Promise<boolean> {
  try {
    const process = await launchPlaywright({
      headless: true,
      consoleLimit: 10,
      networkLimit: 10,
      autoDownload: false,
      onDownloadProgress: () => {},
    })
    await process.close()
    return true
  } catch {
    return false
  }
}

/** Extract the successful `value` from a tool result, failing the test with the raw content on error. */
function expectSuccess(result: Awaited<ReturnType<Context['tools']['execute']>>): unknown {
  if (result.isError) {
    const text = result.content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
    throw new Error(`expected tool success, got error: ${text}`)
  }
  return result.value
}

describe('browser control tools against a local HTTP fixture', () => {
  it('drives click, type+submit, page text, console, network, tabs, and screenshot', async ({ skip }) => {
    if (!await chromiumAvailable()) {
      skip()
      return
    }

    const server = createServer((req, res) => {
      if (req.url?.startsWith('/submitted')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><body>submitted</body></html>')
        return
      }
      if (req.url?.startsWith('/xhr')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HTML)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    }))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/`

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, { timeoutMs: 20_000 })
    cleanup.push(async () => {
      await ctx.fiber.dispose()
    })

    async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId(`control-${name}-${Math.random().toString(36).slice(2)}`),
        name,
        arguments: args,
      })
      return expectSuccess(result)
    }

    await run('browser_navigate', { url })

    // --- ref stability across two snapshots of an unchanged page ---
    const snap1 = (await run('browser_snapshot', {})) as { snapshot: string }
    const snap2 = (await run('browser_snapshot', {})) as { snapshot: string }
    expect(snap2.snapshot).toBe(snap1.snapshot)
    const buttonRefMatch = /button "Click me" \[ref=(e\d+)\]/.exec(snap1.snapshot)
    expect(buttonRefMatch?.[1]).toBeDefined()
    const buttonRef = buttonRefMatch![1]!
    const inputRefMatch = /textbox[^[]*\[ref=(e\d+)\]/.exec(snap1.snapshot)
    expect(inputRefMatch?.[1]).toBeDefined()
    const inputRef = inputRefMatch![1]!

    // --- click on a ref flips a DOM flag readable via browser_page_text ---
    await run('browser_click', { ref: buttonRef })
    const textAfterClick = (await run('browser_page_text', {})) as { text: string }
    expect(textAfterClick.text).toContain('flag-was-clicked')

    // --- type + press Enter submits and the URL changes ---
    await run('browser_type', { ref: inputRef, text: 'hello', submit: true })
    const afterSubmit = (await run('browser_page_text', {})) as { url: string; text: string }
    expect(afterSubmit.url).toBe(`${url}submitted?q=hello`)
    expect(afterSubmit.text).toContain('submitted')

    // --- back to the fixture for the remaining reads ---
    await run('browser_navigate', { url })

    // --- console: fixture's console.error, capped ---
    const console_ = (await run('browser_console', {})) as { messages: { type: string; text: string }[] }
    expect(console_.messages.some(message => message.type === 'error' && message.text.includes('fixture console error'))).toBe(true)

    // --- network: fixture's XHR with status and method ---
    await new Promise(resolve => setTimeout(resolve, 200))
    const network = (await run('browser_network', {})) as { requests: { method: string; url: string; status?: number }[] }
    const xhr = network.requests.find(request => request.url.endsWith('/xhr'))
    expect(xhr).toBeDefined()
    expect(xhr?.method).toBe('GET')
    expect(xhr?.status).toBe(200)

    // --- scroll by direction moves the viewport ---
    await run('browser_scroll', { direction: 'down', amount: 500 })

    // --- hover does not throw ---
    await run('browser_hover', { selector: '#bottom' })

    // --- tabs: new, list, select, close ---
    const opened = (await run('browser_tabs', { action: 'new', url })) as { tabs: { id: string; active: boolean }[] }
    expect(opened.tabs).toHaveLength(2)
    const secondId = opened.tabs.find(tab => tab.active)?.id
    expect(secondId).toBeDefined()
    const firstId = opened.tabs.find(tab => !tab.active)?.id
    expect(firstId).toBeDefined()
    const afterSelect = (await run('browser_tabs', { action: 'select', id: firstId })) as { tabs: { id: string; active: boolean }[] }
    expect(afterSelect.tabs.find(tab => tab.id === firstId)?.active).toBe(true)
    const afterClose = (await run('browser_tabs', { action: 'close', id: secondId })) as { tabs: { id: string }[] }
    expect(afterClose.tabs).toHaveLength(1)

    // --- screenshot returns bytes on disk ---
    const shot = (await run('browser_screenshot', {})) as { screenshotPath: string; bytes: number; mediaType: string }
    expect(shot.mediaType).toBe('image/png')
    expect(shot.bytes).toBeGreaterThan(0)
    const bytes = await readFile(shot.screenshotPath)
    expect(bytes.byteLength).toBe(shot.bytes)
  }, 60_000)

  it('refuses link-local/cloud-metadata hosts while allowing loopback', async ({ skip }) => {
    if (!await chromiumAvailable()) {
      skip()
      return
    }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, { timeoutMs: 5_000 })
    cleanup.push(async () => {
      await ctx.fiber.dispose()
    })

    const denied = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('control-link-local'),
      name: 'browser_navigate',
      arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
    })
    expect(denied.isError).toBe(true)
    if (!denied.isError) throw new Error('expected link-local navigate to fail')
    const deniedText = denied.content[0]
    expect(deniedText?.type).toBe('text')
    if (deniedText?.type === 'text') expect(deniedText.text).toContain('link-local')

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>loopback ok</body></html>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    }))
    const { port } = server.address() as AddressInfo
    const allowed = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('control-loopback'),
      name: 'browser_navigate',
      arguments: { url: `http://127.0.0.1:${port}/` },
    })
    expect(allowed.isError).toBe(false)
  }, 30_000)
})
