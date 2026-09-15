/**
 * The shell half of the write guard, driven through the REAL tool runtime.
 *
 * The file guard only ever covered `write` / `edit` / `str_replace_editor`, and
 * the Team policy admitted as much: "Bash, formatters, code generators, and
 * scripts are not fully protected". That admission is the hole this suite
 * pins shut. A shell command is not parsed for meaning here — it is scanned
 * for the two things that are decidable from argv alone: a redirection target,
 * and the operands of a command whose whole job is to change a file. Anything
 * that resolves inside the workspace and lands on a peer's claimed surface is
 * DENIED before the executor runs, and the fixture tools below write the file
 * themselves so a passing assertion is proof that no dispatch happened.
 *
 * Reads stay free. Over-blocking a `cat` would make the guard something
 * writers route around, which is the failure mode the ledger exists to prevent.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
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

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'claims-shell-work-'))
  home = await mkdtemp(join(tmpdir(), 'claims-shell-home-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await mkdir(join(work, 'src'), { recursive: true })
  await writeFile(join(work, 'src', 'app.ts'), 'original\n')
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(work, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/**
 * One mounted host plus shell-shaped fixture tools that really write, so a
 * guard that failed to deny is visible as changed bytes rather than as a
 * missing error.
 */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ClaimsPlugin)
  await ctx.plugin(LocalFileSystem, { cwd: work })
  await ctx.plugin(ToolFs)
  const shell = async (target: string): Promise<[{ type: 'text'; text: string }]> => {
    await writeFile(target, 'shell overwrote it\n')
    return [{ type: 'text', text: 'ran' }]
  }
  for (const name of ['bash', 'pwsh']) {
    ctx.tools.register(defineContentToolFixture({
      name,
      description: `${name} fixture that performs the write its command describes`,
      parameters: {
        command: { type: 'string', required: true },
        workdir: { type: 'string' },
      },
      async execute() {
        // The fixture always writes the one contended file: what varies between
        // cases is the command the guard reads, never where the shell would go.
        return await shell(join(work, 'src', 'app.ts'))
      },
    }))
  }
  ctx.tools.register(defineContentToolFixture({
    name: 'terminal_send',
    description: 'terminal fixture that performs the write its text describes',
    parameters: { sessionId: { type: 'string', required: true }, text: { type: 'string', required: true } },
    async execute() {
      return await shell(join(work, 'src', 'app.ts'))
    },
  }))
  return ctx
}

/** A distinct live session in the workspace. */
function agentIn(ctx: Context, name: string, cwd: string = work): ClaimAgent {
  const session = ctx.sessions.create(SessionId(name), { meta: { cwd } })
  return { id: session.id, session }
}

/** Dispatch one tool call the way the loop does, and reduce the outcome to text. */
async function call(ctx: Context, agent: ClaimAgent, name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    callId: `shell-${++callCounter}` as CallId,
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

/** The file the fixture tools write, as it stands on disk. */
async function appText(): Promise<string> {
  return await readFile(join(work, 'src', 'app.ts'), 'utf8')
}

describe('peer leases protect shell mutations', () => {
  it.each([
    ['bash', 'echo x > src/app.ts'],
    ['bash', 'rm -f src/app.ts'],
    ['bash', 'cp /tmp/other.ts src/app.ts'],
    ['bash', 'sed -i \'s/a/b/\' src/app.ts'],
    ['bash', 'printf hi >> "src/app.ts"'],
    ['pwsh', 'Set-Content -Path src/app.ts -Value \'x\''],
    ['pwsh', 'Remove-Item src\\app.ts'],
    ['pwsh', '"x" | Out-File src/app.ts'],
  ])('denies %s running `%s` against a peer-owned file', async (name, command) => {
    const ctx = await mount()
    const owner = agentIn(ctx, `owner-${++callCounter}`)
    const peer = agentIn(ctx, `peer-${++callCounter}`)
    await claim(ctx, owner, 'app', ['src'])

    const denied = await call(ctx, peer, name, { command, description: 'change a file' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED: another session holds an active workspace claim')
    expect(denied.text).toContain(owner.id)
    expect(denied.text).toContain('src/app.ts')
    expect(await appText()).toBe('original\n')
  })

  it('denies a terminal write to a peer-owned file', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'terminal-owner')
    const peer = agentIn(ctx, 'terminal-peer')
    await claim(ctx, owner, 'app', ['src'])

    const denied = await call(ctx, peer, 'terminal_send', { sessionId: 'shell-1', text: 'printf hi > src/app.ts' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED')
    expect(await appText()).toBe('original\n')
  })

  it('resolves a relative target against the command workdir, not only the session workspace', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'workdir-owner')
    const peer = agentIn(ctx, 'workdir-peer')
    await claim(ctx, owner, 'app', ['src/app.ts'])

    const denied = await call(ctx, peer, 'bash', { command: 'echo x > app.ts', description: 'write', workdir: 'src' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('DENIED')
    expect(await appText()).toBe('original\n')
  })

  it('lets the holder run the same command on its own claimed surface', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'self-owner')
    await claim(ctx, owner, 'app', ['src'])

    const allowed = await call(ctx, owner, 'bash', { command: 'echo x > src/app.ts', description: 'write' })
    expect(allowed.isError).toBe(false)
    expect(await appText()).toBe('shell overwrote it\n')
  })

  it.each([
    ['bash', 'cat src/app.ts'],
    ['bash', 'grep -rn TODO src'],
    ['bash', 'node scripts/build.mjs --out dist'],
    ['pwsh', 'Get-Content src/app.ts'],
  ])('admits %s running the read-only command `%s` over a peer-owned surface', async (name, command) => {
    const ctx = await mount()
    const owner = agentIn(ctx, `read-owner-${++callCounter}`)
    const peer = agentIn(ctx, `read-peer-${++callCounter}`)
    await claim(ctx, owner, 'app', ['src'])

    const allowed = await call(ctx, peer, name, { command, description: 'read' })
    expect(allowed.isError).toBe(false)
  })

  it('ignores a mutation whose target resolves outside the workspace', async () => {
    const ctx = await mount()
    const owner = agentIn(ctx, 'outside-owner')
    const peer = agentIn(ctx, 'outside-peer')
    await claim(ctx, owner, 'root', ['.'])

    const allowed = await call(ctx, peer, 'bash', { command: `echo x > ${join(home, 'note.txt')}`, description: 'write elsewhere' })
    expect(allowed.isError).toBe(false)
  })

  it('states in the standing policy that shell mutations are enforced, not merely discouraged', async () => {
    const ctx = await mount()
    const assembly = await ctx.systemPrompt.assemble({})
    const policy = assembly.sections.find(candidate => candidate.name === ClaimsPlugin.CLAIMS_SECTION)
    expect(renderPrompt({ ...assembly, sections: policy === undefined ? [] : [policy] }))
      .toContain('bash, pwsh, and terminal')
  })
})
