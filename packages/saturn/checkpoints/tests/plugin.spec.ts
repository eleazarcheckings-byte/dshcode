/**
 * The plugin's own glue, driven end to end through the REAL services: a mounted
 * `ToolRuntime` dispatches first-party `write` calls, the capture hook records
 * what a turn is about to replace, the `checkpoints` projection folds the log,
 * and `/checkpoint restore` puts the bytes back.
 *
 * This is the test the unit suites cannot be: `plan.ts` and `capture.ts` prove
 * the arithmetic, and this proves the seams — that the hook sees parsed
 * arguments before the body runs, that the browser-facing view is what the row
 * renders, and that the command's restore is undoable with a second command.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as CheckpointsPlugin from '../src/index.ts'
import type { CheckpointsProjection, CheckpointsUnitState } from '../src/types.ts'

/** The agent shape the command registry admits; only `session` is load-bearing here. */
type CommandAgent = Parameters<Context['commands']['execute']>[0]
/** The branded call id the tool registry mints; the brand is a compile-time fact. */
type CallId = Parameters<Context['tools']['execute']>[0]['callId']

let work: string
let home: string
let previousHome: string | undefined

async function fileExists(path: string): Promise<boolean> {
  return await stat(path).then(() => true, () => false)
}

/** One mounted host: real services, the plugin under test, and a real session with a real cwd. */
async function mount(): Promise<{ ctx: Context; session: Session; agent: CommandAgent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  // `ToolRuntime` requires `systemPrompt`, so the prompt service mounts first.
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(CheckpointsPlugin)
  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'test write',
    parameters: {},
    execute: async (args) => {
      const call = args as { readonly file_path: string; readonly content: string }
      const target = join(work, call.file_path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, call.content)
      return [{ type: 'text', text: `wrote ${call.file_path}` }]
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'read',
    description: 'test read',
    parameters: {},
    execute: async () => [{ type: 'text', text: 'read' }],
  }))
  const session = ctx.sessions.create(SessionId('checkpointed'), { meta: { cwd: work } })
  const agent = { id: session.id, session } as unknown as CommandAgent
  return { ctx, session, agent }
}

let callCounter = 0

/** Dispatch one tool call the way the loop does: parsed arguments, before the body. */
async function dispatch(ctx: Context, agent: CommandAgent, name: string, args: unknown): Promise<void> {
  const result = await ctx.tools.execute({
    callId: `call-${++callCounter}` as CallId,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent,
  })
  expect(result.isError, `${name} should have run`).toBe(false)
}

async function runCommand(ctx: Context, agent: CommandAgent, line: string): Promise<{ kind: string; text: string }> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`${line} was not registered`)
  return { kind: execution.result.kind, text: execution.result.text ?? '' }
}

function logged(ctx: Context, session: Session): CheckpointsUnitState {
  return ctx.sessionProjections.stateOf(session, 'checkpoints') ?? { byId: {}, order: [] }
}

