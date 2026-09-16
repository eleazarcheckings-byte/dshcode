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

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as StringEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import * as ClaimsPlugin from '../src/index.ts'
import { claimStore } from '../src/store.ts'
import { AUTO_CLAIM_LANE, AUTO_CLAIM_NOTE } from '../src/auto-claim.ts'
import { DEFAULT_TTL_MS } from '../src/ledger.ts'
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
  await ctx.plugin(LocalFileSystem, { cwd: work })
  await ctx.plugin(ToolFs)
  await ctx.plugin(StringEditor)
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

  it('prevents another session from releasing or rebasing the holder claim', async () => {
    const ctx = await mount()
    const holder = agentIn(ctx, 'session-a')
    const peer = agentIn(ctx, 'session-b')
    const id = await claim(ctx, holder, 'api', ['src/api'])
    for (const name of ['release_scope', 'claim_check']) {
      const denied = await call(ctx, peer, name, { claim_id: id })
      expect(denied.isError).toBe(true)
      expect(denied.text).toContain('belongs to another session')
    }
    expect((await call(ctx, peer, 'claim_list', {})).text).toContain(id)
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

describe('peer leases protect first-party filesystem mutations', () => {
  it.each([
    ['write', { file_path: 'src/app.ts', content: 'overwritten' }],
    ['edit', { file_path: 'src/app.ts', old_string: 'original', new_string: 'overwritten' }],
    ['str_replace_editor', { command: 'str_replace', old_str: 'original', new_str: 'overwritten' }],
    ['str_replace_editor', { command: 'insert', insert_line: 0, new_str: 'overwritten' }],
  ])('denies %s before it changes a peer-owned file', async (name, args) => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'owner')
    const peer = agentIn(ctx, 'peer')
    await mkdir(join(work, 'src'))
    await writeFile(join(work, 'src/app.ts'), 'original\n')
    await claim(ctx, owner, 'app', ['src'])
    const denied = await call(ctx, peer, name, { ...args, ...(name === 'str_replace_editor' ? { path: join(work, 'src/app.ts') } : {}) })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED: another session holds an active workspace claim')
    expect(await readFile(join(work, 'src/app.ts'), 'utf8')).toBe('original\n')
  })

  it('allows reads, owner edits and unclaimed work, then grants a peer write after release', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'owner')
    const peer = agentIn(ctx, 'peer')
    const id = await claim(ctx, owner, 'app', ['src'])
    const write = { file_path: 'src/app.ts', content: 'original\n' }
    expect((await call(ctx, owner, 'write', write)).isError).toBe(false)
    expect((await call(ctx, peer, 'read', { file_path: 'src/app.ts' })).isError).toBe(false)
    expect((await call(ctx, peer, 'write', { file_path: 'notes.md', content: 'independent' })).isError).toBe(false)
    await call(ctx, owner, 'release_scope', { claim_id: id })
    expect((await call(ctx, peer, 'write', { ...write, content: 'handoff\n' })).isError).toBe(false)
    expect(await readFile(join(work, 'src/app.ts'), 'utf8')).toBe('handoff\n')
  })

  it('blocks editor create in an owned directory and admits it after lease expiry', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'owner')
    const peer = agentIn(ctx, 'peer')
    await mkdir(join(work, 'src'))
    await claim(ctx, owner, 'app', ['src'])
    const args = { command: 'create', path: join(work, 'src/new.ts'), file_text: 'new file' }
    expect((await call(ctx, peer, 'str_replace_editor', args)).isError).toBe(true)
    await editLedger(ledger => ({ ...ledger, claims: ledger.claims.map(claim => ({ ...claim, expiresAt: Date.now() - 1 })) }))
    expect((await call(ctx, peer, 'str_replace_editor', args)).isError).toBe(false)
  })

  it('recognizes directory aliases during claim acquisition and writing', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'owner')
    const peer = agentIn(ctx, 'peer')
    await mkdir(join(work, 'src'))
    await symlink(join(work, 'src'), join(work, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    await claim(ctx, owner, 'app', ['src'])
    expect((await call(ctx, peer, 'claim_scope', { lane: 'alias', scopes: ['alias'] })).isError).toBe(true)
    expect((await call(ctx, peer, 'write', { file_path: 'alias/app.ts', content: 'collision' })).isError).toBe(true)
  })

  it('keeps a competing claim_scope outside an in-flight write, which auto-claims for the writer', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'owner')
    const peer = agentIn(ctx, 'peer')
    let entered!: () => void
    let finish!: () => void
    const writing = new Promise<void>((resolve) => { entered = resolve })
    const releaseWrite = new Promise<void>((resolve) => { finish = resolve })
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'write') {
        entered()
        await releaseWrite
      }
      return await next()
    })
    const pendingWrite = call(ctx, owner, 'write', { file_path: 'app.ts', content: 'completed before claim' })
    await writing
    const pendingClaim = call(ctx, peer, 'claim_scope', { lane: 'app', scopes: ['app.ts'] })
    finish()
    expect((await pendingWrite).isError).toBe(false)
    expect((await pendingClaim).isError).toBe(true)
    expect((await pendingClaim).text).toContain('DENIED')
    expect((await call(ctx, owner, 'write', { file_path: 'app.ts', content: 'holder writes again' })).isError).toBe(false)
    expect(await readFile(join(work, 'app.ts'), 'utf8')).toBe('holder writes again')
  })
})

