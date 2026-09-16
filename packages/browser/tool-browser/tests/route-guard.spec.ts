/**
 * Closes the Mars round-1 gap: `parseBrowserUrl` only validates the two
 * model-supplied URL arguments (`browser_navigate`, `browser_tabs new`), so a
 * same-origin redirect toward a link-local/cloud-metadata host was never
 * re-checked. `shouldBlockRequestUrl` is the pure decision function behind
 * the per-request `page.route` guard in `playwright.ts`; the second test
 * proves the guard actually stops a live redirect chain, not just the
 * decision function in isolation.
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
import { shouldBlockRequestUrl } from '../src/playwright.ts'

describe('shouldBlockRequestUrl', () => {
  it('blocks link-local and cloud-metadata request URLs', () => {
    expect(shouldBlockRequestUrl('http://169.254.169.254/latest/meta-data/')).toBe(true)
    expect(shouldBlockRequestUrl('http://[fe80::1]/')).toBe(true)
  })

  it('allows loopback, private-network, and ordinary public request URLs', () => {
    expect(shouldBlockRequestUrl('http://127.0.0.1:4000/xhr')).toBe(false)
    expect(shouldBlockRequestUrl('http://10.0.0.5/api')).toBe(false)
    expect(shouldBlockRequestUrl('https://example.com/script.js')).toBe(false)
  })

  it('lets an unparsable request URL through rather than blocking it', () => {
    expect(shouldBlockRequestUrl('not a url')).toBe(false)
    expect(shouldBlockRequestUrl('about:blank')).toBe(false)
  })
})

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

describe('route-level link-local guard against a live redirect', () => {
  it('blocks a same-origin redirect into a link-local/cloud-metadata host', async ({ skip }) => {
    if (!await chromiumAvailable()) {
      skip()
      return
    }

    const server = createServer((req, res) => {
      if (req.url?.startsWith('/to-metadata')) {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>ordinary page</body></html>')
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

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, { timeoutMs: 10_000 })
    cleanup.push(async () => {
      await ctx.fiber.dispose()
    })

    // The redirect's origin (127.0.0.1) itself passes `parseBrowserUrl`; only
    // the route guard, which re-checks every request including the redirect
    // hop, can catch what this navigation actually resolves to.
    const redirected = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('route-guard-redirect'),
      name: 'browser_navigate',
      arguments: { url: `http://127.0.0.1:${port}/to-metadata` },
    })
    expect(redirected.isError).toBe(true)

    // An ordinary same-origin response (no link-local redirect involved)
    // still succeeds — the guard does not over-block loopback traffic.
    const ordinary = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('route-guard-ordinary'),
      name: 'browser_navigate',
      arguments: { url: `http://127.0.0.1:${port}/` },
    })
    expect(ordinary.isError).toBe(false)
  }, 30_000)
})
