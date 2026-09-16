/**
 * Real-composition tests: boots a Cordis Context with the actual tool
 * registry, points `apply` at a real Claude-Code-shaped config file, and
 * proves the observable behavior end to end — including mounting a REAL
 * stdio MCP server (dsh-mcp-client's own fixture, reused read-only from
 * ../../mcp-client/tests/fixture-server.ts) so a tool genuinely registers
 * under `mcp__<serverName>__<tool>`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, Config as ConfigSchema, getStatus, inject, name } from '@deepseek-ai/dsh-mcp-config-claude/src/index.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-config-claude/src/index.ts'

// Read-only reuse of dsh-mcp-client's own stdio fixture server — this
// package never writes into packages/mcp/mcp-client.
const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const mcpClientPackageDir = fileURLToPath(new URL('../../mcp-client', import.meta.url))

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Capture the plugin's own logger lines by level on one context. */
function captureLogs(ctx: Context): { warns: string[]; errors: string[] } {
  const warns: string[] = []
  const errors: string[] = []
  ctx.logger.warn = ((message: unknown) => { warns.push(String(message)) }) as typeof ctx.logger.warn
  ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
  return { warns, errors }
}

async function writeClaudeConfig(dir: string, mcpServers: Record<string, unknown>): Promise<string> {
  const configPath = join(dir, '.claude.json')
  await writeFile(configPath, JSON.stringify({ mcpServers }))
  return configPath
}

describe('module exports', () => {
  it('exports name, inject, and Config as a plain function plugin (no default export)', async () => {
    expect(name).toBe('mcp-config-claude')
    expect(inject).toEqual(['tools'])
    expect(ConfigSchema).toBeDefined()
    const mod: Record<string, unknown> = await import('@deepseek-ai/dsh-mcp-config-claude/src/index.ts')
    expect(mod.default).toBeUndefined()
  })

  it('Config schema requires configPath', () => {
    expect(() => ConfigSchema({} as never)).toThrow()
  })

  it('Config schema fills in default exclude, toolCallTimeoutMs, and failOnStartupError', () => {
    const resolved = ConfigSchema({ configPath: '/tmp/x.json' } as never)
    expect(resolved.exclude).toEqual([])
    expect(resolved.toolCallTimeoutMs).toBe(60_000)
    expect(resolved.failOnStartupError).toBe(false)
  })
})

describe('apply — real stdio mount', () => {
  let ctx: Context
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-apply-'))
    ctx = await mountRegistry()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await sleep(200)
    await rm(dir, { recursive: true, force: true })
  })

  it('mounts a real stdio row under the map key as serverName, registering mcp__<key>__<tool>', async () => {
    const configPath = await writeClaudeConfig(dir, {
      awake: {
        type: 'stdio',
        command: process.execPath,
        args: [fixtureServerPath],
        cwd: mcpClientPackageDir,
      },
    })

    const config: Config = ConfigSchema({ configPath } as never)
    await apply(ctx, config)

    expect(ctx.tools.get('mcp__awake__add')).toBeDefined()
    expect(ctx.tools.get('mcp__awake__greet')).toBeDefined()

    const status = getStatus(ctx)
    expect(status?.mounted).toEqual(['awake'])
    expect(status?.skipped).toEqual([])
    expect(status?.failed).toEqual([])

    const call = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'c1' as never,
      name: 'mcp__awake__add',
      arguments: { a: 2, b: 3 },
    })
    expect(call.isError).toBe(false)
    expect(call.content[0]).toEqual({ type: 'text', text: '5' })
  }, 30_000)

  it('reports an unreachable stdio command as unavailable and still mounts the other real row', async () => {
    const configPath = await writeClaudeConfig(dir, {
      broken: { type: 'stdio', command: 'this-command-does-not-exist-xyz123' },
      awake: { type: 'stdio', command: process.execPath, args: [fixtureServerPath], cwd: mcpClientPackageDir },
    })
    const { warns, errors } = captureLogs(ctx)

    const config: Config = ConfigSchema({ configPath } as never)
    await apply(ctx, config)

    // The real, reachable row still mounted and registered its tools.
    expect(ctx.tools.get('mcp__awake__add')).toBeDefined()
    const status = getStatus(ctx)
    expect(status?.mounted).toEqual(['broken', 'awake'])
    // The unreachable command's failure is reported by the mounted child
    // itself (dsh-mcp-client), never as a fatal error from this plugin.
    expect(warns.join('\n') + errors.join('\n')).toMatch(/broken/)
  }, 30_000)
})

