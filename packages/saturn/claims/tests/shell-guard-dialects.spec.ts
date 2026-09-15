/**
 * The terminal's shell is not knowable from the host platform, so the guard
 * must stop guessing it.
 *
 * `bash` and `pwsh` are separate tools backed by separate executables, so each
 * one's vocabulary is a fact. `terminal_send` is not: it types into whichever
 * shell the session happened to open, and on Windows that is as likely to be
 * Git Bash as PowerShell. Reading such a line in one vocabulary leaves the
 * other one's mutators — `sed -i`, `truncate`, `tee`, `patch`, `dd`, and their
 * PowerShell counterparts — dispatching unguarded onto a peer's claimed file.
 *
 * The contract pinned here is platform-independent: a terminal line is read in
 * BOTH vocabularies and denied if either one says it writes a claimed path.
 * The platform is stubbed in each case so the suite proves the same thing on
 * every machine rather than only on the one it happens to run on. Reads stay
 * free in both vocabularies, because a guard writers route around protects
 * nothing.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ClaimsPlugin from '../src/index.ts'

/** The branded call id the tool registry mints; the brand is a compile-time fact. */
type CallId = Parameters<Context['tools']['execute']>[0]['callId']

/** The agent shape the tool registry admits; only `session` is load-bearing here. */
interface ClaimAgent {
  readonly id: string
  readonly session: Session
}

let work: string
let home: string
let previousHome: string | undefined
let callCounter = 0

const REAL_PLATFORM = process.platform

/** Pretend this process runs on one platform, so the guard's choice is observable. */
function usePlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'claims-dialect-work-'))
  home = await mkdtemp(join(tmpdir(), 'claims-dialect-home-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await mkdir(join(work, 'src'), { recursive: true })
  await writeFile(join(work, 'src', 'app.ts'), 'original\n')
})

afterEach(async () => {
  usePlatform(REAL_PLATFORM)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(work, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/** One mounted host plus a terminal fixture that really writes the contended file. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ClaimsPlugin)
  await ctx.plugin(LocalFileSystem, { cwd: work })
  await ctx.plugin(ToolFs)
  const overwrite = async (): Promise<[{ type: 'text'; text: string }]> => {
    await writeFile(join(work, 'src', 'app.ts'), 'shell overwrote it\n')
    return [{ type: 'text', text: 'ran' }]
  }
  ctx.tools.register(defineContentToolFixture({
    name: 'terminal_send',
    description: 'terminal fixture that performs the write its text describes',
    parameters: { sessionId: { type: 'string', required: true }, text: { type: 'string', required: true } },
    execute: overwrite,
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'bash',
    description: 'bash fixture that performs the write its command describes',
    parameters: { command: { type: 'string', required: true }, workdir: { type: 'string' } },
    execute: overwrite,
  }))
  return ctx
}

/** A distinct live session in the workspace. */
function agentIn(ctx: Context, name: string): ClaimAgent {
  const session = ctx.sessions.create(SessionId(name), { meta: { cwd: work } })
  return { id: session.id, session }
}

/** Dispatch one tool call the way the loop does, and reduce the outcome to text. */
async function call(ctx: Context, agent: ClaimAgent, name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    callId: `dialect-${++callCounter}` as CallId,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: agent as never,
  })
  const blocks = result.content as readonly { readonly type: string; readonly text?: string }[]
  return { isError: result.isError, text: blocks.map(block => block.text ?? '').join('\n') }
}

/** Take one claim and fail loudly when it was refused. */
async function claim(ctx: Context, agent: ClaimAgent, lane: string, scopes: readonly string[]): Promise<void> {
  const outcome = await call(ctx, agent, 'claim_scope', { lane, scopes })
  expect(outcome.isError, `claim_scope ${lane} should have been granted: ${outcome.text}`).toBe(false)
}

/** The file the fixture writes, as it stands on disk. */
async function appText(): Promise<string> {
  return await readFile(join(work, 'src', 'app.ts'), 'utf8')
}

describe('terminal_send is read in both shell vocabularies', () => {
  it.each([
    ['win32', 'sed -i \'s/a/b/\' src/app.ts'],
    ['linux', 'sed -i \'s/a/b/\' src/app.ts'],
    ['win32', 'Set-Content -Path src/app.ts -Value x'],
    ['linux', 'Set-Content -Path src/app.ts -Value x'],
    ['win32', 'truncate -s 0 src/app.ts'],
    ['linux', 'Remove-Item src/app.ts'],
  ])('denies a terminal line on %s: `%s`', async (platform, text) => {
    usePlatform(platform as NodeJS.Platform)
    const ctx = await mount()
    const owner = agentIn(ctx, `dialect-owner-${++callCounter}`)
    const peer = agentIn(ctx, `dialect-peer-${++callCounter}`)
    await claim(ctx, owner, 'app', ['src'])

    const denied = await call(ctx, peer, 'terminal_send', { sessionId: 'term-1', text })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED: another session holds an active workspace claim')
    expect(denied.text).toContain(owner.id)
    expect(denied.text).toContain('src/app.ts')
    expect(await appText()).toBe('original\n')
  })

  it.each([
    ['win32', 'cat src/app.ts'],
    ['linux', 'Get-Content src/app.ts'],
    ['win32', 'grep -rn TODO src'],
    ['linux', 'node scripts/build.mjs --out dist'],
  ])('still admits the read-only terminal line on %s: `%s`', async (platform, text) => {
    usePlatform(platform as NodeJS.Platform)
    const ctx = await mount()
    const owner = agentIn(ctx, `dialect-read-owner-${++callCounter}`)
    const peer = agentIn(ctx, `dialect-read-peer-${++callCounter}`)
    await claim(ctx, owner, 'app', ['src'])

    const allowed = await call(ctx, peer, 'terminal_send', { sessionId: 'term-1', text })
    expect(allowed.isError).toBe(false)
  })

  it('lets the claim holder type its own mutation in either vocabulary', async () => {
    usePlatform('win32')
    const ctx = await mount()
    const owner = agentIn(ctx, 'dialect-self-owner')
    await claim(ctx, owner, 'app', ['src'])

    const allowed = await call(ctx, owner, 'terminal_send', { sessionId: 'term-1', text: 'sed -i \'s/a/b/\' src/app.ts' })
    expect(allowed.isError).toBe(false)
    expect(await appText()).toBe('shell overwrote it\n')
  })

  it('keeps the declared dialect of the bash tool, whose executable is a fact', async () => {
    usePlatform('win32')
    const ctx = await mount()
    const owner = agentIn(ctx, 'dialect-bash-owner')
    const peer = agentIn(ctx, 'dialect-bash-peer')
    await claim(ctx, owner, 'app', ['src'])

    const denied = await call(ctx, peer, 'bash', { command: 'sed -i \'s/a/b/\' src/app.ts', description: 'edit in place' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED')
    expect(await appText()).toBe('original\n')
  })
})
