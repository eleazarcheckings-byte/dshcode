import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import * as Gates from '../src/index.ts'
import type { Config } from '../src/index.ts'

/**
 * WHAT THE HUMAN IS ASKED, on the one composition where two approval paths
 * meet: a Gate-class shell command that also carries its own sandbox
 * escalation. One question is the requirement; WHICH question it is decides
 * whether the human is consenting to the gated act or to a sandbox detail.
 * These cases pin the three outcomes the README now documents — junk cannot
 * suppress the Gate, a real escalation carries the single prompt and does not
 * name the class, and turning the deferral off puts the class back in front of
 * the human at the cost of a second question.
 */

let counter = 0

/** A session with an open turn, which is the approval service's precondition. */
function fakeAgent(): Agent {
  counter += 1
  const session = Session.create(SessionId(`gates-consent-${counter}`))
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

interface Harness {
  asked: ApprovalRequest[]
  ran: string[]
  call: (args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>
}

/**
 * The core spine, the real approval service, the Gate, and a `bash` fixture
 * that mirrors `@deepseek-ai/dsh-tool-bash`: a call carrying
 * `sandbox_permissions` resolves one approval through the shared
 * `approveEscalation` helper before the command body runs.
 */
async function harness(config: Config = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService, {})
  await ctx.plugin(Gates, config)

  const asked: ApprovalRequest[] = []
  const ran: string[] = []
  ctx.on('approval/request', (request) => {
    asked.push(request)
    return Promise.resolve('allowed-once' as const)
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

  const agent = fakeAgent()
  let sequence = 0
  return {
    asked,
    ran,
    async call(args) {
      sequence += 1
      const result = await ctx.tools.execute({
        callId: ToolCallId(`consent-${sequence}`),
        name: 'bash',
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
      const first = result.content[0]
      return { isError: result.isError, text: first?.type === 'text' ? first.text : '' }
    },
  }
}

const FORCE_PUSH = { command: 'git push --force origin master', description: 'force push' }

describe('a claimed escalation the sandbox would never honour cannot suppress the Gate', () => {
  it('asks the Gate question, naming the class and the rule, when the mode is junk', async () => {
    const h = await harness()
    const result = await h.call({ ...FORCE_PUSH, sandbox_permissions: 'bogus-not-a-mode', justification: 'trust me' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]?.reason).toContain('publish')
    expect(h.asked[0]?.reason).toContain('publish-git-force-push')
    expect(h.asked[0]?.reason).toContain('remote history')
    // The sandbox family rejects the junk mode on its own widening check, so
    // the command still never runs — the Gate's question was the honest one.
    expect(result.isError).toBe(true)
    expect(h.ran).toEqual([])
  })

  it('asks the Gate question when the escalation carries no justification', async () => {
    const h = await harness()
    await h.call({ ...FORCE_PUSH, sandbox_permissions: 'danger-full-access' })
    expect(h.asked[0]?.reason).toContain('publish-git-force-push')
  })
})

describe('the documented asymmetry when the escalation is real', () => {
  it('raises one prompt, and that prompt is the sandbox question rather than the Gate class', async () => {
    const h = await harness()
    const result = await h.call({ ...FORCE_PUSH, sandbox_permissions: 'danger-full-access', justification: 'the remote lives outside the workspace' })

    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]?.reason).toContain('escalate sandbox to danger-full-access')
    // Pinned deliberately: this is the limitation the README states, not an
    // accident. If the deferral ever names the class, that sentence changes too.
    expect(h.asked[0]?.reason).not.toContain('publish-git-force-push')
    expect(result.isError).toBe(false)
    expect(h.ran).toEqual(['git push --force origin master'])
  })

  it('puts the class back in front of the human when the deployment turns the deferral off', async () => {
    const h = await harness({ deferToSandboxEscalation: false })
    await h.call({ ...FORCE_PUSH, sandbox_permissions: 'danger-full-access', justification: 'the remote lives outside the workspace' })

    expect(h.asked).toHaveLength(2)
    expect(h.asked.some(request => request.reason?.includes('publish-git-force-push') ?? false)).toBe(true)
    expect(h.asked.some(request => request.reason?.includes('escalate sandbox to danger-full-access') ?? false)).toBe(true)
  })
})
