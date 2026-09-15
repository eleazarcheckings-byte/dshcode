/**
 * Isolation when the Lead does not sit at the repository root.
 *
 * `git worktree add` always checks out the whole repository, so an isolated
 * teammate handed the checkout ROOT is standing one or more directories above
 * where its Lead stands. Nothing visible breaks — the child can still read and
 * write its own files — but the claim ledger quietly splits in two: claims are
 * recorded against a workspace, the child's workspace resolves to the
 * repository root, the Lead's resolves to `<repo>/<sub>`, and a lease taken in
 * one is invisible in the other. `merge_teammate` then reports no conflict and
 * applies straight over a peer's claimed surface, which is the exact loss the
 * claim ledger exists to prevent, arriving through the feature meant to
 * prevent it.
 *
 * So the child is handed the directory inside its checkout that CORRESPONDS to
 * the Lead's workspace. These tests put the Lead in `<repo>/app` and prove both
 * halves: the child's workspace lands at `<checkout>/app`, and a claim taken
 * there is honored by a merge run from the Lead.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import TeamService from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const run = promisify(execFile)
const SIGNAL = new AbortController().signal
const scratch: string[] = []

/** The repository-relative directory the Lead session stands in. */
const SUBDIRECTORY = 'app'

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

/** A real repository whose interesting files live one directory below the root. */
async function initRepository(path: string): Promise<void> {
  await run('git', ['init', '-b', 'main', path])
  await mkdir(join(path, SUBDIRECTORY, 'src'), { recursive: true })
  await writeFile(join(path, SUBDIRECTORY, 'src', 'app.ts'), 'original\n')
  await writeFile(join(path, 'README.md'), 'root\n')
  await run('git', ['-C', path, 'add', '-A'])
  await run('git', [
    '-C', path, '-c', 'user.name=team-test', '-c', 'user.email=team@localhost',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'base',
  ])
}

beforeEach(async () => {
  repo = scratchDir('dsh-team-subrepo-')
  worktreeRoot = scratchDir('dsh-team-subworktrees-')
  home = scratchDir('dsh-team-subhome-')
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await initRepository(repo)
  ClaimsPlugin.resetClaimWorkspaces()
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  ClaimsPlugin.resetClaimWorkspaces()
  // A leftover registered worktree would keep its directory pinned on Windows.
  try { await run('git', ['-C', repo, 'worktree', 'prune']) } catch { /* the repository may already be gone */ }
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** A host whose Lead session stands in `<repo>/app` rather than at the root. */
async function setup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: scratchDir('dsh-team-subsessions-') })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(ClaimsPlugin)
  await ctx.plugin(TeamService, { worktreeRoot })
  // One script entry per model call: every teammate this suite spawns must have
  // a turn of its own to hang on, or it settles and its Agent disappears.
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang', 'hang', 'hang', 'hang']))
  const lead = ctx.agentLoop.create(
    SessionId('worktree-sub-lead'),
    { provider: 'mock', model: 'mock' },
    { cwd: join(repo, SUBDIRECTORY) },
  )
  return { ctx, lead }
}

function spawn(ctx: Context, lead: Agent, name: string) {
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: [{ type: 'text' as const, text: `${name} initial` }],
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
    isolation: 'worktree',
  })
}

/** Take a claim through the real claim tool, as its holder's session. */
async function claimAs(ctx: Context, agent: Agent, lane: string, scopes: readonly string[]): Promise<void> {
  const result = await ctx.tools.execute({
    callId: `team-sub-claim-${++callCounter}` as Parameters<Context['tools']['execute']>[0]['callId'],
    name: 'claim_scope',
    arguments: { lane, scopes },
    signal: SIGNAL,
    agent,
  })
  const blocks = result.content as readonly { readonly text?: string }[]
  expect(result.isError, blocks.map(block => block.text ?? '').join('\n')).toBe(false)
}

describe('worktree isolation below the repository root', () => {
  it('stands the teammate in the checkout directory matching the Lead workspace', async () => {
    const { ctx, lead } = await setup()
    const { member } = await spawn(ctx, lead, 'isolated')
    const checkout = String(member.worktree?.path)
    // The roster still records the checkout itself, which is what collect and
    // remove operate on; only the child's own workspace moves.
    expect(existsSync(join(checkout, SUBDIRECTORY, 'src', 'app.ts'))).toBe(true)
    expect(ctx.agents.get(member.id)?.session.header.cwd).toBe(join(checkout, SUBDIRECTORY))
  })

  it('honors a peer claim taken inside a worktree when the Lead merges from a subdirectory', async () => {
    const { ctx, lead } = await setup()
    const first = await spawn(ctx, lead, 'one')
    const second = await spawn(ctx, lead, 'two')
    const firstAgent = ctx.agents.get(first.member.id)
    expect(firstAgent).toBeDefined()

    const target = join(SUBDIRECTORY, 'src', 'app.ts')
    await writeFile(join(String(first.member.worktree?.path), target), 'first hand\n')
    await writeFile(join(String(second.member.worktree?.path), target), 'second hand\n')

    // The claim is spelled relative to the claimant's own workspace, which is
    // the Lead's workspace seen through the checkout.
    await claimAs(ctx, firstAgent as Agent, 'app', ['src/app.ts'])

    const denied = await ctx.agentTeams.mergeTeammate(lead, { target: 'two', signal: SIGNAL })
    expect(denied.status).toBe('denied')
    expect(denied.files).toEqual(['src/app.ts'])
    expect(denied.conflicts.map(conflict => conflict.path)).toEqual(['src/app.ts'])
    expect(denied.conflicts[0]?.holder).toContain(String(first.member.id))
    expect(await readFile(join(repo, target), 'utf8')).toBe('original\n')

    // The holder's own diff is never blocked by its own lease.
    const allowed = await ctx.agentTeams.mergeTeammate(lead, { target: 'one', signal: SIGNAL })
    expect(allowed.status).toBe('merged')
    expect(await readFile(join(repo, target), 'utf8')).toBe('first hand\n')
  })
})
