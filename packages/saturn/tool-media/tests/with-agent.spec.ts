// Fix-round regression: Mars flagged that SPEC §4's pinned single-argument `generate(req)` /
// `status(id)` shape throws "no agent to route the approval prompt through" for any consumer that
// calls it exactly as the interface is pinned (no second `exec` argument) — because that shape has
// no room for the `Agent` the spend Gate fundamentally needs. This proves `MediaService.withAgent()`
// closes that gap for a consumer that holds an `Agent` up front: the object it returns matches the
// pinned shape byte-for-byte, and a pinned-shape call through it still runs the real spend Gate
// (approval fires, with the estimated cost line, before the network call) rather than skipping it.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

import * as ToolMedia from '../src/index.ts'
import type { BoundMediaService, MediaGenerateRequest } from '../src/index.ts'
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-media-with-agent-'))
  dirs.push(dir)
  return dir
}

/** A minimal {@link Agent}-shaped identity, exactly as far as `ctx.approval.request` needs — enough
 * for a consumer with no interactive-session Agent to construct one purely to satisfy the seam. */
function fakeAgent(cwd: string): Agent {
  const events: Array<{ type: string; seq: ReturnType<typeof SessionSeq>; time: number; data: Record<string, unknown> }> = [
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
  ]
  const id = SessionId('with-agent-test-session')
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
      },
    },
  } as unknown as Agent
}

interface BootOptions { answer?: ApprovalOutcome | ((reason: string | undefined) => ApprovalOutcome) }

async function boot(config: ToolMedia.Config, options: BootOptions = {}): Promise<{ ctx: Context; reasons: string[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const reasons: string[] = []
  await ctx.plugin(ApprovalService)
  const answer = options.answer ?? 'allowed-once'
  ctx.on('approval/request', (req) => {
    reasons.push(req.reason ?? '')
    return Promise.resolve<ApprovalOutcome>(typeof answer === 'function' ? answer(req.reason) : answer)
  })
  await ctx.plugin(ToolMedia, config)
  return { ctx, reasons }
}

describe('MediaService.withAgent — the SPEC §4 pinned single-argument shape', () => {
  it('the bound object matches { generate(req), status(id) } — no exec parameter accepted or required', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } })
    const bound: BoundMediaService = ctx.media.withAgent(fakeAgent(await workspace()))

    const request: MediaGenerateRequest = { kind: 'image', prompt: 'a bound-agent square', workspace: await workspace() }
    // The pinned shape's own call signature: exactly one argument, matching SPEC §4 verbatim.
    const job = await bound.generate(request)
    expect(job.status).toBe('done')
    expect(job.assets).toHaveLength(1)

    const reread = await bound.status(job.id)
    expect(reread.status).toBe('done')
  })

  it('the spend Gate still runs through a bound call — approval fires, with the cost line, before the network request', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    let requestsAtApprovalTime = -1
    const { ctx, reasons } = await boot(
      { gemini: { apiKey: 'sk-test', baseURL: mock.url } },
      { answer: () => { requestsAtApprovalTime = mock.requests.length; return 'allowed-once' } },
    )
    const bound = ctx.media.withAgent(fakeAgent(await workspace()))

    await bound.generate({ kind: 'image', prompt: 'x', workspace: await workspace() })
    expect(requestsAtApprovalTime).toBe(0)
    expect(mock.requests).toHaveLength(1)
    expect(reasons[0]).toContain('estimated cost')
  })

  it('a rejected approval still throws through the bound pinned-shape call, closed exactly as the raw call would', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } }) })
    const { ctx } = await boot({ gemini: { apiKey: 'sk-test', baseURL: mock.url } }, { answer: 'rejected' })
    const bound = ctx.media.withAgent(fakeAgent(await workspace()))

    await expect(bound.generate({ kind: 'image', prompt: 'x', workspace: await workspace() }))
      .rejects.toThrow('the user declined this')
    expect(mock.requests).toHaveLength(0)
  })
})
