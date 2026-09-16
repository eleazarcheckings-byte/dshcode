/**
 * New spec added in the fix round after tests/apply.spec.ts's own RED commit
 * (noted in the fix-round report). Proves rows mount concurrently: a row
 * pointed at a non-routable address (whose TCP connect hangs, rather than
 * failing fast like a closed port does) must not block a real, reachable
 * stdio row from mounting and registering its tools.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, Config as ConfigSchema, getStatus } from '@deepseek-ai/dsh-mcp-config-claude/src/index.ts'

const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const mcpClientPackageDir = fileURLToPath(new URL('../../mcp-client', import.meta.url))

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function writeClaudeConfig(dir: string, mcpServers: Record<string, unknown>): Promise<string> {
  const configPath = join(dir, '.claude.json')
  await writeFile(configPath, JSON.stringify({ mcpServers }))
  return configPath
}

describe('apply — concurrent mounting', () => {
  let ctx: Context
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-concurrency-'))
    ctx = await mountRegistry()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('mounts a real stdio row without waiting out a row pointed at a non-routable address', async () => {
    const configPath = await writeClaudeConfig(dir, {
      // Non-routable address (the shape a captive portal or a blackholing
      // firewall produces — this environment's own routing may fail it fast
      // or let the connect hang; either way, sequential mounting would make
      // this row's own connectTimeoutMs deadline gate every row after it).
      hung: { type: 'http', url: 'http://10.255.255.1:9/mcp' },
      awake: { type: 'stdio', command: process.execPath, args: [fixtureServerPath], cwd: mcpClientPackageDir },
    })

    // A short connectTimeoutMs bounds the "hung" row's own handshake so the
    // test itself stays fast on a route that does hang; it is the
    // concurrency, not the timeout value, under test — the awake row has no
    // network dependency at all, so it must register promptly regardless.
    const config = ConfigSchema({ configPath, connectTimeoutMs: 2_000 })
    await apply(ctx, config)

    expect(ctx.tools.get('mcp__awake__add')).toBeDefined()
    const status = getStatus(ctx)
    expect(status?.mounted).toEqual(['hung', 'awake'])
  }, 20_000)
})