describe('apply — skip and filter behavior', () => {
  let ctx: Context
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-skip-'))
    ctx = await mountRegistry()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('skips an sse row with a named reason and never mounts it', async () => {
    const configPath = await writeClaudeConfig(dir, {
      'cloudflare-bindings': { type: 'sse', url: 'https://bindings.mcp.cloudflare.com/sse' },
    })
    const { warns } = captureLogs(ctx)

    await apply(ctx, ConfigSchema({ configPath } as never))

    const status = getStatus(ctx)
    expect(status?.mounted).toEqual([])
    expect(status?.skipped).toEqual([{ serverName: 'cloudflare-bindings', reason: expect.stringContaining('sse') as unknown as string }])
    expect(warns.some(line => line.includes('cloudflare-bindings') && line.toLowerCase().includes('sse'))).toBe(true)
  })

  it('excludes a named server and leaves it unmounted', async () => {
    const configPath = await writeClaudeConfig(dir, {
      saturnai: { type: 'stdio', command: process.execPath, args: [fixtureServerPath], cwd: mcpClientPackageDir },
      awake: { type: 'stdio', command: process.execPath, args: [fixtureServerPath], cwd: mcpClientPackageDir },
    })

    await apply(ctx, ConfigSchema({ configPath, exclude: ['saturnai'] } as never))

    const status = getStatus(ctx)
    expect(status?.mounted).toEqual(['awake'])
    expect(status?.skipped).toEqual([{ serverName: 'saturnai', reason: 'excluded by configuration' }])
    expect(ctx.tools.get('mcp__saturnai__add')).toBeUndefined()
    expect(ctx.tools.get('mcp__awake__add')).toBeDefined()
  }, 30_000)

  it('mounts a streamable-http row (attempt succeeds even when the endpoint is unreachable)', async () => {
    const configPath = await writeClaudeConfig(dir, {
      // Port 1 on loopback: nothing listens there, so the connection itself
      // fails, but the child plugin still mounts (failOnStartupError: false).
      web: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer test-token' } },
    })

    await apply(ctx, ConfigSchema({ configPath } as never))

    const status = getStatus(ctx)
    expect(status?.mounted).toEqual(['web'])
    expect(status?.failed).toEqual([])
  }, 15_000)
})

describe('apply — secret hygiene', () => {
  it('never logs a raw env or header secret value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-secret-'))
    const ctx = await mountRegistry()
    try {
      process.env.MCP_CONFIG_CLAUDE_SECRET_TEST = 'super-secret-should-never-be-logged'
      const configPath = await writeClaudeConfig(dir, {
        broken: {
          type: 'stdio',
          command: 'this-command-does-not-exist-xyz123',
          env: { API_KEY: '${MCP_CONFIG_CLAUDE_SECRET_TEST}' },
        },
        web: {
          type: 'http',
          url: 'http://127.0.0.1:1/mcp',
          headers: { Authorization: 'Bearer ${MCP_CONFIG_CLAUDE_SECRET_TEST}' },
        },
      })
      const { warns, errors } = captureLogs(ctx)

      await apply(ctx, ConfigSchema({ configPath } as never))

      const allLogText = [...warns, ...errors].join('\n')
      expect(allLogText).not.toContain('super-secret-should-never-be-logged')
    } finally {
      delete process.env.MCP_CONFIG_CLAUDE_SECRET_TEST
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})

describe('apply — strict startup', () => {
  it('rejects a missing config file regardless of failOnStartupError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-strict-missing-'))
    const ctx = await mountRegistry()
    try {
      await expect(apply(ctx, ConfigSchema({ configPath: join(dir, 'missing.json') } as never)))
        .rejects.toThrow()
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects this plugin\'s own activation when failOnStartupError is set and a row cannot connect', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-strict-'))
    const ctx = await mountRegistry()
    try {
      const configPath = await writeClaudeConfig(dir, {
        broken: { type: 'stdio', command: 'this-command-does-not-exist-xyz123' },
      })

      await expect(apply(ctx, ConfigSchema({ configPath, failOnStartupError: true } as never)))
        .rejects.toThrow()
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
