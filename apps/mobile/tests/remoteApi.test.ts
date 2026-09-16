import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as remoteApi from '../src/lib/remoteApi.ts'
import { RemoteEventsClient } from '../src/lib/remoteApi.ts'

// Mars r2 (M3-apps-mobile-r2.md) R2-F1: the background runner did a one-shot
// `fetch('.../events?since=poll')` + `text()` against the host's
// GET /saturn/remote/events route, which is SSE-only and never closes on its
// own (packages/saturn/remote-access/src/proxy.ts's stream() -- a 25s
// heartbeat that ends only when the client closes -- and the router strips
// the query string before dispatch), so the read never resolved. The same
// trap lived, uncalled, in RemoteEventsClient.pollOnce(), whose doc comment
// called it "the background-safe fallback" although the real background path
// is src/lib/backgroundSync.ts + assets/background-runner.js. pollOnce() was
// removed rather than fixed, and the bearer deviceToken the constructor took
// only for it went with it. These tests pin the client to the
// EventSource-only contract src/main.ts actually uses, and guard against the
// poll shape coming back.

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((message: MessageEvent) => void) | null = null
  onerror: ((err: Event) => void) | null = null
  closed = false

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }
}

const HOST = 'https://192.168.1.9:8443'

function makeClient() {
  const onEvent = vi.fn()
  const onError = vi.fn()
  const client = new RemoteEventsClient(HOST, onEvent, onError)
  return { client, onEvent, onError }
}

describe('RemoteEventsClient -- the foregrounded EventSource path', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('start() opens the events route cookie-authenticated, with no query string and no fetch', () => {
    const { client } = makeClient()
    client.start()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe(`${HOST}/saturn/remote/events`)
    expect(FakeEventSource.instances[0]?.init).toEqual({ withCredentials: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('start() is idempotent while a stream is already open', () => {
    const { client } = makeClient()
    client.start()
    client.start()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('hands each parsed message to onEvent', () => {
    const { client, onEvent, onError } = makeClient()
    client.start()
    const event = { id: '7', type: 'approval', title: '', body: 'needs you', at: '2026-09-15T00:00:00.000Z' }
    FakeEventSource.instances[0]?.onmessage?.({ data: JSON.stringify(event) } as MessageEvent)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(event)
    expect(onError).not.toHaveBeenCalled()
  })

  it('routes a malformed message to onError instead of throwing or delivering it', () => {
    const { client, onEvent, onError } = makeClient()
    client.start()
    expect(() => FakeEventSource.instances[0]?.onmessage?.({ data: '{not json' } as MessageEvent)).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('forwards a stream error to onError', () => {
    const { client, onError } = makeClient()
    client.start()
    const err = new Event('error')
    FakeEventSource.instances[0]?.onerror?.(err)
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('stop() closes the stream, is safe before start(), and lets a later start() open a fresh one', () => {
    const { client } = makeClient()
    expect(() => client.stop()).not.toThrow()
    client.start()
    const first = FakeEventSource.instances[0]
    client.stop()
    expect(first?.closed).toBe(true)
    client.start()
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[1]?.closed).toBe(false)
  })
})

describe('no one-shot poll of the SSE-only events route (Mars r2 R2-F1)', () => {
  it('the client exposes only start() and stop() -- no pollOnce()', () => {
    expect(Object.getOwnPropertyNames(RemoteEventsClient.prototype).sort()).toEqual(['constructor', 'start', 'stop'])
    expect('pollOnce' in new RemoteEventsClient(HOST, () => {})).toBe(false)
  })

  it('the module carries no SSE-text parser; that lives in src/lib/backgroundEventsCore.js', () => {
    expect(Object.keys(remoteApi).sort()).toEqual([
      'RemoteApiError',
      'RemoteEventsClient',
      'checkHostReachable',
      'pairWithHost',
      'revokeDevice',
    ])
  })
})
