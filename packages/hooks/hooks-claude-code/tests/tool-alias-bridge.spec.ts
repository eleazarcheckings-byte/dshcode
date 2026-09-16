import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as HooksClaude from '@deepseek-ai/dsh-hooks-claude-code'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop coverage for the toolAliases bridge fidelity work (mandate cell M2-hook-bridge): an
 * unmodified Claude Code hooks.json using Claude tool names (`Bash|PowerShell`, `Edit|Write|MultiEdit`)
 * must actually select DSH tool calls (`bash`, `pwsh`, `edit`, `write`, `str_replace_editor`), and the
 * synthesised PreToolUse/PostToolUse payload must carry a Claude-facing `tool_name` plus the exact
 * field names izzy's `gate-guard.js` / `gate-guard-mcp.js` read (`tool_input.command`, `tool_response`).
 */

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function dir(): string { const d = mkdtempSync(join(tmpdir(), 'dsh-hooks-alias-')); dirs.push(d); return d }
function sh(d: string, name: string, body: string): string {
  const p = join(d, name); writeFileSync(p, body); chmodSync(p, 0o755); return p
}
function hooksConfig(d: string, hooks: unknown): string {
  const p = join(d, 'hooks.json'); writeFileSync(p, JSON.stringify({ hooks })); return p
}

type ExtraConfig = { toolAliases?: unknown }

async function harness(
  configPath: string,
  adapter: MockAdapter,
  extra: ExtraConfig = {},
  beforeHooks?: (ctx: Context) => void,
): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  beforeHooks?.(ctx)
  await ctx.plugin(HooksClaude, { configPath, ...extra } as never)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(agent: Agent): Promise<void> { return agent.whenIdle() }
let seq = 0
function nextSession(): SessionId { return SessionId(`s-${++seq}`) }

describe('hooks-claude-code bridge — toolAliases matcher expansion', () => {
  async function runToolCall(configPath: string, toolName: string): Promise<boolean> {
    const adapter = new MockAdapter([toolCallResponse('c1', toolName, {}), textResponse('done')])
    const ctx = await harness(configPath, adapter)
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: toolName, description: 'd', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)
    return ran
  }

  it('matcher "Bash|PowerShell" (Claude names) fires for DSH tools bash and pwsh, not for read', async () => {
    const d = dir()
    const deny = sh(d, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n')
    const configPath = hooksConfig(d, { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: deny }] }] })

    expect(await runToolCall(configPath, 'bash')).toBe(false)
    expect(await runToolCall(configPath, 'pwsh')).toBe(false)
    expect(await runToolCall(configPath, 'read')).toBe(true)
  })

  it('matcher "Edit|Write|MultiEdit" fires for edit, write, and str_replace_editor, not for grep', async () => {
    const d = dir()
    const deny = sh(d, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n')
    const configPath = hooksConfig(d, { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: deny }] }] })

    expect(await runToolCall(configPath, 'edit')).toBe(false)
    expect(await runToolCall(configPath, 'write')).toBe(false)
    expect(await runToolCall(configPath, 'str_replace_editor')).toBe(false)
    expect(await runToolCall(configPath, 'grep')).toBe(true)
  })
})

