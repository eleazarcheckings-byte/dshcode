/**
 * Unit tests for the pure planning logic and the one file read this package
 * performs. No Cordis context, no MCP server — see tests/apply.spec.ts for
 * the real-composition tests that actually mount children.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planMounts, planOneRow, readServerMap } from '@deepseek-ai/dsh-mcp-config-claude/src/config.ts'
import type { PlanMountsOptions } from '@deepseek-ai/dsh-mcp-config-claude/src/config.ts'

const baseOptions: PlanMountsOptions = { toolCallTimeoutMs: 60_000 }

describe('planOneRow — stdio', () => {
  it('translates a minimal stdio row into a StdioConfig using the map key as serverName', () => {
    const decision = planOneRow('awake', { type: 'stdio', command: 'node', args: ['server.mjs'] }, baseOptions)
    if (!('mount' in decision)) throw new Error(`expected a mount, got a skip: ${JSON.stringify(decision)}`)
    expect(decision.mount.serverName).toBe('awake')
    expect(decision.mount.config).toEqual({
      transport: 'stdio',
      serverName: 'awake',
      command: 'node',
      args: ['server.mjs'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('expands ${VAR} references in env values from the process environment', () => {
    const original = process.env.MCP_CONFIG_CLAUDE_TEST_VAR
    process.env.MCP_CONFIG_CLAUDE_TEST_VAR = 'expanded-value'
    try {
      const decision = planOneRow(
        'srv',
        { type: 'stdio', command: 'node', env: { TOKEN: '${MCP_CONFIG_CLAUDE_TEST_VAR}', PLAIN: 'literal' } },
        baseOptions,
      )
      if (!('mount' in decision)) throw new Error('expected a mount')
      expect(decision.mount.config).toMatchObject({ env: { TOKEN: 'expanded-value', PLAIN: 'literal' } })
    } finally {
      if (original === undefined) delete process.env.MCP_CONFIG_CLAUDE_TEST_VAR
      else process.env.MCP_CONFIG_CLAUDE_TEST_VAR = original
    }
  })

  it('expands an unset ${VAR} to the empty string, never the literal placeholder', () => {
    delete process.env.MCP_CONFIG_CLAUDE_DEFINITELY_UNSET
    const decision = planOneRow('srv', { type: 'stdio', command: 'node', env: { TOKEN: '${MCP_CONFIG_CLAUDE_DEFINITELY_UNSET}' } }, baseOptions)
    if (!('mount' in decision)) throw new Error('expected a mount')
    expect((decision.mount.config as { env: Record<string, string> }).env.TOKEN).toBe('')
  })

  it('skips a stdio row with no command', () => {
    const decision = planOneRow('bad', { type: 'stdio' }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('command')
  })

  it('skips a stdio row whose args is not an array of strings', () => {
    const decision = planOneRow('bad', { type: 'stdio', command: 'node', args: [1, 2] }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('args')
  })
})

describe('planOneRow — http', () => {
  it('translates a minimal http row into a StreamableHttpConfig using the map key as serverName', () => {
    const decision = planOneRow('github', { type: 'http', url: 'https://api.githubcopilot.com/mcp' }, baseOptions)
    if (!('mount' in decision)) throw new Error('expected a mount')
    expect(decision.mount.config).toEqual({
      transport: 'streamable-http',
      serverName: 'github',
      url: 'https://api.githubcopilot.com/mcp',
      headers: {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('expands ${VAR} references in header values', () => {
    process.env.MCP_CONFIG_CLAUDE_TEST_TOKEN = 'secret-abc'
    try {
      const decision = planOneRow('web', { type: 'http', url: 'http://localhost/mcp', headers: { Authorization: 'Bearer ${MCP_CONFIG_CLAUDE_TEST_TOKEN}' } }, baseOptions)
      if (!('mount' in decision)) throw new Error('expected a mount')
      expect((decision.mount.config as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer secret-abc')
    } finally {
      delete process.env.MCP_CONFIG_CLAUDE_TEST_TOKEN
    }
  })

  it('skips an http row with no url', () => {
    const decision = planOneRow('bad', { type: 'http' }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('url')
  })

  it('forwards connectTimeoutMs when configured', () => {
    const decision = planOneRow('web', { type: 'http', url: 'http://localhost/mcp' }, { ...baseOptions, connectTimeoutMs: 5_000 })
    if (!('mount' in decision)) throw new Error('expected a mount')
    expect(decision.mount.config).toMatchObject({ connectTimeoutMs: 5_000 })
  })
})

describe('planOneRow — sse and unrecognized transports', () => {
  it('skips an sse row with a named reason', () => {
    const decision = planOneRow('cloudflare-bindings', { type: 'sse', url: 'https://bindings.mcp.cloudflare.com/sse' }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.serverName).toBe('cloudflare-bindings')
    expect(decision.skip.reason.toLowerCase()).toContain('sse')
  })

  it('skips a row with an unrecognized type', () => {
    const decision = planOneRow('weird', { type: 'websocket', url: 'ws://x' }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('websocket')
  })

  it('skips a row with a missing type', () => {
    const decision = planOneRow('weird', {}, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('missing')
  })

  it('skips a row that is not an object', () => {
    const decision = planOneRow('weird', 'not-an-object', baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('object')
  })
})

describe('planOneRow — include/exclude/name validation', () => {
  it('skips a row absent from an explicit include list', () => {
    const decision = planOneRow('other', { type: 'stdio', command: 'node' }, { ...baseOptions, include: ['awake'] })
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('include')
  })

  it('mounts a row present in an explicit include list', () => {
    const decision = planOneRow('awake', { type: 'stdio', command: 'node' }, { ...baseOptions, include: ['awake'] })
    expect('mount' in decision).toBe(true)
  })

  it('skips a row named in the exclude list', () => {
    const decision = planOneRow('saturnai', { type: 'stdio', command: 'node' }, { ...baseOptions, exclude: ['saturnai'] })
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toBe('excluded by configuration')
  })

  it('skips a server name outside the mcp-client naming pattern', () => {
    const decision = planOneRow('bad name!', { type: 'stdio', command: 'node' }, baseOptions)
    if (!('skip' in decision)) throw new Error('expected a skip')
    expect(decision.skip.reason).toContain('server name')
  })
})

describe('planMounts', () => {
  it('sorts a mixed map into mounts and skipped, preserving map order', () => {
    const plan = planMounts({
      awake: { type: 'stdio', command: 'node', args: ['awake.mjs'] },
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp' },
      'cloudflare-bindings': { type: 'sse', url: 'https://bindings.mcp.cloudflare.com/sse' },
    }, baseOptions)

    expect(plan.mounts.map(m => m.serverName)).toEqual(['awake', 'github'])
    expect(plan.skipped.map(s => s.serverName)).toEqual(['cloudflare-bindings'])
    expect(plan.skipped[0]?.reason.toLowerCase()).toContain('sse')
  })

  it('never includes a raw secret value in any skip reason', () => {
    const plan = planMounts({
      web: { type: 'http', url: 'http://localhost/mcp', headers: { Authorization: 'Bearer super-secret-value' } },
      broken: { type: 'stdio' },
    }, baseOptions)
    const allReasons = plan.skipped.map(s => s.reason).join('\n')
    expect(allReasons).not.toContain('super-secret-value')
  })
})

describe('readServerMap', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the mcpServers map from a Claude-Code-shaped config file', async () => {
    const configPath = join(dir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      otherField: 'ignored',
      mcpServers: { awake: { type: 'stdio', command: 'node' } },
    }))

    const map = await readServerMap(configPath)
    expect(map).toEqual({ awake: { type: 'stdio', command: 'node' } })
  })

  it('returns an empty map when mcpServers is absent', async () => {
    const configPath = join(dir, 'config.json')
    await writeFile(configPath, JSON.stringify({ otherField: 'x' }))

    const map = await readServerMap(configPath)
    expect(map).toEqual({})
  })

  it('rejects a file that is not valid JSON', async () => {
    const configPath = join(dir, 'config.json')
    await writeFile(configPath, '{ not json')

    await expect(readServerMap(configPath)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a file whose mcpServers field is not an object', async () => {
    const configPath = join(dir, 'config.json')
    await writeFile(configPath, JSON.stringify({ mcpServers: 'nope' }))

    await expect(readServerMap(configPath)).rejects.toThrow(/mcpServers.*not an object/)
  })

  it('rejects a missing file', async () => {
    await expect(readServerMap(join(dir, 'does-not-exist.json'))).rejects.toThrow()
  })
})
