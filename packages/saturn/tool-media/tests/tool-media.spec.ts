// Proves the spend Gate is real: no billable network call fires until `ctx.approval` grants it,
// every provider path in this package is gated (not just one), and a missing agent/approval service
// fails the call closed rather than silently spending money. Composed against the REAL
// `@deepseek-ai/dsh-user-approval` service (not a fake), per the "real-composition test proves the
// approval prompt precedes the request" acceptance line in SPEC §3 C7.
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

import * as ToolMedia from '../src/index.ts'
import { jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function server(handler: Parameters<typeof startMockServer>[0]): Promise<MockServer> {
  const instance = await startMockServer(handler)
  cleanup.push(instance.close)
  return instance
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-media-'))
  dirs.push(dir)
  return dir
}

/** One fake {@link Agent} with an open turn on its session, so `ctx.approval.request` may append audit events. */
function fakeAgent(cwd: string, onAppend?: (type: string) => void): Agent {
  const events: Array<{ type: string; seq: ReturnType<typeof SessionSeq>; time: number; data: Record<string, unknown> }> = [
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
  ]
  const id = SessionId('media-test-session')
  return {
    id,
    inject: () => {},
    session: {
      id,
      header: { version: 0, id, createdAt: 0, isSeeded: false, cwd },
      inheritedEventCount: SessionLogOffset(0),
      firstLiveSeq: SessionLogOffset(0),
      get seq() { return SessionLogOffset(events.length) },
      eventAt: (seq: ReturnType<typeof SessionSeq>) => events[seq],
      snapshotEvents: (from = SessionLogOffset(0), to = SessionLogOffset(events.length)) => events.slice(from, to),
      append: (type: string, data: Record<string, unknown>) => {
        events.push({ type, seq: SessionSeq(events.length), time: events.length, data })
        onAppend?.(type)
      },
    },
  } as unknown as Agent
}

interface BootOptions {
  withApproval?: boolean
  answer?: ApprovalOutcome | ((reason: string | undefined) => ApprovalOutcome)
}

async function boot(config: ToolMedia.Config, options: BootOptions = {}): Promise<{ ctx: Context; reasons: string[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const reasons: string[] = []
  if (options.withApproval ?? true) {
    await ctx.plugin(ApprovalService)
    const answer = options.answer ?? 'allowed-once'
    ctx.on('approval/request', (req) => {
      reasons.push(req.reason ?? '')
      const outcome = typeof answer === 'function' ? answer(req.reason) : answer
      return Promise.resolve<ApprovalOutcome>(outcome)
    })
  }
  await ctx.plugin(ToolMedia, config)
  return { ctx, reasons }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`media-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent } : {},
  })
}

function errorText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool registration', () => {
  it('registers all five media tools with their declared parameters', async () => {
    const { ctx } = await boot({})
    const names = ctx.tools.schemas().map(s => s.name).sort()
    expect(names).toEqual([
      'media_generate_audio',
      'media_generate_image',
      'media_generate_video',
      'media_job_status',
      'media_motion_transfer',
    ])
  })
})

describe('the spend Gate precedes every billable network call', () => {
  it('gemini image: the approval prompt fires, and completes, before the interactions endpoint is ever hit', async () => {
    let requestsAtApprovalTime = -1
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx, reasons } = await boot(
      { gemini: { apiKey: 'sk-test', baseURL: mock.url } },
      { answer: () => { requestsAtApprovalTime = mock.requests.length; return 'allowed-once' } },
    )
    const ws = await workspace()
    const agent = fakeAgent(ws)

    const result = await call(ctx, 'media_generate_image', { prompt: 'a red square' }, agent)
    expect(result.isError).toBe(false)
    expect(requestsAtApprovalTime).toBe(0)
    expect(mock.requests).toHaveLength(1)
    expect(reasons[0]).toContain('gemini/gemini-3.1-flash-image')
    expect(reasons[0]).toContain('$0.067')
  })

  it('rejecting the prompt stops the call before any network request', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } }, { answer: 'rejected' })
    const agent = fakeAgent(await workspace())

    const result = await call(ctx, 'media_generate_image', { prompt: 'x' }, agent)
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('the user declined this')
    expect(mock.requests).toHaveLength(0)
  })

  it('a cancelled approval and an unavailable approver each fail closed with distinct messages', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    for (const [outcome, message] of [['cancelled', 'was cancelled'], ['unavailable', 'no approval channel answered']] as const) {
      const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } }, { answer: outcome })
      const result = await call(ctx, 'media_generate_image', { prompt: 'x' }, fakeAgent(await workspace()))
      expect(result.isError).toBe(true)
      expect(errorText(result)).toContain(message)
    }
    expect(mock.requests).toHaveLength(0)
  })

  it('an agent-less call fails closed without reaching the network, even though this generation costs money', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } })
    const result = await call(ctx, 'media_generate_image', { prompt: 'x' }) // no agent
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('no agent to route the approval prompt through')
    expect(mock.requests).toHaveLength(0)
  })

  it('with no approval service composed at all, every paid call fails closed regardless of permission preset', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } }, { withApproval: false })
    const result = await call(ctx, 'media_generate_image', { prompt: 'x' }, fakeAgent(await workspace()))
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('no approval service is composed')
    expect(mock.requests).toHaveLength(0)
  })

  it('higgsfield: the free /estimate call may run before approval, but /higgsfield-ai/... never fires before it', async () => {
    const mock = await server((request, res) => {
      if (request.path.startsWith('/estimate/')) { jsonReply(res, 200, { credits: '1.0', usd: '0.05' }); return }
      if (request.path === '/higgsfield-ai/soul/standard') {
        jsonReply(res, 200, { status: 'completed', request_id: 'req-ok', images: [{ url: `${mock.url}/out.jpg` }] })
        return
      }
      if (request.path === '/out.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }).end(PNG_BYTES); return }
      res.writeHead(404).end()
    })
    let generationRequestsAtApprovalTime = -1
    const { ctx } = await boot(
      { higgsfield: { apiKey: 'kid:ksecret', baseURL: mock.url } },
      { answer: () => { generationRequestsAtApprovalTime = mock.requests.filter(r => r.path === '/higgsfield-ai/soul/standard').length; return 'allowed-once' } },
    )
    const result = await call(ctx, 'media_generate_image', { prompt: 'x', provider: 'higgsfield' }, fakeAgent(await workspace()))
    expect(result.isError).toBe(false)
    expect(generationRequestsAtApprovalTime).toBe(0)
  })
})

describe('assets land under <workspace>/.saturn/media/', () => {
  it('writes the decoded image bytes to a file and returns its path', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } })
    const ws = await workspace()

    const result = await call(ctx, 'media_generate_image', { prompt: 'x' }, fakeAgent(ws))
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { assets: Array<{ path: string; mimeType: string }> }
    expect(value.assets).toHaveLength(1)
    const [asset] = value.assets
    expect(asset.path.startsWith(join(ws, '.saturn', 'media'))).toBe(true)
    expect(asset.path.endsWith('.png')).toBe(true)
    expect(existsSync(asset.path)).toBe(true)
    expect(readFileSync(asset.path).equals(PNG_BYTES)).toBe(true)
  })
})

describe('media_job_status', () => {
  it('re-reads a job already resolved by a prior generate call', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } })
    const generated = await call(ctx, 'media_generate_image', { prompt: 'x' }, fakeAgent(await workspace()))
    if (generated.isError) throw new Error('expected success')
    const job = generated.value as { id: string; status: string }

    const status = await call(ctx, 'media_job_status', { id: job.id })
    expect(status.isError).toBe(false)
    expect((status.value as { status: string }).status).toBe('done')
  })

  it('reports an unknown job id as an error rather than a fabricated status', async () => {
    const { ctx } = await boot({})
    const result = await call(ctx, 'media_job_status', { id: 'never-existed' })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('unknown job id')
  })
})

describe('the honest gaps: config errors instead of a guessed contract', () => {
  it('media_motion_transfer refuses to guess an unverified Higgsfield endpoint', async () => {
    const { ctx } = await boot({ higgsfield: { apiKey: 'kid:ksecret' } })
    const result = await call(ctx, 'media_motion_transfer', { prompt: 'swap the car' }, fakeAgent(await workspace()))
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('requires an explicit model path')
  })

  it('media_generate_audio without a modelPath also refuses to guess', async () => {
    const { ctx } = await boot({ higgsfield: { apiKey: 'kid:ksecret' } })
    const result = await call(ctx, 'media_generate_audio', { prompt: 'say hello' }, fakeAgent(await workspace()))
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('requires an explicit model path')
  })

  it('openai image generation refuses to run without an explicit pricePerImageUsd', async () => {
    const { ctx } = await boot({ openai: { apiKey: 'sk-test' } })
    const result = await call(ctx, 'media_generate_image', { prompt: 'x', provider: 'openai' }, fakeAgent(await workspace()))
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('no verified per-image price is on file')
  })
})