describe('hooks-claude-code bridge — synthesised payload field contract', () => {
  it('a PreToolUse payload for a bash call carries tool_name "Bash" and tool_input.command', async () => {
    const d = dir()
    const cap = join(d, 'payload')
    const capScript = sh(d, 'capture.sh', `#!/usr/bin/env bash\ncat > "${cap}"\n`)
    const configPath = hooksConfig(d, { PreToolUse: [{ hooks: [{ type: 'command', command: capScript }] }] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'bash', { command: 'echo hello' }), textResponse('done')])
    const ctx = await harness(configPath, adapter)
    ctx.tools.register(defineContentToolFixture({ name: 'bash', description: 'd', parameters: { command: { type: 'string' } }, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)

    const payload = JSON.parse(readFileSync(cap, 'utf8')) as { tool_name: string; tool_input: { command: string }; session_id: string; cwd: string }
    expect(payload.tool_name).toBe('Bash')
    expect(payload.tool_input.command).toBe('echo hello')
    expect(typeof payload.session_id).toBe('string')
    expect(typeof payload.cwd).toBe('string')
  })

  it('a PreToolUse payload for a DSH tool with no Claude alias falls back to the raw tool_name', async () => {
    const d = dir()
    const cap = join(d, 'payload')
    const capScript = sh(d, 'capture.sh', `#!/usr/bin/env bash\ncat > "${cap}"\n`)
    const configPath = hooksConfig(d, { PreToolUse: [{ hooks: [{ type: 'command', command: capScript }] }] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'terminal_open', {}), textResponse('done')])
    const ctx = await harness(configPath, adapter)
    ctx.tools.register(defineContentToolFixture({ name: 'terminal_open', description: 'd', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)

    const payload = JSON.parse(readFileSync(cap, 'utf8')) as { tool_name: string }
    expect(payload.tool_name).toBe('terminal_open')
  })

  it('a PostToolUse payload carries tool_name "Edit" and tool_response with the tool result text', async () => {
    const d = dir()
    const cap = join(d, 'payload')
    const capScript = sh(d, 'capture.sh', `#!/usr/bin/env bash\ncat > "${cap}"\n`)
    const configPath = hooksConfig(d, { PostToolUse: [{ hooks: [{ type: 'command', command: capScript }] }] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'edit', { file_path: '/tmp/x' }), textResponse('done')])
    const ctx = await harness(configPath, adapter)
    ctx.tools.register(defineContentToolFixture({ name: 'edit', description: 'd', parameters: {}, async execute() { return [{ type: 'text', text: 'edited successfully' }] } }))
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)

    const payload = JSON.parse(readFileSync(cap, 'utf8')) as { tool_name: string; tool_response: string }
    expect(payload.tool_name).toBe('Edit')
    expect(payload.tool_response).toBe('edited successfully')
  })
})

describe('hooks-claude-code bridge — toolAliases config validation', () => {
  it('rejects a non-array toolAliases entry at load', async () => {
    const d = dir()
    const configPath = hooksConfig(d, {})
    await expect(harness(configPath, new MockAdapter([]), { toolAliases: { Bash: 'not-an-array' } }))
      .rejects.toThrow(/hooks-claude-code: toolAliases\.Bash must be a non-empty array/)
  })

  it('rejects an empty-array toolAliases entry at load', async () => {
    const d = dir()
    const configPath = hooksConfig(d, {})
    await expect(harness(configPath, new MockAdapter([]), { toolAliases: { Bash: [] } }))
      .rejects.toThrow(/hooks-claude-code: toolAliases\.Bash must be a non-empty array/)
  })

  it('rejects a non-object toolAliases value at load', async () => {
    const d = dir()
    const configPath = hooksConfig(d, {})
    await expect(harness(configPath, new MockAdapter([]), { toolAliases: 'nope' }))
      .rejects.toThrow(/hooks-claude-code: toolAliases must be an object/)
  })

  it('a configured toolAliases entry ADDS/OVERRIDES a default without dropping the other defaults', async () => {
    const d = dir()
    const deny = sh(d, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n')
    // Override Bash's alias to a made-up DSH name, then confirm the untouched default (PowerShell → pwsh) still works.
    const configPath = hooksConfig(d, { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: deny }] }] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'pwsh', {}), textResponse('done')])
    const ctx = await harness(configPath, adapter, { toolAliases: { Bash: ['custom-bash-tool'] } })
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'pwsh', description: 'd', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)
    expect(ran).toBe(false) // PowerShell → pwsh default still applied and matched → denied
  })
})

describe('hooks-claude-code bridge — unsupported event warning', () => {
  it('warns with a reason for each unsupported top-level event (ConfigChange, PreCompact)', async () => {
    const d = dir()
    const configPath = hooksConfig(d, {
      ConfigChange: [{ hooks: [{ type: 'command', command: 'exit 0' }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: 'exit 0' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 0' }] }],
    })
    const warn = vi.fn()
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(configPath, adapter, {}, (ctx) => { ctx.logger.warn = warn as never })
    const agent = ctx.agentLoop.create(nextSession(), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(agent)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ConfigChange'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PreCompact'))
    const calls = warn.mock.calls.map(c => String(c[0]))
    expect(calls.some(c => c.includes('ConfigChange') && c.includes('unsupported event'))).toBe(true)
    expect(calls.some(c => c.includes('PreCompact') && c.includes('unsupported event'))).toBe(true)
  })
})
