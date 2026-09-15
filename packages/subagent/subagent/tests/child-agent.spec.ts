import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { childSessionMeta, resolveChildAgentOptions } from '../src/child-agent.ts'

function parentAgent(): Agent {
  const id = SessionId('parent')
  return {
    id,
    options: {
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 512,
    },
    session: Session.create(id),
  } as Agent
}

describe('child Agent options', () => {
  it('inherits the parent effort while the exact route is unchanged', () => {
    expect(resolveChildAgentOptions(parentAgent(), undefined, 1)).toEqual({
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: 'high',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('clears an inherited effort when the child route changes', () => {
    expect(resolveChildAgentOptions(parentAgent(), { model: 'child-model' }, 1)).toEqual({
      provider: 'parent-provider',
      model: 'child-model',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('keeps an explicit child effort when the child route changes', () => {
    expect(resolveChildAgentOptions(parentAgent(), {
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: ReasoningEffortId('max'),
    }, 1)).toEqual({
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: 'max',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('inherits the latest logged request selection over creation-time values', () => {
    const parent = parentAgent()
    parent.session.append('request/header', {
      header: {
        config: {
          provider: 'current-provider',
          model: 'current-model',
          reasoningEffort: ReasoningEffortId('low'),
        },
      },
      reason: 'initial',
    })

    expect(resolveChildAgentOptions(parent, undefined, 1)).toEqual({
      provider: 'current-provider',
      model: 'current-model',
      reasoningEffort: 'low',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })
})

describe('child session workspace', () => {
  /** A scope with no preset roster, which is what `ctx.get` must tolerate. */
  const presetlessScope = { get: () => undefined } as unknown as Agent['ctx']

  /** A parent whose durable header names the workspace every child inherits. */
  function parentIn(cwd: string): Agent {
    const id = SessionId('workspace-parent')
    const header: SessionHeader = { version: 0, id, createdAt: 0, cwd, isSeeded: false }
    return { id, options: {}, session: Session.create(id, undefined, header), ctx: presetlessScope } as Agent
  }

  it('inherits the parent workspace when the caller names none', () => {
    expect(childSessionMeta(parentIn('/work/project'), 1, false)).toMatchObject({ cwd: '/work/project' })
  })

  it('honors an explicit child workspace over the inherited one', () => {
    expect(childSessionMeta(parentIn('/work/project'), 1, false, '/work/worktrees/api'))
      .toMatchObject({ cwd: '/work/worktrees/api' })
  })

  it('keeps the inherited workspace for a blank explicit value', () => {
    expect(childSessionMeta(parentIn('/work/project'), 1, false, '')).toMatchObject({ cwd: '/work/project' })
  })

  it('omits the workspace entirely when neither side names one', () => {
    const id = SessionId('workspace-less-parent')
    const parent = { id, options: {}, session: Session.create(id), ctx: presetlessScope } as Agent
    expect('cwd' in childSessionMeta(parent, 1, false)).toBe(false)
  })
})
