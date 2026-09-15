/** Keyless Loader composition: the peer sees a denial and the file stays intact. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as Claims from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
const previousHome = process.env.DSH_HOME
afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

it('boots the file ownership composition and preserves the owner work across a denied peer write', async () => {
  root = await mkdtemp(join(tmpdir(), 'saturn-claims-composition-'))
  process.env.DSH_HOME = join(root, '.dsh')
  const ctx = new Context()
  await ctx.plugin(Loader)
  // Builtins preserve the test runner's source module identity. Every entry is
  // the real package; the YAML owns order, dependencies, and activation.
  Object.assign(ctx.loader.builtins, {
    'claim-test-sessions': SessionStore,
    'claim-test-system-prompt': SystemPrompt,
    'claim-test-tools': ToolRuntime,
    'claim-test-llm': LlmRuntime,
    'claim-test-agents': AgentRegistry,
    'claim-test-projections': SessionProjectionRegistry,
    'claim-test-agent-loop': AgentLoop,
    'claim-test-fs': LocalFileSystem,
    'claim-test-claims': Claims,
    'claim-test-tool-fs': ToolFs,
  })
  const composition = await ctx.plugin(Include, { path: new URL('./fixtures/cordis.yml', import.meta.url).href })
  try {
    const owner = { session: ctx.sessions.create(SessionId('owner'), { meta: { cwd: root } }) }
    const adapter = new MockAdapter([
      toolCallResponse('peer-write', 'write', { file_path: 'app.ts', content: 'peer overwrite\n' }),
      textResponse('The file is owned by another session; I will request a handoff.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const peer = ctx.agentLoop.create(SessionId('peer'), { provider: 'mock', model: 'mock' }, { cwd: root })
    let sequence = 0
    const call = (agent: typeof owner, name: string, args: unknown) => ctx.tools.execute({
      callId: ToolCallId(`composition-${++sequence}`), name, arguments: args,
      agent: agent as never, signal: new AbortController().signal,
    })
    expect((await call(owner, 'claim_scope', { lane: 'app', scopes: ['app.ts'] })).isError).toBe(false)
    expect((await call(owner, 'write', { file_path: 'app.ts', content: 'owner work\n' })).isError).toBe(false)
    peer.followup(createUserMessage({ content: [{ type: 'text', text: 'Update app.ts.' }], source: { kind: 'user' } }))
    await peer.whenIdle()
    const denied = peer.session.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === 'peer-write')
    if (denied?.type !== 'tool/result') throw new Error('Peer write result was not logged')
    const result = denied.data.message.content[0]
    const output = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(adapter.requests).toHaveLength(2)
    expect({ isError: result.isError, output, file: await readFile(join(root, 'app.ts'), 'utf8') }).toMatchInlineSnapshot(`
      {
        "file": "owner work
      ",
        "isError": true,
        "output": "Error: write DENIED: another session holds an active workspace claim. No file was changed.
      \"app.ts\" is held by session:owner (lane app, claim claim-1, 120 min left).
      Ask the holder to release the claim, choose a different scope, or wait for the lease to expire. Do not bypass the claim using shell commands.",
      }
    `)
  } finally {
    await composition.dispose()
  }
})
