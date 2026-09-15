/**
 * Claim space across linked git worktrees, proved against real repositories.
 *
 * A worktree gives a teammate physical isolation: its own checkout, its own
 * index, its own bytes. What it must NOT give it is a private notion of
 * ownership — two teammates each holding `src/app.ts` in their own checkout
 * and each believing they own it is the same lost-work collision the ledger
 * exists to prevent, arriving later and costing more, because both diffs are
 * already written before anyone finds out.
 *
 * So the ledger is keyed by the repository's MAIN worktree: every linked
 * worktree of one repository reads and writes one ledger, and a scope names
 * the same repository-relative surface in all of them. A plain directory that
 * is not a linked worktree keys on itself exactly as before.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ClaimsPlugin from '../src/index.ts'
import { claimWorkspace } from '../src/workspace.ts'

const run = promisify(execFile)

/** The branded call id the tool registry mints; the brand is a compile-time fact. */
type CallId = Parameters<Context['tools']['execute']>[0]['callId']

interface ClaimAgent {
  readonly id: string
  readonly session: Session
}

let repo: string
let home: string
let previousHome: string | undefined
let callCounter = 0

/** Create a real repository with one commit, so `git worktree add` has a base. */
async function initRepository(path: string): Promise<void> {
  await run('git', ['init', '-b', 'main', path])
  await writeFile(join(path, 'README.md'), 'base\n')
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'src', 'app.ts'), 'original\n')
  await run('git', ['-C', path, 'add', '-A'])
  await run('git', [
    '-C', path, '-c', 'user.name=claims-test', '-c', 'user.email=claims@localhost',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'base',
  ])
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'claims-repo-'))
  home = await mkdtemp(join(tmpdir(), 'claims-repo-home-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await initRepository(repo)
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(repo, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ClaimsPlugin)
  return ctx
}

function agentIn(ctx: Context, name: string, cwd: string): ClaimAgent {
  const session = ctx.sessions.create(SessionId(name), { meta: { cwd } })
  return { id: session.id, session }
}

async function call(ctx: Context, agent: ClaimAgent, name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    callId: `space-${++callCounter}` as CallId,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: agent as never,
  })
  const blocks = result.content as readonly { readonly type: string; readonly text?: string }[]
  return { isError: result.isError, text: blocks.map(block => block.text ?? '').join('\n') }
}

/** Add a linked worktree and return its absolute path. */
async function addWorktree(name: string): Promise<string> {
  const path = join(repo, '..', `${name}-${Date.now()}`)
  await run('git', ['-C', repo, 'worktree', 'add', '--detach', path, 'HEAD'])
  return resolve(path)
}

it('resolves a linked worktree into the repository main worktree, and leaves a plain directory alone', async () => {
  const worktree = await addWorktree('space-resolve')
  try {
    expect(await claimWorkspace(worktree)).toBe(await claimWorkspace(repo))
    expect(await claimWorkspace(join(worktree, 'src'))).toBe(resolve(repo, 'src'))
    expect(await claimWorkspace(home)).toBe(resolve(home))
  } finally {
    await run('git', ['-C', repo, 'worktree', 'remove', '--force', worktree])
  }
})

it('denies a second worktree the surface a first worktree already claims', async () => {
  const ctx = await mount()
  const first = await addWorktree('space-first')
  const second = await addWorktree('space-second')
  try {
    const one = agentIn(ctx, 'worktree-one', first)
    const two = agentIn(ctx, 'worktree-two', second)

    const granted = await call(ctx, one, 'claim_scope', { lane: 'app', scopes: ['src/app.ts'] })
    expect(granted.isError, granted.text).toBe(false)

    const denied = await call(ctx, two, 'claim_scope', { lane: 'app', scopes: ['src'] })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED')
    expect(denied.text).toContain(one.id)

    // And the Lead, working in the repository itself, sees the same lease.
    const lead = agentIn(ctx, 'repo-lead', repo)
    expect((await call(ctx, lead, 'claim_list', {})).text).toContain('src/app.ts')
  } finally {
    await run('git', ['-C', repo, 'worktree', 'remove', '--force', first])
    await run('git', ['-C', repo, 'worktree', 'remove', '--force', second])
  }
})
