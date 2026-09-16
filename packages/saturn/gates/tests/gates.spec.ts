import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService, { setApprovalPolicy, type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, { defineContentToolFixture, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import * as Gates from '../src/index.ts'
import type { Config } from '../src/index.ts'

/**
 * Composition suite: the Gate plugin on a real tool registry beside the real
 * approval service. It proves what the model and the user actually experience
 * — which calls stop, which pass through untouched, what the model is told
 * when they stop, and that one call never raises two separate approvals.
 */

interface Harness {
  ctx: Context
  /** Every approval put to the answerer chain, in order. */
  asked: ApprovalRequest[]
  /** Commands whose tool body actually ran. */
  ran: string[]
  agent: Agent
  answer: (outcome: ApprovalOutcome) => void
  call: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>
}

/** A session with an open turn, which is the approval service's precondition. */
function fakeAgent(id: string, policy?: 'ask' | 'never'): Agent {
  const session = Session.create(SessionId(id))
  if (policy !== undefined) setApprovalPolicy(session, policy)
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

/**
 * Boot the core spine, the approval seam, and the Gate plugin, then register a
 * `bash` fixture that mirrors `@deepseek-ai/dsh-tool-bash`'s escalation
 * contract: a call carrying `sandbox_permissions` routes through the shared
 * `approveEscalation` helper before the command body runs.
 */
async function harness(config: Config = {}, options: { approval?: { policy?: 'ask' | 'never' }; mountApproval?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.mountApproval !== false) await ctx.plugin(ApprovalService, options.approval ?? {})
  await ctx.plugin(Gates, config)

  const asked: ApprovalRequest[] = []
  const ran: string[] = []
  let outcome: ApprovalOutcome = 'allowed-once'
  ctx.on('approval/request', (request) => {
    asked.push(request)
    return Promise.resolve(outcome)
  })

  ctx.tools.register(defineContentToolFixture({
    name: 'bash',
    description: 'Execute a shell command.',
    parameters: {
      command: { type: 'string', required: true },
      description: { type: 'string' },
      sandbox_permissions: { type: 'string' },
      justification: { type: 'string' },
    },
    async execute(args, exec) {
      if (args.sandbox_permissions !== undefined) {
        await approveEscalation(
          {
            requestedMode: args.sandbox_permissions,
            justification: args.justification ?? 'needed',
            effectiveMode: 'workspace-write',
            subject: 'command',
          },
          {
            approver: ctx.get('approval'),
            agent: exec.agent,
            callId: exec.callId,
            toolName: 'bash',
            signal: exec.signal,
          },
        )
      }
      ran.push(args.command)
      return [{ type: 'text', text: 'ok' }]
    },
  }))

  ctx.tools.register(defineContentToolFixture({
    name: 'mcp__saturn-browser__keychain_get',
    description: 'Read one stored credential.',
    parameters: { name: { type: 'string' } },
    async execute(args) {
      ran.push(`keychain:${args.name ?? ''}`)
      return [{ type: 'text', text: 'secret' }]
    },
  }))

  ctx.tools.register(defineContentToolFixture({
    name: 'mcp__awake__recall',
    description: 'Recall a memory.',
    parameters: { query: { type: 'string' } },
    async execute(args) {
      ran.push(`recall:${args.query ?? ''}`)
      return [{ type: 'text', text: 'memory' }]
    },
  }))

  const agent = fakeAgent(id())
  let sequence = 0

  return {
    ctx,
    asked,
    ran,
    agent,
    answer: (next: ApprovalOutcome) => { outcome = next },
    async call(name, args) {
      sequence += 1
      const result = await ctx.tools.execute({
        callId: ToolCallId(`call-${sequence}`),
        name,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
      const first = result.content[0]
      return { isError: result.isError, text: first?.type === 'text' ? first.text : '' }
    },
  }
}

let counter = 0
/** A fresh session id per harness so detached sessions never collide. */
function id(): string {
  counter += 1
  return `gates-${counter}`
}

describe('Gate-class calls stop and reach the user', () => {
  it('asks before a force push and runs it once the user allows', async () => {
    const h = await harness()
    const result = await h.call('bash', { command: 'git push --force origin master', description: 'force push' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]).toMatchObject({ toolName: 'bash', callId: 'call-1' })
    expect(h.asked[0]?.reason).toContain('publish')
    expect(result.isError).toBe(false)
    expect(h.ran).toEqual(['git push --force origin master'])
  })

  it('asks before a webhook POST and tells the model why when the user says no', async () => {
    const h = await harness()
    h.answer('rejected')
    const result = await h.call('bash', { command: 'curl -X POST https://hooks.slack.com/services/x', description: 'post' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]?.reason).toContain('outbound')
    expect(result.isError).toBe(true)
    expect(h.ran).toEqual([])
  })

  it('asks before a recursive delete outside the workspace', async () => {
    const h = await harness()
    h.answer('rejected')
    await h.call('bash', { command: 'rm -rf C:/Users', description: 'delete' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]?.reason).toContain('destructive')
  })

  it('asks before a credential read on the real MCP tool name', async () => {
    const h = await harness()
    const result = await h.call('mcp__saturn-browser__keychain_get', { name: 'stripe' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]).toMatchObject({ toolName: 'mcp__saturn-browser__keychain_get' })
    expect(h.asked[0]?.reason).toContain('credentials')
    expect(result.isError).toBe(false)
  })
})

describe('everything else stays transparent', () => {
  it('runs a benign command with no approval at all', async () => {
    const h = await harness()
    const result = await h.call('bash', { command: 'ls', description: 'list' })

    expect(h.asked).toEqual([])
    expect(result).toEqual({ isError: false, text: 'ok' })
    expect(h.ran).toEqual(['ls'])
  })

  it('runs a non-Gate MCP call with no approval at all', async () => {
    const h = await harness()
    const result = await h.call('mcp__awake__recall', { query: 'saturn' })

    expect(h.asked).toEqual([])
    expect(result.isError).toBe(false)
  })

  it('delegates a non-Gate call to the next listener on the waterfall', async () => {
    const h = await harness()
    const seen: string[] = []
    h.ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      seen.push(exec.name)
      return next()
    })
    await h.call('bash', { command: 'ls', description: 'list' })
    expect(seen).toEqual(['bash'])
  })

  it('does not delegate a Gate-class call, so a later listener cannot raise a second decision', async () => {
    const h = await harness()
    const seen: string[] = []
    h.ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      seen.push(exec.name)
      return next()
    })
    await h.call('bash', { command: 'git push --force origin master', description: 'force push' })
    expect(seen).toEqual([])
    expect(h.asked).toHaveLength(1)
  })
})

describe('one call, one approval', () => {
  it('raises exactly one approval for a Gate-class command that also requests a sandbox escalation', async () => {
    const h = await harness()
    const result = await h.call('bash', {
      command: 'git push --force origin master',
      description: 'force push',
      sandbox_permissions: 'danger-full-access',
      justification: 'the remote lives outside the workspace',
    })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]?.reason).toContain('escalate sandbox to danger-full-access')
    expect(result.isError).toBe(false)
    expect(h.ran).toEqual(['git push --force origin master'])
  })

  it('still stops the command when the user rejects that single approval', async () => {
    const h = await harness()
    h.answer('rejected')
    const result = await h.call('bash', {
      command: 'git push --force origin master',
      description: 'force push',
      sandbox_permissions: 'danger-full-access',
      justification: 'the remote lives outside the workspace',
    })

    expect(h.asked).toHaveLength(1)
    expect(result.isError).toBe(true)
    expect(h.ran).toEqual([])
  })

  it('raises exactly one approval for the same command without an escalation', async () => {
    const h = await harness()
    await h.call('bash', { command: 'git push --force origin master', description: 'force push' })
    expect(h.asked).toHaveLength(1)
  })

  it('keeps a deny-class command denied even when it carries an escalation', async () => {
    const h = await harness()
    const result = await h.call('bash', {
      command: 'mkfs.ext4 /dev/sda1',
      description: 'format',
      sandbox_permissions: 'danger-full-access',
      justification: 'the disk is outside the workspace',
    })

    expect(h.asked).toEqual([])
    expect(result.isError).toBe(true)
    expect(h.ran).toEqual([])
  })

  it('leaves the escalation prompt alone when deferral is turned off', async () => {
    const h = await harness({ deferToSandboxEscalation: false })
    await h.call('bash', {
      command: 'git push --force origin master',
      description: 'force push',
      sandbox_permissions: 'danger-full-access',
      justification: 'the remote lives outside the workspace',
    })
    expect(h.asked).toHaveLength(2)
  })
})

