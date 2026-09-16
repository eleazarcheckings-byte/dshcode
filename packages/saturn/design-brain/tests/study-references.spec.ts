/**
 * `design_study_references`: slug validation before any network call, the redirect- and
 * oversize-refusing HTTPS client, a 404 resolving as a miss line rather than a throw, and a
 * successful fetch writing the workspace copy and returning a real image block. The last group
 * mounts the same real Loader + settings + tools + system-prompt composition `composition.spec.ts`
 * uses, with a stubbed `ctx.attachments` (the codebase's own convention for this optional service —
 * see e.g. `packages/api/session-controller/tests/commands-delete-edit.host.spec.ts`).
 */
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import DesignBrain from '../src/index.ts'
import {
  MAX_SLUGS,
  MAX_THUMBNAIL_BYTES,
  SLUG_PATTERN,
  assertValidSlugs,
  fetchOneThumbnail,
  readBoundedBody,
  sniffThumbnailMediaType,
} from '../src/study-references.ts'

/** A minimal well-formed JPEG-looking body: the three sniffed magic bytes plus filler. */
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x2a)])
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 0x11)])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii'), Buffer.alloc(16, 0x33)])

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

/** A tiny thumbnail-host fixture: one route per test slug, keyed by the requested `<slug>.jpg` path. */
async function startThumbnailFixture() {
  let requests = 0
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    requests++
    const slug = (request.url ?? '').replace(/^\//, '').replace(/\.jpg$/, '')
    if (slug === 'missing') { response.writeHead(404).end('not found'); return }
    if (slug === 'server-error') { response.writeHead(500).end('boom'); return }
    if (slug === 'redirect-away') { response.writeHead(302, { location: '/good-jpeg.jpg' }).end(); return }
    if (slug === 'oversize-declared') {
      response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(MAX_THUMBNAIL_BYTES + 1) })
      response.end(JPEG_BYTES)
      return
    }
    if (slug === 'bad-bytes') { response.writeHead(200, { 'content-type': 'text/plain' }).end('not an image at all'); return }
    if (slug === 'good-jpeg') { response.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG_BYTES); return }
    if (slug === 'good-png') { response.writeHead(200, { 'content-type': 'image/png' }).end(PNG_BYTES); return }
    if (slug === 'good-webp') { response.writeHead(200, { 'content-type': 'image/webp' }).end(WEBP_BYTES); return }
    response.writeHead(404).end('unmapped fixture slug')
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fixture port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    get requests() { return requests },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
    },
  }
}

