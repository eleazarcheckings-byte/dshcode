/**
 * The model-facing half of worktree isolation: the `isolation` argument on
 * `spawn_teammate`, and `merge_teammate` as the only road back from an
 * isolated checkout.
 *
 * The assertions are deliberately about what the MODEL sees — the schema it is
 * offered, the JSON it gets back, and the refusal text it must act on — because
 * a merge that fails silently, or a denial the model reads as a warning, puts
 * the collision back exactly where isolation was supposed to remove it.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

const run = promisify(execFile)
const scratch: string[] = []
let repo: string
let worktreeRoot: string
let calls = 0

/** Session query implementation whose search faces are outside these tests. */
class QuietSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

function scratchDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(path)
  return path
}

beforeEach(async () => {
  repo = scratchDir('dsh-tool-team-repo-')
  worktreeRoot = scratchDir('dsh-tool-team-worktrees-')
  await run('git', ['init', '-b', 'main', repo])
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'app.ts'), 'original\n')
  await run('git', ['-C', repo, 'add', '-A'])
  await run('git', [
    '-C', repo, '-c', 'user.name=tool-team-test', '-c', 'user.email=team@localhost',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'base',
  ])
})

afterEach(async () => {
  try { await run('git', ['-C', repo, 'worktree', 'prune']) } catch { /* the repository may already be gone */ }
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function setup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: scratchDir('dsh-tool-team-sessions-') })
  await ctx.plugin(QuietSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService, { worktreeRoot })
  await ctx.plugin(toolTeam)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang']))
  const lead = ctx.agentLoop.create(SessionId('tool-worktree-lead'), { provider: 'mock', model: 'mock' }, { cwd: repo })
  return { ctx, lead }
}

async function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`worktree-tool-${++calls}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent,
  })
  const blocks = result.content as readonly { readonly text?: string }[]
  return { isError: result.isError, text: blocks.map(block => block.text ?? '').join('\n') }
}

it('offers isolation on spawn_teammate and merge_teammate to the Lead, and states the protocol', async () => {
  const { ctx, lead } = await setup()
  const scope = scopeOf(lead.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  const assembly = await ctx.systemPrompt.assemble({ scope })
  expect(assembly.tools.map(schema => schema.name)).toContain('merge_teammate')
  const spawnSchema = assembly.tools.find(schema => schema.name === 'spawn_teammate')
  expect(JSON.stringify(spawnSchema)).toContain('worktree')
  expect(JSON.stringify(spawnSchema)).toContain('Defaults to worktree')
  const prompt = renderPrompt(assembly)
  expect(prompt).toContain('merge_teammate')
  expect(prompt).toContain('isolated in a private git worktree')
  expect(prompt).toContain('Isolation "shared" is opt-in')
})

it('spawns an isolated teammate and merges its work back through the tool surface', async () => {
  const { ctx, lead } = await setup()
  const spawned = await execute(ctx, lead, 'spawn_teammate', {
    name: 'isolated-writer',
    description: 'own checkout',
    prompt: 'stay available',
    isolation: 'worktree',
  })
  expect(spawned.isError, spawned.text).toBe(false)
  const view = JSON.parse(spawned.text) as { member: { worktree?: { path: string }; isolation?: string } }
  expect(view.member.isolation).toBe('worktree')
  const path = view.member.worktree?.path
  expect(path).toBeDefined()

  await writeFile(join(String(path), 'src', 'app.ts'), 'from the isolated teammate\n')
  const merged = await execute(ctx, lead, 'merge_teammate', { target: 'isolated-writer' })
  expect(merged.isError, merged.text).toBe(false)
  expect(JSON.parse(merged.text)).toMatchObject({ status: 'merged', files: ['src/app.ts'] })
  expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('from the isolated teammate\n')
})

it('defaults spawn_teammate to worktree isolation', async () => {
  const { ctx, lead } = await setup()
  const spawned = await execute(ctx, lead, 'spawn_teammate', {
    name: 'default-writer',
    description: 'default isolation',
    prompt: 'stay available',
  })
  expect(spawned.isError, spawned.text).toBe(false)
  const view = JSON.parse(spawned.text) as { member: { isolation?: string; worktree?: { path: string } } }
  expect(view.member.isolation).toBe('worktree')
  expect(view.member.worktree?.path).toBeDefined()
})

it('refuses merge_teammate for a teammate that shares the Lead checkout', async () => {
  const { ctx, lead } = await setup()
  await execute(ctx, lead, 'spawn_teammate', {
    name: 'shared-mate',
    description: 'shared',
    prompt: 'stay available',
    isolation: 'shared',
  })
  const refused = await execute(ctx, lead, 'merge_teammate', { target: 'shared-mate' })
  expect(refused.isError).toBe(true)
  expect(refused.text).toContain('shared')
})
