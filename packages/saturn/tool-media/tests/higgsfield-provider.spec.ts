import { afterEach, describe, expect, it } from 'vitest'
import * as higgsfield from '../src/providers/higgsfield.ts'
import { jsonReply, rawReply, startMockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

async function server(handler: Parameters<typeof startMockServer>[0]) {
  const instance = await startMockServer(handler)
  cleanup.push(instance.close)
  return instance
}

describe('resolveHiggsfieldConfig', () => {
  it('applies documented defaults and strips slashes', () => {
    expect(higgsfield.resolveHiggsfieldConfig({ imageModelPath: '/higgsfield-ai/soul/standard/' })).toMatchObject({
      baseURL: higgsfield.DEFAULT_HIGGSFIELD_BASE_URL,
      imageModelPath: 'higgsfield-ai/soul/standard/',
    })
  })

  it('rejects a non-http(s) baseURL', () => {
    expect(() => higgsfield.resolveHiggsfieldConfig({ baseURL: 'ftp://x' })).toThrow(/baseURL must be an absolute http\(s\) URL/)
  })
})

describe('parseHiggsfieldCredential', () => {
  it('splits "{id}:{secret}" on the first colon', () => {
    expect(higgsfield.parseHiggsfieldCredential('key-id:key-secret')).toEqual({ keyId: 'key-id', keySecret: 'key-secret' })
  })

  it('keeps everything after the first colon as the secret', () => {
    expect(higgsfield.parseHiggsfieldCredential('id:sec:ret')).toEqual({ keyId: 'id', keySecret: 'sec:ret' })
  })

  it('rejects a value with no colon, a leading colon, or a trailing colon', () => {
    for (const bad of ['no-colon-here', ':leading', 'trailing:']) {
      expect(() => higgsfield.parseHiggsfieldCredential(bad)).toThrow(/HIGGSFIELD_API_KEY must be/)
    }
  })
})

describe('normalizeHiggsfieldStatus', () => {
  it.each([
    ['queued', 'queued'],
    ['in_progress', 'running'],
    ['completed', 'done'],
    ['failed', 'failed'],
    ['nsfw', 'failed'],
    ['canceled', 'failed'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(higgsfield.normalizeHiggsfieldStatus(status)).toBe(expected)
  })
})

const credential = { keyId: 'kid', keySecret: 'ksecret' }

describe('submitHiggsfieldRequest', () => {
  it('POSTs to the model path with the combined Authorization header', async () => {
    const mock = await server((_request, res) => {
      jsonReply(res, 200, { status: 'queued', request_id: 'req-1', status_url: 'https://x/status', cancel_url: 'https://x/cancel' })
    })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    const accepted = await higgsfield.submitHiggsfieldRequest(spec, credential, 'higgsfield-ai/soul/standard', { prompt: 'x' }, new AbortController().signal)
    expect(accepted.request_id).toBe('req-1')
    const request = mock.request(0)
    expect(request.path).toBe('/higgsfield-ai/soul/standard')
    expect(request.authorization).toBe('Key kid:ksecret')
    expect(request.body).toEqual({ prompt: 'x' })
  })

  it('surfaces a non-2xx response as an HTTP failure', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 401, { detail: 'Invalid credentials' }) })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    await expect(higgsfield.submitHiggsfieldRequest(spec, credential, 'higgsfield-ai/soul/standard', {}, new AbortController().signal))
      .rejects.toThrow(/HTTP 401/)
  })
})

describe('estimateHiggsfieldCost', () => {
  it('POSTs to /estimate/{modelPath} and parses the usd figure', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { credits: '1.500', usd: '0.094' }) })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    const cost = await higgsfield.estimateHiggsfieldCost(spec, credential, 'higgsfield-ai/soul/standard', { prompt: 'x' }, new AbortController().signal)
    expect(cost).toEqual({ estimatedUsd: 0.094, provider: 'higgsfield', model: 'higgsfield-ai/soul/standard' })
    expect(mock.request(0).path).toBe('/estimate/higgsfield-ai/soul/standard')
  })

  it('throws rather than guess when usd is not numeric', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { credits: '1', usd: 'not-a-number' }) })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    await expect(higgsfield.estimateHiggsfieldCost(spec, credential, 'x', {}, new AbortController().signal))
      .rejects.toThrow(/non-numeric usd value/)
  })
})

describe('getHiggsfieldStatus / cancelHiggsfieldRequest', () => {
  it('GETs the status endpoint', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { status: 'completed', request_id: 'req-2', images: [{ url: 'https://cdn/x.jpg' }] }) })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    const status = await higgsfield.getHiggsfieldStatus(spec, credential, 'req-2', new AbortController().signal)
    expect(status).toMatchObject({ status: 'completed', images: [{ url: 'https://cdn/x.jpg' }] })
    expect(mock.request(0).path).toBe('/requests/req-2/status')
  })

  it('reports 202 as canceled and 400 as already-started', async () => {
    let call = 0
    const mock = await server((_request, res) => {
      call += 1
      res.writeHead(call === 1 ? 202 : 400).end()
    })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url })
    expect(await higgsfield.cancelHiggsfieldRequest(spec, credential, 'req-3', new AbortController().signal)).toBe(true)
    expect(await higgsfield.cancelHiggsfieldRequest(spec, credential, 'req-3', new AbortController().signal)).toBe(false)
  })
})

describe('pollHiggsfieldUntilTerminal', () => {
  it('polls with backoff until a terminal status', async () => {
    let call = 0
    const mock = await server((_request, res) => {
      call += 1
      if (call < 3) { jsonReply(res, 200, { status: 'in_progress', request_id: 'req-4' }); return }
      jsonReply(res, 200, { status: 'completed', request_id: 'req-4', images: [{ url: 'https://cdn/done.jpg' }] })
    })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url, pollIntervalMs: 5 })
    const status = await higgsfield.pollHiggsfieldUntilTerminal(spec, credential, 'req-4', new AbortController().signal)
    expect(status.status).toBe('completed')
    expect(call).toBe(3)
  })

  it('gives up after the poll timeout budget', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { status: 'queued', request_id: 'req-5' }) })
    const spec = higgsfield.resolveHiggsfieldConfig({ baseURL: mock.url, pollIntervalMs: 5, pollTimeoutMs: 20 })
    await expect(higgsfield.pollHiggsfieldUntilTerminal(spec, credential, 'req-5', new AbortController().signal))
      .rejects.toThrow(/did not reach a terminal state within/)
  })
})

describe('downloadHiggsfieldAsset', () => {
  it('downloads the plain (uncredentialed) CDN url', async () => {
    const bytes = Buffer.from('image-bytes')
    const mock = await server((_request, res) => { rawReply(res, 200, bytes, 'image/jpeg') })
    const downloaded = await higgsfield.downloadHiggsfieldAsset(`${mock.url}/x.jpg`, new AbortController().signal)
    expect(downloaded.equals(bytes)).toBe(true)
  })
})
