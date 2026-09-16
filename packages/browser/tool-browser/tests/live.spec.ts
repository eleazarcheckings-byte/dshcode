/**
 * Real Chromium against a local HTTP fixture. Skips when playwright-core cannot
 * launch a browser so keyless unit CI stays green without `playwright install`.
 */

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
  <head><title>Verify fixture</title></head>
  <body>
    <h1>Browser verify</h1>
    <p>Local page for accessibility snapshot.</p>
  </body>
</html>`

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(task => task()))
})

async function chromiumAvailable(): Promise<boolean> {
  try {
    const process = await launchPlaywright({ headless: true })
    await process.close()
    return true
  } catch {
    return false
  }
}

describe('browser verify against a local HTTP fixture', () => {
  it('navigates and snapshots a page that does not require login', async ({ skip }) => {
    if (!await chromiumAvailable()) {
      skip()
      return
    }

    const server = createServer((_req, res) => {
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

    const navigated = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('live-navigate'),
      name: 'browser_navigate',
      arguments: { url },
    })
    expect(navigated.isError).toBe(false)
    if (navigated.isError) throw new Error('expected live navigate success')
    expect(navigated.value).toMatchObject({ title: 'Verify fixture' })

    const snapshot = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('live-snapshot'),
      name: 'browser_snapshot',
      arguments: {},
    })
    expect(snapshot.isError).toBe(false)
    if (snapshot.isError) throw new Error('expected live snapshot success')
    const value = snapshot.value as { snapshot: string; title: string }
    expect(value.title).toBe('Verify fixture')
    expect(value.snapshot).toContain('Browser verify')
  }, 60_000)
})