describe('first mutating write auto-claims for the acting session', () => {
  it('takes a lease on the first write of an unclaimed path', async () => {
    const ctx = await mount()
    const writer = agentIn(ctx, 'writer')
    expect((await call(ctx, writer, 'write', { file_path: 'notes.md', content: 'first\n' })).isError).toBe(false)
    const listed = JSON.parse((await call(ctx, writer, 'claim_list', {})).text) as {
      readonly claims: ReadonlyArray<{
        readonly lane: string
        readonly sessionId: string
        readonly scopes: readonly string[]
        readonly note: string | null
        readonly remainingMs: number
      }>
    }
    expect(listed.claims).toHaveLength(1)
    expect(listed.claims[0]).toMatchObject({
      lane: AUTO_CLAIM_LANE,
      sessionId: writer.id,
      scopes: ['notes.md'],
      note: AUTO_CLAIM_NOTE,
    })
    expect(listed.claims[0]?.remainingMs).toBeGreaterThan(DEFAULT_TTL_MS - 10_000)
    expect(listed.claims[0]?.remainingMs).toBeLessThanOrEqual(DEFAULT_TTL_MS)
  })

  it('denies a peer write after the first writer auto-claimed', async () => {
    const ctx = await mount()
    const writer = agentIn(ctx, 'writer')
    const peer = agentIn(ctx, 'peer')
    expect((await call(ctx, writer, 'write', { file_path: 'notes.md', content: 'first\n' })).isError).toBe(false)
    const denied = await call(ctx, peer, 'write', { file_path: 'notes.md', content: 'stolen\n' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED: another session holds an active workspace claim')
    expect(denied.text).toContain(writer.id)
    expect(await readFile(join(work, 'notes.md'), 'utf8')).toBe('first\n')
  })

  it('lets the holder write the same path again and extends the lease', async () => {
    const ctx = await mount()
    const holder = agentIn(ctx, 'holder')
    expect((await call(ctx, holder, 'write', { file_path: 'notes.md', content: 'first\n' })).isError).toBe(false)
    const first = JSON.parse((await call(ctx, holder, 'claim_list', {})).text) as {
      readonly claims: ReadonlyArray<{ readonly id: string }>
    }
    await editLedger(ledger => ({
      ...ledger,
      claims: ledger.claims.map(claim => ({ ...claim, expiresAt: Date.now() + 60_000 })),
    }))
    expect((await call(ctx, holder, 'write', { file_path: 'notes.md', content: 'second\n' })).isError).toBe(false)
    expect(await readFile(join(work, 'notes.md'), 'utf8')).toBe('second\n')
    const second = JSON.parse((await call(ctx, holder, 'claim_list', {})).text) as {
      readonly claims: ReadonlyArray<{ readonly id: string; readonly remainingMs: number }>
    }
    expect(second.claims).toHaveLength(1)
    expect(second.claims[0]?.id).toBe(first.claims[0]?.id)
    expect(second.claims[0]?.remainingMs).toBeGreaterThan(60_000)
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
