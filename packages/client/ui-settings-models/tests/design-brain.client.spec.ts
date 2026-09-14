/**
 * The Design brain probe must earn "Connected": every failure path stays
 * `unreachable`, so the setup step can never report a connection it did not
 * make. A probe that guessed success would be a lie the user carries into
 * every later session.
 */

import { describe, expect, it } from 'vitest'
import { DESIGN_BRAIN_ENDPOINT, verifyDesignBrain } from '../src/client/design-brain.ts'

/** One JSON-RPC reply body. */
function rpc(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch stub answering the queued replies in order, recording each body. */
function scriptedFetch(...replies: (() => Response | Promise<Response>)[]): {
  fetchImpl: typeof fetch
  bodies: string[]
} {
  const bodies: string[] = []
  const queue = [...replies]
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    bodies.push(typeof init?.body === 'string' ? init.body : '')
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected fetch call')
    return next()
  }
  return { fetchImpl, bodies }
}

describe('verifyDesignBrain', () => {
  it('points at the public brain endpoint by default', () => {
    expect(DESIGN_BRAIN_ENDPOINT).toBe('https://saturnai.tools/api/mcp')
  })

  it('verifies only after a real handshake names the offered tools', async () => {
    const { fetchImpl, bodies } = scriptedFetch(
      () => rpc({ protocolVersion: '2025-06-18', capabilities: {} }),
      () => rpc({
        tools: [
          { name: 'intake', description: 'lock context' },
          { name: 'compose' },
          { name: 'review' },
        ],
      }),
    )
    await expect(verifyDesignBrain('https://brain.test/mcp', fetchImpl))
      .resolves.toEqual({ kind: 'verified', tools: ['intake', 'compose', 'review'] })
    // The two bodies are the initialize then the tools/list of one handshake.
    expect(JSON.parse(bodies[1]!)).toMatchObject({ method: 'tools/list' })
  })

  it.each([
    ['a non-2xx handshake answer', () => Promise.resolve(new Response('nope', { status: 503 }))],
    ['a transport failure', () => Promise.reject(new Error('fetch failed'))],
  ])('reports %s as unreachable instead of guessing', async (_label, answer) => {
    const { fetchImpl } = scriptedFetch(answer)
    const outcome = await verifyDesignBrain('https://brain.test/mcp', fetchImpl)
    expect(outcome.kind).toBe('unreachable')
    if (outcome.kind === 'unreachable') expect(outcome.message.length).toBeGreaterThan(0)
  })

  it('reports a handshake body that is not a JSON-RPC result', async () => {
    const { fetchImpl } = scriptedFetch(() => new Response('"hello"', { status: 200 }))
    await expect(verifyDesignBrain('https://brain.test/mcp', fetchImpl))
      .resolves.toEqual({ kind: 'unreachable', message: 'the endpoint did not answer a handshake' })
  })

  it('reports a refused or empty tools listing', async () => {
    for (const [answer, message] of [
      [() => new Response('{}', { status: 500 }), 'the endpoint answered 500'],
      [() => rpc({ tools: 'many' }), 'the endpoint listed no tools'],
      [() => rpc({ tools: [] }), 'the endpoint listed no tools'],
      [() => rpc({ tools: [{ name: '' }, { description: 'x' }] }), 'the endpoint listed no tools'],
    ] as const) {
      const { fetchImpl } = scriptedFetch(() => rpc({ capabilities: {} }), answer)
      await expect(verifyDesignBrain('https://brain.test/mcp', fetchImpl))
        .resolves.toEqual({ kind: 'unreachable', message })
    }
  })
})