describe('what the model is told', () => {
  it('names the class, the rule and the user decision in the ask reason', async () => {
    const h = await harness()
    await h.call('bash', { command: 'git push --force origin master', description: 'force push' })
    const reason = h.asked[0]?.reason ?? ''
    expect(reason).toContain('publish')
    expect(reason).toContain('publish-git-force-push')
    expect(reason).toContain('remote history')
  })

  it('denies a catastrophic command with a reason that tells the model to stop, without asking anyone', async () => {
    const h = await harness()
    const result = await h.call('bash', { command: 'dd if=/dev/zero of=/dev/sda bs=1M', description: 'wipe' })

    expect(h.asked).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.text).toContain('destructive')
    expect(result.text).toContain('run it themselves')
  })

  it('names the preset fix when approval prompts are disabled for the deployment', async () => {
    const h = await harness({}, { approval: { policy: 'never' } })
    const result = await h.call('bash', { command: 'git push --force origin master', description: 'force push' })

    expect(h.asked).toEqual([])
    expect(h.ran).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.text).toContain('danger-full-access')
    expect(result.text).toContain('permission.defaultPreset')
    expect(result.text).toContain('full-access-gated')
  })

  it('names the preset fix when the session itself switched to never', async () => {
    const h = await harness()
    setApprovalPolicy(h.agent.session, 'never')
    const result = await h.call('mcp__saturn-browser__keychain_get', { name: 'stripe' })

    expect(h.asked).toEqual([])
    expect(result.text).toContain('full-access-gated')
  })

  it('fails closed with a named reason when no approval seam is composed', async () => {
    const h = await harness({}, { mountApproval: false })
    const result = await h.call('bash', { command: 'git push --force origin master', description: 'force push' })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('no approval channel')
    expect(h.ran).toEqual([])
  })
})

describe('load-time validation', () => {
  it('rejects an invalid rule at plugin load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Gates, {
      rules: [{ id: 'bad', class: 'spend', tools: ['bash'], pattern: '([a-z', reason: 'r' }],
    })).rejects.toThrow(/invalid pattern/)
  })

  it('rejects an unknown action at plugin load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Gates, {
      rules: [{ id: 'bad-action', class: 'spend', action: 'allow' as 'ask', tools: ['bash'], reason: 'r' }],
    })).rejects.toThrow()
  })

  it('accepts a policy with only user rules', async () => {
    const h = await harness({
      includeDefaults: false,
      rules: [{ id: 'user-ls', class: 'destructive', tools: ['bash'], pattern: '^ls$', reason: 'Listing is gated on this machine.' }],
    })
    await h.call('bash', { command: 'ls', description: 'list' })
    expect(h.asked).toHaveLength(1)
    await h.call('bash', { command: 'git push --force origin master', description: 'force push' })
    expect(h.asked).toHaveLength(1)
  })
})
