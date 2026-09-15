import { afterEach, describe, expect, it } from 'vitest'
import * as openai from '../src/providers/openai.ts'
import { jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

async function server(handler: Parameters<typeof startMockServer>[0]) {
  const instance = await startMockServer(handler)
  cleanup.push(instance.close)
  return instance
}

describe('resolveOpenAiConfig', () => {
  it('applies documented defaults', () => {
    expect(openai.resolveOpenAiConfig({})).toEqual({
      baseURL: openai.DEFAULT_OPENAI_BASE_URL,
      imageModel: openai.DEFAULT_OPENAI_IMAGE_MODEL,
      timeoutMs: openai.DEFAULT_OPENAI_TIMEOUT_MS,
    })
  })

  it('rejects a non-http(s) baseURL', () => {
    expect(() => openai.resolveOpenAiConfig({ baseURL: 'ftp://x' })).toThrow(/baseURL must be an absolute http\(s\) URL/)
  })
})

describe('openAiImageCost', () => {
  it('requires an explicit positive pricePerImageUsd override', () => {
    expect(() => openai.openAiImageCost('gpt-image-2.5-flare', undefined)).toThrow(/no verified per-image price is on file/)
    expect(() => openai.openAiImageCost('gpt-image-2.5-flare', 0)).toThrow(/no verified per-image price is on file/)
    expect(() => openai.openAiImageCost('gpt-image-2.5-flare', -1)).toThrow(/no verified per-image price is on file/)
    expect(() => openai.openAiImageCost('gpt-image-2.5-flare', Number.NaN)).toThrow(/no verified per-image price is on file/)
  })

  it('accepts and rounds a valid override', () => {
    expect(openai.openAiImageCost('gpt-image-2.5-flare', 0.04321)).toEqual({ estimatedUsd: 0.04, provider: 'openai', model: 'gpt-image-2.5-flare' })
  })
})

describe('generateOpenAiImage', () => {
  it('POSTs to /images/generations with a bearer token and decodes b64_json', async () => {
    const mock = await server((_request, res) => {
      jsonReply(res, 200, { data: [{ b64_json: PNG_BYTES.toString('base64') }] })
    })
    const spec = openai.resolveOpenAiConfig({ baseURL: mock.url })
    const media = await openai.generateOpenAiImage(spec, 'sk-test', 'a red square', undefined, new AbortController().signal)
    expect(media.mimeType).toBe('image/png')
    expect(media.data.equals(PNG_BYTES)).toBe(true)

    const request = mock.request(0)
    expect(request.path).toBe('/images/generations')
    expect(request.authorization).toBe('Bearer sk-test')
    expect(request.body).toMatchObject({ model: openai.DEFAULT_OPENAI_IMAGE_MODEL, prompt: 'a red square', n: 1 })
  })

  it('forwards size/quality/output_format when given', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { data: [{ b64_json: PNG_BYTES.toString('base64') }] }) })
    const spec = openai.resolveOpenAiConfig({ baseURL: mock.url })
    await openai.generateOpenAiImage(spec, 'sk-test', 'x', { size: '1536x1024', quality: 'high', outputFormat: 'jpeg' }, new AbortController().signal)
    expect(mock.request(0).body).toMatchObject({ size: '1536x1024', quality: 'high', output_format: 'jpeg' })
  })

  it('rejects a hosted-url-only response rather than silently returning nothing', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 200, { data: [{ url: 'https://cdn.example.com/x.png' }] }) })
    const spec = openai.resolveOpenAiConfig({ baseURL: mock.url })
    await expect(openai.generateOpenAiImage(spec, 'sk-test', 'x', undefined, new AbortController().signal))
      .rejects.toThrow(/returned no inline b64_json image/)
  })

  it('never follows a redirect on the credential-bearing request', async () => {
    const target = await server((_request, res) => { jsonReply(res, 200, { data: [{ b64_json: PNG_BYTES.toString('base64') }] }) })
    const mock = await server((_request, res) => {
      res.writeHead(302, { location: `${target.url}/images/generations` })
      res.end()
    })
    const spec = openai.resolveOpenAiConfig({ baseURL: mock.url })
    await expect(openai.generateOpenAiImage(spec, 'sk-test', 'x', undefined, new AbortController().signal)).rejects.toThrow()
    expect(target.requests).toHaveLength(0)
  })

  it('surfaces a non-2xx response as an HTTP failure', async () => {
    const mock = await server((_request, res) => { jsonReply(res, 400, { error: 'bad request' }) })
    const spec = openai.resolveOpenAiConfig({ baseURL: mock.url })
    await expect(openai.generateOpenAiImage(spec, 'sk-test', 'x', undefined, new AbortController().signal))
      .rejects.toThrow(/openai: image generation: HTTP 400/)
  })
})