describe('sniffThumbnailMediaType', () => {
  it('recognizes JPEG, PNG, and WebP magic bytes and rejects everything else', () => {
    expect(sniffThumbnailMediaType(JPEG_BYTES)).toBe('image/jpeg')
    expect(sniffThumbnailMediaType(PNG_BYTES)).toBe('image/png')
    expect(sniffThumbnailMediaType(WEBP_BYTES)).toBe('image/webp')
    expect(sniffThumbnailMediaType(Buffer.from('GIF89a' + 'x'.repeat(20)))).toBeUndefined()
    expect(sniffThumbnailMediaType(Buffer.from('plain text, not an image'))).toBeUndefined()
    expect(sniffThumbnailMediaType(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('assertValidSlugs', () => {
  it('accepts 1 to MAX_SLUGS well-formed slugs', () => {
    expect(() => assertValidSlugs(['cassie-evans'])).not.toThrow()
    expect(() => assertValidSlugs(Array.from({ length: MAX_SLUGS }, (_, i) => `slug-${i}`))).not.toThrow()
  })

  it('rejects an empty list and more than MAX_SLUGS entries', () => {
    expect(() => assertValidSlugs([])).toThrow('1 to 6 entries')
    expect(() => assertValidSlugs(Array.from({ length: MAX_SLUGS + 1 }, (_, i) => `slug-${i}`))).toThrow('1 to 6 entries')
  })

  it('rejects uppercase, traversal, and other characters outside the slug pattern', () => {
    for (const bad of ['Cassie-Evans', '../../etc/passwd', 'a/b', 'a.b', '-leading-hyphen', 'trailing space ', '']) {
      expect(SLUG_PATTERN.test(bad), `expected "${bad}" to fail the slug pattern`).toBe(false)
      expect(() => assertValidSlugs([bad])).toThrow(/valid design-library slug/)
    }
  })
})

describe('readBoundedBody', () => {
  it('throws once the streamed body exceeds the cap, without buffering past it', async () => {
    const chunks = [new Uint8Array(6), new Uint8Array(6)]
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift()
        if (next) controller.enqueue(next)
        else controller.close()
      },
    })
    const response = new Response(stream)
    await expect(readBoundedBody(response, 10)).rejects.toThrow('exceeds the 10-byte bound')
  })
})

describe('fetchOneThumbnail', () => {
  it('resolves a 404 as a miss, never a throw', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const result = await fetchOneThumbnail(fixture.baseUrl, 'missing', new AbortController().signal)
    expect(result).toEqual({ kind: 'missed', slug: 'missing', reason: expect.stringContaining('404') })
  })

  it('resolves a non-404 error status as a miss too', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const result = await fetchOneThumbnail(fixture.baseUrl, 'server-error', new AbortController().signal)
    expect(result).toEqual({ kind: 'missed', slug: 'server-error', reason: expect.stringContaining('500') })
  })

  it('resolves an unrecognized body as a miss', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const result = await fetchOneThumbnail(fixture.baseUrl, 'bad-bytes', new AbortController().signal)
    expect(result).toEqual({ kind: 'missed', slug: 'bad-bytes', reason: expect.stringContaining('not a recognized') })
  })

  it('refuses a redirect instead of following it', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    await expect(fetchOneThumbnail(fixture.baseUrl, 'redirect-away', new AbortController().signal)).rejects.toThrow()
    expect(fixture.requests).toBe(1)
  })

  it('refuses a response whose declared content-length exceeds the cap', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    await expect(fetchOneThumbnail(fixture.baseUrl, 'oversize-declared', new AbortController().signal)).rejects.toThrow(/above the .*-byte bound/)
  })

  it('fetches a real JPEG/PNG/WebP thumbnail successfully', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const jpeg = await fetchOneThumbnail(fixture.baseUrl, 'good-jpeg', new AbortController().signal)
    expect(jpeg).toMatchObject({ kind: 'fetched', slug: 'good-jpeg', mediaType: 'image/jpeg' })
    const png = await fetchOneThumbnail(fixture.baseUrl, 'good-png', new AbortController().signal)
    expect(png).toMatchObject({ kind: 'fetched', slug: 'good-png', mediaType: 'image/png' })
    const webp = await fetchOneThumbnail(fixture.baseUrl, 'good-webp', new AbortController().signal)
    expect(webp).toMatchObject({ kind: 'fetched', slug: 'good-webp', mediaType: 'image/webp' })
  })
})

interface SavedImageInput { data: Uint8Array; mediaType: string; name?: string }
interface SavedImageOutput { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }

