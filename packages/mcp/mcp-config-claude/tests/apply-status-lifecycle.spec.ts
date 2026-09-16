/**
 * New spec added in the fix round after tests/apply.spec.ts's own RED commit
 * (noted in the fix-round report). Proves `getStatus` no longer reports a
 * stale "mounted" list once the owning fiber has disposed — the published
 * status is registered as an effect and cleared on teardown.
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

async function writeClaudeConfig(dir: string, mcpServers: Record<string, unknown>): Promise<string> {
  const configPath = join(dir, '.claude.json')
  await writeFile(configPath, JSON.stringify({ mcpServers }))
  return configPath
}

describe('apply — status lifecycle', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-config-claude-status-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('clears the published status once the owning fiber disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const configPath = await writeClaudeConfig(dir, {
      awake: { type: 'stdio', command: process.execPath, args: [fixtureServerPath], cwd: mcpClientPackageDir },
    })

    await apply(ctx, ConfigSchema({ configPath }))
    expect(getStatus(ctx)?.mounted).toEqual(['awake'])

    await ctx.fiber.dispose()
    expect(getStatus(ctx)).toBeUndefined()
  }, 20_000)
})