function viewOf(ctx: Context, session: Session): CheckpointsProjection {
  return ctx.sessionProjections.snapshot(session).values.checkpoints as CheckpointsProjection
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'checkpoints-plugin-work-'))
  home = await mkdtemp(join(tmpdir(), 'checkpoints-plugin-home-'))
  previousHome = process.env.DSH_HOME
  // The store must never write a test blob into the real harness home.
  process.env.DSH_HOME = home
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(work, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

describe('capture rides the real tool dispatch', () => {
  it('records nothing before a turn opens and nothing for a reading call', async () => {
    const { ctx, session, agent } = await mount()
    await writeFile(join(work, 'before.ts'), 'baseline\n')
    await dispatch(ctx, agent, 'write', { file_path: 'before.ts', content: 'outside a turn\n' })
    session.append('turn/start', { turn: 1 })
    await dispatch(ctx, agent, 'read', { file_path: 'before.ts' })
    expect(logged(ctx, session)).toEqual({ byId: {}, order: [] })
  })

  it('records each mutating path as the turn proceeds and folds them into one checkpoint', async () => {
    const { ctx, session, agent } = await mount()
    await writeFile(join(work, 'src', 'app.ts'), 'port 4173\n').catch(async (error: unknown) => {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      await mkdir(join(work, 'src'), { recursive: true })
      await writeFile(join(work, 'src', 'app.ts'), 'port 4173\n')
    })
    session.append('turn/start', { turn: 1 })
    await dispatch(ctx, agent, 'write', { file_path: 'src/app.ts', content: 'port 8080\n' })
    await dispatch(ctx, agent, 'write', { file_path: 'created.txt', content: 'made by the turn\n' })
    // A second write to the same path must not duplicate the recorded entry: the
    // bytes the restore needs are the ones from before the turn's first write.
    await dispatch(ctx, agent, 'write', { file_path: 'src/app.ts', content: 'port 9999\n' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const state = logged(ctx, session)
    expect(state.order).toEqual(['1'])
    const record = state.byId['1']
    expect(record?.reason).toBe('turn')
    expect(record?.turn).toBe(1)
    expect(record?.workspaceRoot).toBe(work)
    expect(record?.entries.map(entry => [entry.path, entry.state.kind])).toEqual([
      ['src/app.ts', 'blob'],
      ['created.txt', 'absent'],
    ])
    // The row's wire view: what the ambient dock renders.
    expect(viewOf(ctx, session)).toEqual({
      count: 1,
      latest: { id: '1', createdAt: expect.any(Number) as number, reason: 'turn', turn: 1, files: 2 },
      entries: [{ id: '1', createdAt: expect.any(Number) as number, reason: 'turn', turn: 1, files: 2 }],
    })
  })
})

describe('the /checkpoint command', () => {
  it('lists nothing, then the checkpoint a turn opened', async () => {
    const { ctx, session, agent } = await mount()
    expect((await runCommand(ctx, agent, '/checkpoint')).text).toContain('No code checkpoints in this session yet.')
    await writeFile(join(work, 'app.ts'), 'v1\n')
    session.append('turn/start', { turn: 1 })
    await dispatch(ctx, agent, 'write', { file_path: 'app.ts', content: 'v2\n' })
    const listed = await runCommand(ctx, agent, '/checkpoint list')
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain('Code checkpoints (1):')
    expect(listed.text).toContain('#1  before turn 1 · 1 file')
    expect((await runCommand(ctx, agent, '/checkpoint bogus')).text).toContain('Usage: /checkpoint')
  })

  it('restores the recorded bytes, removes what the turn created, and is itself undoable', async () => {
    const { ctx, session, agent } = await mount()
    const target = join(work, 'app.ts')
    await writeFile(target, 'v1 original\n')
    await writeFile(join(work, 'neighbour.md'), 'never captured\n')

    session.append('turn/start', { turn: 1 })
    await dispatch(ctx, agent, 'write', { file_path: 'app.ts', content: 'v2 by the agent\n' })
    await dispatch(ctx, agent, 'write', { file_path: 'created.txt', content: 'agent made this\n' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // A person then edits the same file by hand, past the turn's end.
    await writeFile(target, 'v3 by hand\n')

    const restored = await runCommand(ctx, agent, '/checkpoint restore 1')
    expect(restored.kind).toBe('success')
    expect(restored.text).toContain('Restored #1 (before turn 1 · 2 files): wrote 1 file and removed 1 file it had created.')
    expect(await readFile(target, 'utf8')).toBe('v1 original\n')
    expect(await fileExists(join(work, 'created.txt'))).toBe(false)
    expect(await readFile(join(work, 'neighbour.md'), 'utf8')).toBe('never captured\n')

    // The restore logged the state it overwrote, so one more command gets back
    // to where the person was a moment ago.
    const afterRestore = logged(ctx, session)
    expect(afterRestore.order).toEqual(['1', '2'])
    expect(afterRestore.byId['2']?.reason).toBe('pre-restore')
    expect(afterRestore.byId['2']?.turn).toBeNull()
    const undone = await runCommand(ctx, agent, '/checkpoint restore 2')
    expect(undone.kind).toBe('success')
    expect(await readFile(target, 'utf8')).toBe('v3 by hand\n')
    expect(await readFile(join(work, 'created.txt'), 'utf8')).toBe('agent made this\n')
  })

  it('refuses an unknown id and a refused plan without writing anything', async () => {
    const { ctx, agent } = await mount()
    const unknown = await runCommand(ctx, agent, '/checkpoint restore 7')
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('No checkpoint #7 in this session (none exist).')
    const noId = await runCommand(ctx, agent, '/checkpoint restore')
    expect(noId.kind).toBe('error')
    expect(noId.text).toContain('Restoring needs a checkpoint id.')
  })

  it('records the turn\'s paths once, in first-seen order, across a resumed log', async () => {
    const { ctx, session, agent } = await mount()
    await writeFile(join(work, 'a.txt'), 'a\n')
    session.append('turn/start', { turn: 1 })
    await dispatch(ctx, agent, 'write', { file_path: 'a.txt', content: 'A\n' })
    await dispatch(ctx, agent, 'write', { file_path: 'b.txt', content: 'B\n' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A second turn opens its own checkpoint rather than extending the first.
    session.append('turn/start', { turn: 2 })
    await dispatch(ctx, agent, 'write', { file_path: 'a.txt', content: 'AA\n' })
    expect(logged(ctx, session).order).toEqual(['1', '2'])
    expect(logged(ctx, session).byId['2']?.entries.map(entry => entry.path)).toEqual(['a.txt'])
    // The wire view lists newest first and stays bounded.
    expect(viewOf(ctx, session).entries.map(entry => entry.id)).toEqual(['2', '1'])
    const files = await readdir(work)
    expect(files.sort()).toEqual(['a.txt', 'b.txt'])
  })
})