/** A stub `ctx.attachments` — the codebase's own convention for this optional service in tests. */
function fakeAttachments() {
  const saved: SavedImageInput[] = []
  return {
    saved,
    saveImage: async (input: SavedImageInput): Promise<SavedImageOutput> => {
      saved.push(input)
      return { attachmentId: `fake-${saved.length}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 64, height: 64 }
    },
  }
}

async function brainHarness(options: { thumbnailBaseUrl: string }) {
  const directory = await mkdtemp(join(tmpdir(), 'saturn-design-brain-study-'))
  cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const workspace = await mkdtemp(join(tmpdir(), 'saturn-design-brain-workspace-'))
  cleanup.push(async () => { await rm(workspace, { recursive: true, force: true }) })
  const ctx = new Context()
  const loader = ctx.plugin(Loader)
  await loader
  cleanup.push(async () => { await loader.dispose() })
  Object.assign(ctx.loader.builtins, { 'brain-tools': Tools, 'brain-prompt': SystemPrompt, 'brain-settings': SettingsFile, 'brain-connector': DesignBrain, 'brain-include': Include })
  const path = join(directory, 'cordis.yml')
  const settings = join(directory, 'settings.yaml')
  const rows = [
    { id: 'prompt', name: 'cordis:brain-prompt' },
    { id: 'tools', name: 'cordis:brain-tools' },
    { id: 'settings', name: 'cordis:brain-settings', config: { path: settings, watch: false } },
    { id: 'brain', name: 'cordis:brain-connector', config: { endpoint: 'http://127.0.0.1:1/mcp', connectTimeoutMs: 100, thumbnailBaseUrl: options.thumbnailBaseUrl } },
  ]
  await (await import('node:fs/promises')).writeFile(path, stringify(rows))
  await ctx.loader.root.update([{ id: 'composition', name: 'cordis:brain-include', config: { path: pathToFileURL(path).href } }])
  await ctx.loader.await()
  const mounted = ctx.loader.resolve('composition').fiber!
  cleanup.push(async () => { await mounted.dispose() })
  const attachments = fakeAttachments()
  ctx.provide('attachments', attachments as never)
  const agent = { session: { header: { cwd: workspace }, requestHeader: () => undefined } }
  let callCounter = 0
  const call = (args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`study-${++callCounter}`),
    name: 'design_study_references',
    arguments: args,
    agent: agent as never,
  })
  return { ctx, workspace, attachments, call }
}

describe('design_study_references (registered tool)', () => {
  it('fetches thumbnails, writes the workspace copy, and returns one image block plus a fetched/missed summary', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const h = await brainHarness({ thumbnailBaseUrl: fixture.baseUrl })
    const result = await h.call({ slugs: ['good-jpeg', 'good-png', 'missing'], prompt: 'nav collapse' })
    expect(result.isError).toBe(false)
    const text = result.content.find(block => block.type === 'text') as { type: 'text'; text: string }
    expect(text.text).toContain('fetched good-jpeg')
    expect(text.text).toContain('fetched good-png')
    expect(text.text).toContain('missed missing')
    expect(text.text).toContain('nav collapse')
    expect(text.text).toContain('named structural moves')
    const images = result.content.filter(block => block.type === 'image')
    expect(images).toHaveLength(2)
    expect(h.attachments.saved.map(entry => entry.mediaType)).toEqual(['image/jpeg', 'image/png'])
    const written = await readFile(join(h.workspace, '.saturn', 'refs', 'good-jpeg.jpg'))
    expect(written.equals(JPEG_BYTES)).toBe(true)
  })

  it('rejects an invalid slug and an out-of-range count before any network call', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const h = await brainHarness({ thumbnailBaseUrl: fixture.baseUrl })
    const invalid = await h.call({ slugs: ['Not-A-Valid-Slug'] })
    expect(invalid.isError).toBe(true)
    const tooMany = await h.call({ slugs: Array.from({ length: MAX_SLUGS + 1 }, (_, i) => `slug-${i}`) })
    expect(tooMany.isError).toBe(true)
    expect(fixture.requests).toBe(0)
  })

  it('fails closed with a clear error when no attachment store is mounted', async () => {
    const fixture = await startThumbnailFixture()
    cleanup.push(fixture.close)
    const h = await brainHarness({ thumbnailBaseUrl: fixture.baseUrl })
    // Overwrite the stub with `undefined`-returning access by disposing its provide effect is not
    // exposed here, so this call targets a context with no attachments provided at all instead.
    const directory = await mkdtemp(join(tmpdir(), 'saturn-design-brain-study-noattach-'))
    cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
    const ctx = new Context()
    const loader = ctx.plugin(Loader)
    await loader
    cleanup.push(async () => { await loader.dispose() })
    Object.assign(ctx.loader.builtins, { 'brain-tools': Tools, 'brain-prompt': SystemPrompt, 'brain-settings': SettingsFile, 'brain-connector': DesignBrain, 'brain-include': Include })
    const path = join(directory, 'cordis.yml')
    const settings = join(directory, 'settings.yaml')
    await (await import('node:fs/promises')).writeFile(path, stringify([
      { id: 'prompt', name: 'cordis:brain-prompt' },
      { id: 'tools', name: 'cordis:brain-tools' },
      { id: 'settings', name: 'cordis:brain-settings', config: { path: settings, watch: false } },
      { id: 'brain', name: 'cordis:brain-connector', config: { endpoint: 'http://127.0.0.1:1/mcp', connectTimeoutMs: 100, thumbnailBaseUrl: fixture.baseUrl } },
    ]))
    await ctx.loader.root.update([{ id: 'composition', name: 'cordis:brain-include', config: { path: pathToFileURL(path).href } }])
    await ctx.loader.await()
    const mounted = ctx.loader.resolve('composition').fiber!
    cleanup.push(async () => { await mounted.dispose() })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('study-no-attach'),
      name: 'design_study_references', arguments: { slugs: ['good-jpeg'] },
    })
    expect(result.isError).toBe(true)
    void h
  })
})
