/**
 * The plugin's own glue, driven end to end through the REAL services: a mounted
 * `ToolRuntime` dispatches `claim_scope` / `release_scope` / `claim_list` /
 * `claim_check`, a real `SystemPrompt` takes the policy section, and two real
 * sessions in one workspace contend for one file surface.
 *
 * This is the test the unit suites cannot be: `ledger.ts` proves the arithmetic
 * and `store.ts` proves the durable commit, and this proves the seams — that a
 * second writer is actually DENIED through the tool pipeline, that a lease
 * lapses and frees itself, and that two different workspaces never contend.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ClaimsPlugin from '../src/index.ts'
import { claimStore } from '../src/store.ts'
import type { ClaimLedger } from '../src/types.ts'

/** The branded call id the tool registry mints; the brand is a compile-time fact. */
type CallId = Parameters<Context['tools']['execute']>[0]['callId']

/** The agent shape the tool registry admits; only `session` is load-bearing here. */
interface ClaimAgent {
  readonly id: string
  readonly session: Session
}

/** One dispatched call's outcome, reduced to what these assertions read. */
interface CallOutcome {
  readonly isError: boolean
  readonly text: string
}

let work: string
let otherWork: string
let home: string
let previousHome: string | undefined

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'claims-plugin-work-'))
  otherWork = await mkdtemp(join(tmpdir(), 'claims-plugin-other-'))
  home = await mkdtemp(join(tmpdir(), 'claims-plugin-home-'))
  previousHome = process.env.DSH_HOME
  // The ledger must never be written into the real harness home.
  process.env.DSH_HOME = home
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(work, { recursive: true, force: true })
  await rm(otherWork, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/** One mounted host: the real services the plugin injects, plus the plugin. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // `ToolRuntime` requires `systemPrompt`, so the prompt service mounts first —
  // and it is also the service the policy section registers against.
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ClaimsPlugin)
  return ctx
}

/** A distinct live session, in this workspace or another one. */
function agentIn(ctx: Context, name: string, cwd: string = work): ClaimAgent {
  const session = ctx.sessions.create(SessionId(name), { meta: { cwd } })
  return { id: session.id, session }
}

let callCounter = 0

/** Dispatch one tool call the way the loop does, and reduce the outcome to text. */
async function call(ctx: Context, agent: ClaimAgent, name: string, args: unknown): Promise<CallOutcome> {
  const result = await ctx.tools.execute({
    callId: `call-${++callCounter}` as CallId,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: agent as never,
  })
  const blocks = result.content as readonly { readonly type: string; readonly text?: string }[]
  return {
    isError: result.isError,
    text: blocks.map(block => block.text ?? '').join('\n'),
  }
}

/** Take one claim and return its id, failing loudly when it was refused. */
async function claim(ctx: Context, agent: ClaimAgent, lane: string, scopes: readonly string[]): Promise<string> {
  const outcome = await call(ctx, agent, 'claim_scope', { lane, scopes })
  expect(outcome.isError, `claim_scope ${lane} should have been granted: ${outcome.text}`).toBe(false)
  const id = /"id":"([^"]+)"/u.exec(outcome.text)?.[1]
  if (id === undefined) throw new Error(`no claim id in ${outcome.text}`)
  return id
}

/** Rewrite the durable ledger for this workspace, to reach states a test cannot wait for. */
async function editLedger(mutate: (ledger: ClaimLedger) => ClaimLedger): Promise<void> {
  const store = claimStore()
  await store.mutate(work, ledger => ({ ledger: mutate(ledger), result: null }))
}

