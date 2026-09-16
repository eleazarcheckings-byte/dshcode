/**
 * New spec added in the fix round after tests/apply.spec.ts's own RED commit
 * (noted in the fix-round report). tests/apply.spec.ts's own http row points
 * at a closed port (127.0.0.1:1) and only proves the child plugin instance
 * loads — it never proves an http row's tools actually register as
 * `mcp__<key>__<tool>`, or that an expanded `${VAR}` header reaches the
 * transport. This spec stands up dsh-mcp-client's own real Streamable HTTP
 * MCP fixture (read-only reuse, same pattern tests/apply.spec.ts already
 * uses for the stdio fixture) to prove both end to end.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, Config as ConfigSchema, getStatus } from '@deepseek-ai/dsh-mcp-config-claude/src/index.ts'
import { startHttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'
import type { HttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'

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

describe('apply — real streamable-http mount', () => {
  let ctx: Context
  let dir: string
  let fixture: HttpMcpFixture

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-http-'))
    ctx = await mountRegistry()
    fixture = await startHttpMcpFixture()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await fixture.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('registers mcp__<key>__<tool> for a real http row and expands a ${VAR} Authorization header onto the transport', async () => {
    process.env.MCP_CONFIG_CLAUDE_HTTP_TEST_TOKEN = 'expanded-http-secret'
    try {
      const configPath = await writeClaudeConfig(dir, {
        web: {
          type: 'http',
          url: fixture.url,
          headers: { Authorization: 'Bearer ${MCP_CONFIG_CLAUDE_HTTP_TEST_TOKEN}' },
        },
      })

      const config = ConfigSchema({ configPath })
      await apply(ctx, config)

      expect(ctx.tools.get('mcp__web__ping')).toBeDefined()
      const status = getStatus(ctx)
      expect(status?.mounted).toEqual(['web'])

      const call = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: 'c1' as never,
        name: 'mcp__web__ping',
        arguments: {},
      })
      expect(call.isError).toBe(false)
      expect(call.content[0]).toEqual({ type: 'text', text: 'pong' })

      expect(fixture.authorization).toContain('Bearer expanded-http-secret')
    } finally {
      delete process.env.MCP_CONFIG_CLAUDE_HTTP_TEST_TOKEN
    }
  }, 15_000)
})
