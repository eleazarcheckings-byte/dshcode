import { afterEach, describe, expect, it } from 'vitest'
import * as gemini from '../src/providers/gemini.ts'
import { DEFAULT_GEMINI_IMAGE_USD } from '../src/pricing.ts'
import { jsonReply, PNG_BYTES, rawReply, startMockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

async function server(handler: Parameters<typeof startMockServer>[0]) {
  const instance = await startMockServer(handler)
  cleanup.push(instance.close)
  return instance
}

describe('resolveGeminiConfig', () => {
  it('applies documented defaults and strips trailing slashes', () => {
    const spec = gemini.resolveGeminiConfig({ baseURL: 'https://example.com/v1beta///' })
    expect(spec).toMatchObject({
      baseURL: 'https://example.com/v1beta',
      imageModel: gemini.DEFAULT_GEMINI_IMAGE_MODEL,
      videoModel: gemini.DEFAULT_GEMINI_VIDEO_MODEL,
      timeoutMs: gemini.DEFAULT_GEMINI_TIMEOUT_MS,
      pollIntervalMs: gemini.DEFAULT_GEMINI_POLL_INTERVAL_MS,
      pollTimeoutMs: gemini.DEFAULT_GEMINI_POLL_TIMEOUT_MS,
    })
  })

  it('rejects a non-http(s) baseURL', () => {
    expect(() => gemini.resolveGeminiConfig({ baseURL: 'ftp://x' })).toThrow(/baseURL must be an absolute http\(s\) URL/)
  })

  it('rejects a non-positive timeout', () => {
    expect(() => gemini.resolveGeminiConfig({ timeoutMs: 0 })).toThrow(/timeoutMs must be a positive safe integer/)
  })
})

describe('pricing', () => {
  it('reports the verified per-image price for the default model', () => {
    expect(gemini.geminiImageCost(gemini.DEFAULT_GEMINI_IMAGE_MODEL)).toEqual({
      estimatedUsd: 0.067,
      provider: 'gemini',
      model: gemini.DEFAULT_GEMINI_IMAGE_MODEL,
    })
  })

  it('falls back to the default per-image price for an unverified model override', () => {
    expect(gemini.geminiImageCost('some-future-model')).toEqual({
      estimatedUsd: DEFAULT_GEMINI_IMAGE_USD,
      provider: 'gemini',
      model: 'some-future-model',
    })
  })

  it('multiplies the per-second video price by duration', () => {
    expect(gemini.geminiVideoCost('veo-3.1-fast-generate-preview', 6)).toEqual({
      estimatedUsd: 0.6,
      provider: 'gemini',
      model: 'veo-3.1-fast-generate-preview',
    })
  })
})

describe('generateGeminiImage', () => {
  it('POSTs to /interactions with the api key header and decodes output_image', async () => {
    const mock = await server((_request, res) => {
      jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } })
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url })

    const media = await gemini.generateGeminiImage(spec, 'sk-test', 'a red square', new AbortController().signal)
    expect(media.mimeType).toBe('image/png')
    expect(media.data.equals(PNG_BYTES)).toBe(true)

    const request = mock.request(0)
    expect(request.path).toBe('/interactions')
    expect(request.apiKeyHeader).toBe('sk-test')
    expect(request.body).toMatchObject({ model: gemini.DEFAULT_GEMINI_IMAGE_MODEL, input: [{ type: 'text', text: 'a red square' }] })
  })

  it('accepts the camelCase output_image fallback', async () => {
    const mock = await server((_request, res) => {
      jsonReply(res, 200, { outputImage: { imageBytes: PNG_BYTES.toString('base64'), mimeType: 'image/png' } })
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url })
    const media = await gemini.generateGeminiImage(spec, 'sk-test', 'x', new AbortController().signal)
    expect(media.data.equals(PNG_BYTES)).toBe(true)
  })

  it('throws a descriptive error naming the observed keys when output_image is absent', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { unexpected: true }) })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url })
    await expect(gemini.generateGeminiImage(spec, 'sk-test', 'x', new AbortController().signal))
      .rejects.toThrow(/carried no output_image \(keys seen: unexpected\)/)
  })

  it('never follows a redirect on the credential-bearing interactions call', async () => {
    const target = await server((_request, res) => {
      jsonReply(res, 200, { output_image: { data: PNG_BYTES.toString('base64'), mime_type: 'image/png' } })
    })
    const mock = await server((_request, res) => {
      res.writeHead(302, { location: `${target.url}/interactions` })
      res.end()
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url })
    await expect(gemini.generateGeminiImage(spec, 'sk-test', 'x', new AbortController().signal)).rejects.toThrow()
    expect(target.requests).toHaveLength(0)
  })

  it('surfaces a non-2xx response as an HTTP failure', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 401, { error: 'bad key' }) })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url })
    await expect(gemini.generateGeminiImage(spec, 'sk-bad', 'x', new AbortController().signal))
      .rejects.toThrow(/gemini: image generation: HTTP 401/)
  })
})

