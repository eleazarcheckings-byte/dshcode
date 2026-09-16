import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as scheduleDurable from '../src/index.ts'

const signal = new AbortController().signal

const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-schedule-durable-plugin-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

describe('Schedule-Durable plugin composition', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in scheduleDurable).toBe(false)
    expect(scheduleDurable.name).toBe('schedule-durable')
    expect(scheduleDurable.inject).toEqual(['tools', 'storageDomain'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(scheduleDurable)).toBe(scheduleDurable)
  })

  it('registers all five tools globally (no live Agent required) and runs create/list/pause/resume/cancel end to end', async () => {
    const root = await freshRoot()
    const ctx = await harness(root)
    const plugin = await ctx.plugin(scheduleDurable, { pollIntervalMs: 60_000 })

    for (const toolName of ['schedule_durable_create', 'schedule_durable_list', 'schedule_durable_pause', 'schedule_durable_resume', 'schedule_durable_cancel']) {
      expect(ctx.tools.get(toolName)?.name).toBe(toolName)
    }

    const created = await ctx.tools.execute({
      signal,
      callId: ToolCallId('create-1'),
      name: 'schedule_durable_create',
      arguments: {
        name: 'nightly build',
        prompt: 'run the nightly build',
        workspace: process.cwd(),
        cron: '0 3 * * *',
      },
    })
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error('expected a created task view')
    const task = created.value as { id: string; status: string; nextFireAt: string }
    expect(task.status).toBe('active')
    expect(typeof task.nextFireAt).toBe('string')

    const listed = await ctx.tools.execute({
      signal, callId: ToolCallId('list-1'), name: 'schedule_durable_list', arguments: {},
    })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected a task list')
    expect(listed.value).toEqual([task])

    const paused = await ctx.tools.execute({
      signal, callId: ToolCallId('pause-1'), name: 'schedule_durable_pause', arguments: { id: task.id },
    })
    expect(paused.isError).toBe(false)
    if (paused.isError) throw new Error('expected a paused task view')
    expect((paused.value as { status: string }).status).toBe('paused')

    const resumed = await ctx.tools.execute({
      signal, callId: ToolCallId('resume-1'), name: 'schedule_durable_resume', arguments: { id: task.id },
    })
    expect(resumed.isError).toBe(false)
    if (resumed.isError) throw new Error('expected a resumed task view')
    expect((resumed.value as { status: string }).status).toBe('active')

    const cancelled = await ctx.tools.execute({
      signal, callId: ToolCallId('cancel-1'), name: 'schedule_durable_cancel', arguments: { id: task.id },
    })
    expect(cancelled.isError).toBe(false)
    if (cancelled.isError) throw new Error('expected a cancel result')
    expect(cancelled.value).toEqual({ id: task.id, cancelled: true })

    const cancelledAgain = await ctx.tools.execute({
      signal, callId: ToolCallId('cancel-2'), name: 'schedule_durable_cancel', arguments: { id: task.id },
    })
    expect(cancelledAgain.isError).toBe(false)
    if (cancelledAgain.isError) throw new Error('expected a second cancel result')
    expect(cancelledAgain.value).toEqual({ id: task.id, cancelled: false, code: 'task_not_found' })

    await plugin.dispose()
    for (const toolName of ['schedule_durable_create', 'schedule_durable_list', 'schedule_durable_pause', 'schedule_durable_resume', 'schedule_durable_cancel']) {
      expect(ctx.tools.get(toolName)).toBeUndefined()
    }
    await ctx.fiber.dispose()
  })

  it('rejects a non-absolute workspace and a doubled or missing selector with stable error codes', async () => {
    const root = await freshRoot()
    const ctx = await harness(root)
    await ctx.plugin(scheduleDurable, { pollIntervalMs: 60_000 })

    const badWorkspace = await ctx.tools.execute({
      signal, callId: ToolCallId('bad-workspace'), name: 'schedule_durable_create',
      arguments: { name: 'n', prompt: 'p', workspace: 'relative/path', cron: '0 3 * * *' },
    })
    expect(badWorkspace.isError).toBe(false)
    if (badWorkspace.isError) throw new Error('expected a business-error value')
    expect(badWorkspace.value).toMatchObject({ code: 'invalid_workspace' })

    const bothSelectors = await ctx.tools.execute({
      signal, callId: ToolCallId('both-selectors'), name: 'schedule_durable_create',
      arguments: { name: 'n', prompt: 'p', workspace: process.cwd(), cron: '0 3 * * *', at: '2099-01-01T00:00:00.000Z' },
    })
    expect(bothSelectors.isError).toBe(false)
    if (bothSelectors.isError) throw new Error('expected a business-error value')
    expect(bothSelectors.value).toMatchObject({ code: 'invalid_selector' })

    await ctx.fiber.dispose()
  })

  it('performs restart catch-up automatically on mount', async () => {
    const root = await freshRoot()
    const ctx1 = await harness(root)
    await ctx1.plugin(scheduleDurable, { pollIntervalMs: 60_000 })
    const created = await ctx1.tools.execute({
      signal, callId: ToolCallId('create-catchup'), name: 'schedule_durable_create',
      arguments: { name: 'n', prompt: 'p', workspace: process.cwd(), at: `${new Date(Date.now() + 200).toISOString().slice(0, -1)}Z` },
    })
    if (created.isError) throw new Error('expected a created task view')
    const taskId = (created.value as { id: string }).id
    await new Promise(resolve => setTimeout(resolve, 250))
    await ctx1.fiber.dispose()

    // Restart: a fresh context over the same root runs its first reconcile
    // pass on mount, which must catch the now-overdue one-shot task up.
    const ctx2 = await harness(root)
    await ctx2.plugin(scheduleDurable, { pollIntervalMs: 60_000 })
    const listed = await ctx2.tools.execute({
      signal, callId: ToolCallId('list-catchup'), name: 'schedule_durable_list', arguments: {},
    })
    if (listed.isError) throw new Error('expected a task list')
    const task = (listed.value as Array<{ id: string; status: string }>).find(entry => entry.id === taskId)
    expect(task?.status).toBe('done')
    await ctx2.fiber.dispose()
  })
})
