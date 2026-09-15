/**
 * Worktree isolation, proved against real git repositories on this platform.
 *
 * Until now every teammate ran in the Lead's exact directory: same process,
 * same checkout, same bytes. The claim ledger denied colliding first-party
 * writes, but two members still shared one working tree, so a formatter, a
 * code generator, or a half-finished refactor from one member was immediately
 * visible to — and breakable by — every other one.
 *
 * `isolation: "worktree"` gives a teammate its own `git worktree` checked out
 * from the Lead's HEAD, and `merge_teammate` is the only road back: the diff
 * is collected, every touched path is checked against the shared claim ledger,
 * and the patch is applied whole or not at all. These tests use real
 * repositories and real worktrees because the failure modes worth catching —
 * Windows path spelling, a patch that does not apply, a worktree that outlives
 * its team — are exactly the ones a mocked git cannot produce.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ClaimsPlugin from '../../claims/src/index.ts'
import TeamService, { TeamError } from '../src/index.ts'
import { WorktreeManager } from '../src/worktree.ts'
import { TestSessionQuery } from './test-session-query.ts'

const run = promisify(execFile)
const SIGNAL = new AbortController().signal
const scratch: string[] = []

let repo: string
let worktreeRoot: string
let home: string
let previousHome: string | undefined
let callCounter = 0

/** A disposable directory removed after the test that made it. */
function scratchDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(path)
  return path
}

/** A real repository with one commit, which is what `git worktree add` needs. */
async function initRepository(path: string): Promise<void> {
  await run('git', ['init', '-b', 'main', path])
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'src', 'app.ts'), 'original\n')
  await run('git', ['-C', path, 'add', '-A'])
  await run('git', [
    '-C', path, '-c', 'user.name=team-test', '-c', 'user.email=team@localhost',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'base',
  ])
}

beforeEach(async () => {
  repo = scratchDir('dsh-team-repo-')
  worktreeRoot = scratchDir('dsh-team-worktrees-')
  home = scratchDir('dsh-team-home-')
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await initRepository(repo)
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  // A leftover registered worktree would keep its directory pinned on Windows.
  try { await run('git', ['-C', repo, 'worktree', 'prune']) } catch { /* the repository may already be gone */ }
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function setup(workspace: string = repo, withClaims = false) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: scratchDir('dsh-team-sessions-') })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  if (withClaims) await ctx.plugin(ClaimsPlugin)
  const teamFiber = await ctx.plugin(TeamService, { worktreeRoot })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang']))
  const lead = ctx.agentLoop.create(SessionId('worktree-lead'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
  return { ctx, lead, teamFiber }
}

function spawn(ctx: Context, lead: Agent, name: string, isolation?: 'shared' | 'worktree') {
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: [{ type: 'text' as const, text: `${name} initial` }],
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
    ...isolation === undefined ? {} : { isolation },
  })
}

/** The live child session's workspace, which is what isolation is about. */
function childCwd(ctx: Context, id: SessionId): string | undefined {
  return ctx.agents.get(id)?.session.header.cwd
}

/** Take a claim through the real claim tool, as its holder's session. */
async function claimAs(ctx: Context, agent: Agent, lane: string, scopes: readonly string[]): Promise<void> {
  const result = await ctx.tools.execute({
    callId: `team-claim-${++callCounter}` as Parameters<Context['tools']['execute']>[0]['callId'],
    name: 'claim_scope',
    arguments: { lane, scopes },
    signal: SIGNAL,
    agent,
  })
  const blocks = result.content as readonly { readonly text?: string }[]
  expect(result.isError, blocks.map(block => block.text ?? '').join('\n')).toBe(false)
}

describe('worktree lifecycle', () => {
  it('creates a checkout of HEAD, collects its diff, applies it whole, and removes it', async () => {
    const manager = new WorktreeManager(worktreeRoot)
    const record = await manager.create(repo, 'team-1', 'builder', SIGNAL)
    expect(record.path.startsWith(resolve(worktreeRoot))).toBe(true)
    expect(existsSync(join(record.path, 'src', 'app.ts'))).toBe(true)

    await writeFile(join(record.path, 'src', 'app.ts'), 'teammate edit\n')
    await writeFile(join(record.path, 'src', 'new.ts'), 'brand new\n')
    const change = await manager.collect(record.path, SIGNAL)
    expect(change.paths.sort()).toEqual(['src/app.ts', 'src/new.ts'])

    await manager.apply(repo, change.patch, SIGNAL)
    expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('teammate edit\n')
    expect(await readFile(join(repo, 'src', 'new.ts'), 'utf8')).toBe('brand new\n')

    await manager.remove(repo, record.path, SIGNAL)
    expect(existsSync(record.path)).toBe(false)
  })

  it('reports no change for an untouched worktree', async () => {
    const manager = new WorktreeManager(worktreeRoot)
    const record = await manager.create(repo, 'team-1', 'idle', SIGNAL)
    const change = await manager.collect(record.path, SIGNAL)
    expect(change.paths).toEqual([])
    expect(change.patch).toBe('')
    await manager.remove(repo, record.path, SIGNAL)
  })
})