describe('generateGeminiVideo', () => {
  it('submits, polls to done, and downloads the completed video', async () => {
    const videoBytes = Buffer.from('fake-mp4-bytes')
    let pollCount = 0
    const mock = await server((request, res) => {
      if (request.method === 'POST' && request.path === `/models/${gemini.DEFAULT_GEMINI_VIDEO_MODEL}:predictLongRunning`) {
        jsonReply(res, 200, { name: 'operations/op-1' })
        return
      }
      if (request.method === 'GET' && request.path === '/operations/op-1') {
        pollCount += 1
        if (pollCount < 2) {
          jsonReply(res, 200, { done: false })
          return
        }
        jsonReply(res, 200, {
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${mock.url}/download.mp4` } }] } },
        })
        return
      }
      if (request.method === 'GET' && request.path === '/download.mp4') {
        rawReply(res, 200, videoBytes, 'video/mp4')
        return
      }
      res.writeHead(404).end()
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5 })

    const media = await gemini.generateGeminiVideo(spec, 'sk-test', 'a dog running', undefined, new AbortController().signal)
    expect(media.mimeType).toBe('video/mp4')
    expect(media.data.equals(videoBytes)).toBe(true)
    expect(pollCount).toBe(2)
    expect(mock.request(0).body).toMatchObject({ instances: [{ prompt: 'a dog running' }] })
  })

  it('sends aspectRatio/durationSeconds/resolution as Veo parameters when given', async () => {
    const videoBytes = Buffer.from('bytes')
    const mock = await server((request, res) => {
      if (request.path.endsWith(':predictLongRunning')) { jsonReply(res, 200, { name: 'operations/op-2' }); return }
      if (request.path === '/operations/op-2') {
        jsonReply(res, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${mock.url}/d.mp4` } }] } } })
        return
      }
      if (request.path === '/d.mp4') { rawReply(res, 200, videoBytes, 'video/mp4'); return }
      res.writeHead(404).end()
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5 })
    const params = { aspectRatio: '9:16' as const, durationSeconds: '4' as const, resolution: '720p' as const }
    await gemini.generateGeminiVideo(spec, 'sk-test', 'x', params, new AbortController().signal)
    expect(mock.request(0).body).toMatchObject({
      instances: [{ prompt: 'x' }],
      parameters: { aspectRatio: '9:16', durationSeconds: '4', resolution: '720p' },
    })
  })

  it('throws on a failed operation, naming the provider error message', async () => {
    const mock = await server((request, res) => {
      if (request.path.endsWith(':predictLongRunning')) { jsonReply(res, 200, { name: 'operations/op-fail' }); return }
      jsonReply(res, 200, { done: true, error: { message: 'content policy violation' } })
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5 })
    await expect(gemini.generateGeminiVideo(spec, 'sk-test', 'x', undefined, new AbortController().signal))
      .rejects.toThrow(/content policy violation/)
  })

  it('gives up after the poll timeout budget when the operation never completes', async () => {
    const mock = await server((request, res) => {
      if (request.path.endsWith(':predictLongRunning')) { jsonReply(res, 200, { name: 'operations/op-slow' }); return }
      jsonReply(res, 200, { done: false })
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5, pollTimeoutMs: 20 })
    await expect(gemini.generateGeminiVideo(spec, 'sk-test', 'x', undefined, new AbortController().signal))
      .rejects.toThrow(/did not complete within/)
  })

  it('follows a same-host redirect on the signed video download', async () => {
    const videoBytes = Buffer.from('same-host-video')
    const mock = await server((request, res) => {
      if (request.path.endsWith(':predictLongRunning')) { jsonReply(res, 200, { name: 'operations/op-redir' }); return }
      if (request.path === '/operations/op-redir') {
        jsonReply(res, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${mock.url}/signed` } }] } } })
        return
      }
      if (request.path === '/signed') {
        res.writeHead(302, { location: `${mock.url}/actual.mp4` })
        res.end()
        return
      }
      if (request.path === '/actual.mp4') { rawReply(res, 200, videoBytes, 'video/mp4'); return }
      res.writeHead(404).end()
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5 })
    const media = await gemini.generateGeminiVideo(spec, 'sk-test', 'x', undefined, new AbortController().signal)
    expect(media.data.equals(videoBytes)).toBe(true)
  })

  it('refuses to follow a signed-download redirect to a different host', async () => {
    const other = await server((_request, res) => { rawReply(res, 200, Buffer.from('leaked'), 'video/mp4') })
    const mock = await server((request, res) => {
      if (request.path.endsWith(':predictLongRunning')) { jsonReply(res, 200, { name: 'operations/op-cross' }); return }
      if (request.path === '/operations/op-cross') {
        jsonReply(res, 200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${mock.url}/signed` } }] } } })
        return
      }
      if (request.path === '/signed') {
        res.writeHead(302, { location: `${other.url}/leak.mp4` })
        res.end()
        return
      }
      res.writeHead(404).end()
    })
    const spec = gemini.resolveGeminiConfig({ baseURL: mock.url, pollIntervalMs: 5 })
    await expect(gemini.generateGeminiVideo(spec, 'sk-test', 'x', undefined, new AbortController().signal))
      .rejects.toThrow(/refusing to follow a redirect to untrusted host/)
    expect(other.requests).toHaveLength(0)
  })
})