describe('claim_scope is a lock, not a note', () => {
  it('denies a second writer whose scope overlaps a live claim, and names the holder', async () => {
    const ctx = await mount()
    const first = agentIn(ctx, 'session-a')
    const second = agentIn(ctx, 'session-b')

    await claim(ctx, first, 'api', ['src/api'])

    // The specific case the Agent Teams task board misses: this task was never
    // marked in_progress, so an overlap against it would go unreported there.
    const denied = await call(ctx, second, 'claim_scope', { lane: 'handlers', scopes: ['src/api/handlers.ts'] })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED')
    expect(denied.text).toContain('session-a')

    // A genuinely unowned surface is still grantable to the second writer.
    const granted = await call(ctx, second, 'claim_scope', { lane: 'lib', scopes: ['lib'] })
    expect(granted.isError).toBe(false)
  })

  it('refuses a scope that is not workspace-relative, and claims nothing', async () => {
    const ctx = await mount()
    const agent = agentIn(ctx, 'session-a')

    const refused = await call(ctx, agent, 'claim_scope', { lane: 'escape', scopes: ['../outside'] })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('../outside')

    // Fail closed: nothing may be held after a refused proposal.
    const listed = await call(ctx, agent, 'claim_list', {})
    expect(listed.text).toContain('"claims":[]')
  })

  it('lets a holder re-claim its own lane instead of deadlocking against itself', async () => {
    const ctx = await mount()
    const agent = agentIn(ctx, 'session-a')

    const id = await claim(ctx, agent, 'api', ['src/api'])
    const extended = await call(ctx, agent, 'claim_scope', { lane: 'api', scopes: ['src/api/routes.ts'] })
    expect(extended.isError).toBe(false)
    expect(extended.text).toContain(id)
    expect(extended.text).toContain('src/api/routes.ts')
  })

  it('keeps two workspaces in separate ledgers, so different repos never contend', async () => {
    const ctx = await mount()
    const here = agentIn(ctx, 'session-a', work)
    const there = agentIn(ctx, 'session-b', otherWork)

    await claim(ctx, here, 'app', ['src'])
    // The same relative scope in a different repository is a different surface.
    const other = await call(ctx, there, 'claim_scope', { lane: 'app', scopes: ['src'] })
    expect(other.isError).toBe(false)
  })

  it('releases a surface on release_scope, so a waiting writer can take it', async () => {
    const ctx = await mount()
    const holder = agentIn(ctx, 'session-a')
    const waiter = agentIn(ctx, 'session-b')

    const id = await claim(ctx, holder, 'api', ['src/api'])
    expect((await call(ctx, waiter, 'claim_scope', { lane: 'take', scopes: ['src/api'] })).isError).toBe(true)

    const released = await call(ctx, holder, 'release_scope', { claim_id: id })
    expect(released.isError).toBe(false)

    expect((await call(ctx, waiter, 'claim_scope', { lane: 'take', scopes: ['src/api'] })).isError).toBe(false)
  })

  it('releases a lapsed lease and reports it, so an abandoned lane frees itself', async () => {
    const ctx = await mount()
    const abandoned = agentIn(ctx, 'session-a')
    const waiter = agentIn(ctx, 'session-b')

    await claim(ctx, abandoned, 'api', ['src/api'])
    // Reaching a lapsed lease by waiting two hours is not a test; writing the
    // clock back is.
    await editLedger(ledger => ({
      ...ledger,
      claims: ledger.claims.map(claim => ({ ...claim, expiresAt: Date.now() - 1 })),
    }))

    const listed = await call(ctx, waiter, 'claim_list', {})
    expect(listed.text).toContain('"claims":[]')
    expect(listed.text).toContain('"expired":[{')

    // And the surface is genuinely free again, not just omitted from the view.
    expect((await call(ctx, waiter, 'claim_scope', { lane: 'take', scopes: ['src/api'] })).isError).toBe(false)
  })
})

describe('claim_check reports drift before a write burst', () => {
  it('reports a file created after the claim, then settles once it is rebased', async () => {
    const ctx = await mount()
    const agent = agentIn(ctx, 'session-a')
    const id = await claim(ctx, agent, 'app', ['src/app.ts'])

    // The claim observed an absent path; the file appearing is a creation.
    await mkdir(join(work, 'src'), { recursive: true })
    await writeFile(join(work, 'src', 'app.ts'), 'first\n')

    const first = await call(ctx, agent, 'claim_check', { claim_id: id })
    expect(first.isError).toBe(false)
    expect(first.text).toContain('"kind":"created"')

    // A second check rebases onto the new identity: no news is not drift.
    const second = await call(ctx, agent, 'claim_check', { claim_id: id })
    expect(second.text).toContain('"findings":[]')
  })

  it('reports a file that moved since the last observation', async () => {
    const ctx = await mount()
    const agent = agentIn(ctx, 'session-a')
    await mkdir(join(work, 'src'), { recursive: true })
    await writeFile(join(work, 'src', 'app.ts'), 'v1\n')

    const id = await claim(ctx, agent, 'app', ['src/app.ts'])
    // Someone else writes the same file between the claim and the write burst.
    await writeFile(join(work, 'src', 'app.ts'), 'v2 written by another hand\n')

    const checked = await call(ctx, agent, 'claim_check', { claim_id: id })
    expect(checked.text).toContain('"kind":"moved"')
  })

  it('refuses to check a claim that has lapsed, telling the caller to re-take it', async () => {
    const ctx = await mount()
    const agent = agentIn(ctx, 'session-a')
    const id = await claim(ctx, agent, 'app', ['src'])
    await editLedger(ledger => ({
      ...ledger,
      claims: ledger.claims.map(claim => ({ ...claim, expiresAt: Date.now() - 1 })),
    }))

    const checked = await call(ctx, agent, 'claim_check', { claim_id: id })
    expect(checked.isError).toBe(true)
    expect(checked.text).toContain('lapsed')
  })
})