describe('teammate isolation', () => {
  it('gives a worktree teammate its own checkout and records it on the roster', async () => {
    const { ctx, lead } = await setup()
    const { member } = await spawn(ctx, lead, 'isolated', 'worktree')
    expect(member.isolation).toBe('worktree')
    const path = member.worktree?.path
    expect(path).toBeDefined()
    expect(existsSync(join(String(path), 'src', 'app.ts'))).toBe(true)
    expect(childCwd(ctx, member.id)).toBe(path)
    expect(ctx.agentTeams.listMembers(lead).find(row => row.name === 'isolated')?.worktree?.path).toBe(path)
  })

  it('keeps the Lead checkout for the default shared isolation', async () => {
    const { ctx, lead } = await setup()
    const { member } = await spawn(ctx, lead, 'shared-mate')
    expect(member.isolation).toBe('shared')
    expect(member.worktree).toBeUndefined()
    expect(childCwd(ctx, member.id)).toBe(repo)
  })

  it('refuses worktree isolation when the workspace is not a git repository', async () => {
    const plain = scratchDir('dsh-team-plain-')
    const { ctx, lead } = await setup(plain)
    await expect(spawn(ctx, lead, 'nowhere', 'worktree')).rejects.toThrow(TeamError)
    // The refusal happens before anything durable is written, so the name is
    // still free and no half-provisioned row is left on the roster.
    expect(ctx.agentTeams.listMembers(lead).some(row => row.name === 'nowhere')).toBe(false)
  })

  it('removes every worktree when the Team runtime disposes', async () => {
    const { ctx, lead, teamFiber } = await setup()
    const { member } = await spawn(ctx, lead, 'disposable', 'worktree')
    const path = String(member.worktree?.path)
    expect(existsSync(path)).toBe(true)
    await teamFiber.dispose()
    expect(existsSync(path)).toBe(false)
  })
})

describe('merge_teammate', () => {
  it('applies a teammate diff into the Lead workspace and reports the files', async () => {
    const { ctx, lead } = await setup()
    const { member } = await spawn(ctx, lead, 'writer', 'worktree')
    await writeFile(join(String(member.worktree?.path), 'src', 'app.ts'), 'merged from the teammate\n')

    const merged = await ctx.agentTeams.mergeTeammate(lead, { target: 'writer', signal: SIGNAL })
    expect(merged.status).toBe('merged')
    expect(merged.files).toEqual(['src/app.ts'])
    expect(merged.conflicts).toEqual([])
    expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('merged from the teammate\n')
  })

  it('reports an untouched teammate as unchanged instead of merging nothing', async () => {
    const { ctx, lead } = await setup()
    await spawn(ctx, lead, 'quiet', 'worktree')
    const merged = await ctx.agentTeams.mergeTeammate(lead, { target: 'quiet', signal: SIGNAL })
    expect(merged.status).toBe('unchanged')
    expect(merged.files).toEqual([])
  })

  it('denies the second teammate while the first holds the claim, and applies nothing', async () => {
    const { ctx, lead } = await setup(repo, true)
    const first = await spawn(ctx, lead, 'one', 'worktree')
    const second = await spawn(ctx, lead, 'two', 'worktree')
    const firstAgent = ctx.agents.get(first.member.id)
    const secondAgent = ctx.agents.get(second.member.id)
    expect(firstAgent).toBeDefined()
    expect(secondAgent).toBeDefined()

    // Both teammates edit the same surface in their own isolated checkouts.
    await writeFile(join(String(first.member.worktree?.path), 'src', 'app.ts'), 'first hand\n')
    await writeFile(join(String(second.member.worktree?.path), 'src', 'app.ts'), 'second hand\n')

    // The first declares ownership of the shared surface from inside its worktree.
    await claimAs(ctx, firstAgent as Agent, 'app', ['src/app.ts'])

    const denied = await ctx.agentTeams.mergeTeammate(lead, { target: 'two', signal: SIGNAL })
    expect(denied.status).toBe('denied')
    expect(denied.files).toEqual(['src/app.ts'])
    expect(denied.conflicts.map(conflict => conflict.path)).toEqual(['src/app.ts'])
    expect(denied.conflicts[0]?.holder).toContain(String(first.member.id))
    expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('original\n')

    // The holder's own work is never blocked by its own lease.
    const allowed = await ctx.agentTeams.mergeTeammate(lead, { target: 'one', signal: SIGNAL })
    expect(allowed.status).toBe('merged')
    expect(await readFile(join(repo, 'src', 'app.ts'), 'utf8')).toBe('first hand\n')
  })

  it('refuses to merge a teammate that has no worktree', async () => {
    const { ctx, lead } = await setup()
    await spawn(ctx, lead, 'shared-mate')
    await expect(ctx.agentTeams.mergeTeammate(lead, { target: 'shared-mate', signal: SIGNAL }))
      .rejects.toThrow(TeamError)
  })
})
