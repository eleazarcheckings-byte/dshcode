import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as Persona from '@deepseek-ai/dsh-persona'
import { afterEach, describe, expect, it } from 'vitest'
import * as PremiumOutput from '../src/index.ts'
import { PREMIUM_OUTPUT_POLICY } from '../src/policy.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(withTools = true): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SystemPrompt)
  if (withTools) await ctx.plugin(ToolRuntime)
  return ctx
}

async function agentScope(ctx: Context): Promise<{ agent: Agent; scope: Scope }> {
  const agent = { id: SessionId('quality-test') } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt', 'skills'],
  }))
  return { agent, scope }
}

function registerSkillTool(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'skill',
    description: 'Load a guide.',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text', text: 'guide' }]),
  }))
}

describe('packaged premium output guidance', () => {
  it('loads shipped bodies with usable resource directories and removes all contributions on disposal', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(PremiumOutput)
    const skills = await ctx.skills.list()
    expect(skills.map(skill => skill.name)).toEqual([
      'premium-deliverables', 'premium-web-experience', 'purposeful-motion',
    ])
    for (const summary of skills) {
      const skill = await ctx.skills.get(summary.name)
      const directory = fileURLToPath(new URL(`../skills/${summary.name}/`, import.meta.url))
      const body = await readFile(new URL(`../skills/${summary.name}/SKILL.md`, import.meta.url), 'utf8')
      expect(skill).toMatchObject({
        source: 'bundled', provider: 'premium-output', content: body,
        invocation: { modelInvocable: true, userInvocable: true },
        resourceBase: { kind: 'directory', path: directory },
      })
      expect(body.trim().length).toBeGreaterThan(0)
    }
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(PREMIUM_OUTPUT_POLICY)
    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'saturn:output-quality')).toBe(false)
  })

  it('lets project/user registrations replace a bundled guide', async () => {
    const ctx = await setup()
    await ctx.plugin(PremiumOutput)
    ctx.skills.registerProvider(() => ({
      name: 'project-quality',
      list: () => Promise.resolve([{
        name: 'premium-web-experience', description: 'Project design rules', source: 'project-dsh',
        provider: 'project-quality', rank: 100, locator: null,
        invocation: { modelInvocable: true, userInvocable: true },
      }]),
      get: () => Promise.resolve({
        name: 'premium-web-experience', description: 'Project design rules', source: 'project-dsh',
        provider: 'project-quality', invocation: { modelInvocable: true, userInvocable: true },
        content: 'Use the existing editorial design system.',
      }),
    }))
    expect((await ctx.skills.get('premium-web-experience'))?.content).toBe('Use the existing editorial design system.')
    expect(await ctx.skills.list()).toHaveLength(3)
  })

  it('adds guide routing only when the viewing agent can use skill', async () => {
    const ctx = await setup()
    await ctx.plugin(PremiumOutput)
    registerSkillTool(ctx)
    const { agent, scope } = await agentScope(ctx)
    const assemble = () => ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(renderPrompt(await assemble())).toContain('load the relevant available skill')
    const restore = scope.ctx.tools.restrict({ deny: ['skill'] })
    expect(renderPrompt(await assemble())).not.toContain('load the relevant available skill')
    expect(renderPrompt(await assemble())).toContain(PREMIUM_OUTPUT_POLICY)
    restore()
    expect(renderPrompt(await assemble())).toContain('load the relevant available skill')
  })

  it('keeps a standalone policy without a tool registry', async () => {
    const ctx = await setup(false)
    await ctx.plugin(PremiumOutput)
    const agent = { id: SessionId('no-tools') } as Agent
    const assembly = await ctx.systemPrompt.assemble({ agent })
    expect(assembly.sections.find(section => section.name === 'saturn:output-quality')?.text).toBe(PREMIUM_OUTPUT_POLICY)
  })

  it('supports deployment policy replacement and complete custom persona opt-out', async () => {
    const ctx = await setup()
    await ctx.plugin(PremiumOutput, { policy: 'Preserve the customer’s design system.' })
    const { agent, scope } = await agentScope(ctx)
    await scope.ctx.plugin(Persona, { text: 'Custom specialist.' })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ agent, scope: agent }))).toContain('Preserve the customer’s design system.')
    scope.ctx.systemPrompt.section({ name: 'custom:complete', order: -1, text: 'Exact complete prompt.', complete: true })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ agent, scope: agent }))).toBe('Exact complete prompt.')
  })

  it('can disable all packaged contributions without disabling the skill service', async () => {
    const ctx = await setup()
    await ctx.plugin(PremiumOutput, { enabled: false })
    expect(await ctx.skills.list()).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name)).not.toContain('saturn:output-quality')
  })

  it('rejects invalid deployment settings through the public config schema', () => {
    // Loader configuration is untyped before this parser receives it.
    const parse = PremiumOutput.Config as (input: unknown) => PremiumOutput.Config
    expect(() => parse({ enabled: 'yes' })).toThrow()
    expect(() => parse({ policy: '' })).toThrow()
    expect(() => parse({ policy: 42 })).toThrow()
  })

  it('pins the standalone model policy verbatim', async () => {
    await expect(PREMIUM_OUTPUT_POLICY).toMatchFileSnapshot('./expected/output-policy.md')
  })
})
