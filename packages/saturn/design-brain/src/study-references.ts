/**
 * `design_study_references`: fetches SaturnAI design-library reference thumbnails as real image
 * content blocks, so the calling model studies them with eyes instead of only reading a text
 * direction about them. Every fetch goes straight to the public thumbnail host over a
 * redirect-refusing HTTPS client (the `packages/vision/tool-describe-image` convention), never
 * through the `mcp__saturnai__*` MCP tools, so this tool is available whether or not the MCP
 * connection in `./index.ts` is live.
 *
 * A model never invents a slug: it passes exactly what `compose`/`search`/`pick` returned. A
 * missing thumbnail (HTTP 404, or any non-2xx status) is reported as one miss line, never a
 * thrown error — one bad slug among up to six must not fail the whole study. A redirect or an
 * oversized response IS a hard refusal: both indicate the fetch left the host's stated contract,
 * so the whole call fails rather than silently degrading.
 * @module @saturnai/dsh-design-brain/study-references
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** The exact `ImageAttachmentRef`-shaped value an `ImageBlock` carries, named without a direct
 * `@deepseek-ai/dsh-attachment` dependency (design-brain stays a thin wrapper; the type still
 * resolves fully because `@deepseek-ai/dsh-llm` — an existing dependency — already imports it). */
type ImageAttachment = Extract<ContentBlock, { type: 'image' }>['attachment']

/** Design-library slugs this tool accepts: lowercase, digits, internal hyphens, no traversal. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/

/** Upper bound on how many references one call studies at once. */
export const MAX_SLUGS = 6

/** Upper bound on one thumbnail's bytes, declared or streamed. */
export const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024

/** Deployment default for the thumbnail host; `Config.thumbnailBaseUrl` in `./index.ts` overrides it for tests. */
export const DEFAULT_THUMBNAIL_BASE_URL = 'https://saturnai.tools/design/thumbnails/'

/** Image media types the magic-byte gate accepts; thumbnails are never GIF. */
export type ThumbnailMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

/**
 * Detect the image media type from magic bytes, the same conservative subset
 * `packages/vision/tool-describe-image` sniffs, minus GIF (thumbnails are never animated).
 * @param bytes - the leading bytes of the fetched body.
 * @returns the accepted media type, or `undefined` for unrecognized or truncated bytes.
 */
export function sniffThumbnailMediaType(bytes: Uint8Array): ThumbnailMediaType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return undefined
}

/**
 * Validate every requested slug before any network call, so a malformed slug (or a path-traversal
 * attempt) never reaches `fetch` or the workspace write.
 * @param slugs - the model-supplied slug list.
 * @throws when the count is outside 1..{@link MAX_SLUGS}, or any slug fails {@link SLUG_PATTERN}.
 */
export function assertValidSlugs(slugs: readonly string[]): void {
  if (slugs.length === 0 || slugs.length > MAX_SLUGS) {
    throw new Error(`design_study_references: slugs must include 1 to ${MAX_SLUGS} entries, got ${slugs.length}`)
  }
  for (const slug of slugs) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(
        `design_study_references: "${slug}" is not a valid design-library slug (lowercase letters, digits, internal hyphens only)`,
      )
    }
  }
}

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it — the
 * `tool-describe-image`/`tool-media` convention, copied rather than imported (design-brain has no
 * dependency on either sibling package).
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > cap) throw new Error(`design_study_references: response exceeds the ${cap}-byte bound`)
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/** One reference thumbnail successfully fetched, sniffed, and bounded. */
export interface FetchedThumbnail {
  kind: 'fetched'
  slug: string
  bytes: Buffer
  mediaType: ThumbnailMediaType
}

/** One reference this call could not show the model — never thrown for a single miss. */
export interface MissedThumbnail {
  kind: 'missed'
  slug: string
  reason: string
}

/**
 * Fetch one slug's thumbnail over a redirect-refusing HTTPS client. A 404 or any other non-2xx
 * status, and an unrecognized body, all resolve as a {@link MissedThumbnail} — never a throw. A
 * redirect (the underlying `fetch` rejects outright under `redirect: 'error'`) or an
 * over-the-cap response (declared `content-length`, or the streamed byte count) throws instead:
 * both are refusals of the whole call, not a per-slug miss.
 * @param baseUrl - the thumbnail host base, trailing slash included.
 * @param slug - one already-validated slug.
 * @param signal - caller cancellation.
 * @returns the fetched bytes, or a miss with a human-readable reason.
 */
export async function fetchOneThumbnail(baseUrl: string, slug: string, signal: AbortSignal): Promise<FetchedThumbnail | MissedThumbnail> {
  const url = `${baseUrl}${slug}.jpg`
  const response = await fetch(url, { redirect: 'error', signal })
  if (response.status === 404) return { kind: 'missed', slug, reason: `HTTP 404: no thumbnail published for "${slug}"` }
  if (!response.ok) return { kind: 'missed', slug, reason: `HTTP ${response.status}` }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declared) && declared > MAX_THUMBNAIL_BYTES) {
    throw new Error(`design_study_references: thumbnail for "${slug}" is ${declared} bytes, above the ${MAX_THUMBNAIL_BYTES}-byte bound`)
  }
  const bytes = await readBoundedBody(response, MAX_THUMBNAIL_BYTES)
  const mediaType = sniffThumbnailMediaType(bytes)
  if (mediaType === undefined) return { kind: 'missed', slug, reason: 'response body is not a recognized JPEG/PNG/WebP image' }
  return { kind: 'fetched', slug, bytes, mediaType }
}

/** One durably saved reference: the workspace copy plus the durable attachment reference. */
interface SavedReference {
  slug: string
  path: string
  mediaType: ThumbnailMediaType
  bytes: number
  width: number
  height: number
  attachmentId: string
}

/**
 * Minimal shape this module calls on the optional `ctx.attachments` service — kept local so
 * design-brain never imports `@deepseek-ai/dsh-attachment` directly (it is not a resolvable
 * dependency of this thin-wrapper package; see the module doc).
 */
interface AttachmentSaver {
  saveImage(input: { data: Uint8Array; mediaType: ThumbnailMediaType; name?: string }): Promise<{
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
  }>
}

/**
 * Write one fetched thumbnail under `<workspace>/.saturn/refs/<slug>.jpg` and durably commit it
 * through the attachment store, so it can ride the next model turn as a real image block.
 * @param workspace - absolute workspace root (the calling agent's session cwd, or `process.cwd()`).
 * @param attachments - the mounted attachment store.
 * @param thumbnail - one fetched thumbnail.
 * @returns the workspace path and the durable attachment facts.
 */
async function saveReference(workspace: string, attachments: AttachmentSaver, thumbnail: FetchedThumbnail): Promise<SavedReference> {
  const dir = join(workspace, '.saturn', 'refs')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${thumbnail.slug}.jpg`)
  await writeFile(path, thumbnail.bytes)
  const ref = await attachments.saveImage({ data: thumbnail.bytes, mediaType: thumbnail.mediaType, name: `${thumbnail.slug}.jpg` })
  return {
    slug: thumbnail.slug, path, mediaType: thumbnail.mediaType,
    bytes: ref.bytes, width: ref.width, height: ref.height, attachmentId: ref.attachmentId,
  }
}

/** The `design_study_references` call's validated arguments. */
export interface StudyReferencesArgs {
  slugs: string[]
  prompt?: string
}

/** The tool's canonical, JSON-schema-validated outcome. */
export interface StudyReferencesValue {
  fetched: SavedReference[]
  missed: { slug: string; reason: string }[]
  prompt?: string
}

const STUDY_REFERENCES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fetched: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
          path: { type: 'string', required: true },
          mediaType: { type: 'string', required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          attachmentId: { type: 'string', required: true },
        },
      },
    },
    missed: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
    },
    prompt: { type: 'string' },
  },
} as const

/** Build the model-facing summary line for one call, naming every fetched and missed slug. */
export function studyReferencesSummary(value: StudyReferencesValue): string {
  const lines = [
    value.prompt !== undefined && value.prompt.length > 0
      ? `Studied ${value.fetched.length + value.missed.length} SaturnAI design reference(s) with eyes — focus: ${value.prompt}`
      : `Studied ${value.fetched.length + value.missed.length} SaturnAI design reference(s) with eyes.`,
  ]
  for (const item of value.fetched) {
    lines.push(`- fetched ${item.slug}: ${item.mediaType}, ${item.width}x${item.height}px, ${item.bytes} bytes -> ${item.path}`)
  }
  for (const item of value.missed) {
    lines.push(`- missed ${item.slug}: ${item.reason}`)
  }
  lines.push(
    'Extract named structural moves per reference — exact layout mechanics, spacing rhythm, a specific interaction — '
    + 'never a mood adjective. Save the notes to .saturn/reference-study.md before implementation begins.',
  )
  return lines.join('\n')
}

/** Project the canonical outcome into the model-facing summary text plus one image block per fetched reference. */
function studyReferencesContent(value: StudyReferencesValue): ContentBlock[] {
  return [
    { type: 'text', text: studyReferencesSummary(value) },
    ...value.fetched.map((item): ContentBlock => ({
      type: 'image',
      attachment: {
        attachmentId: item.attachmentId,
        mediaType: item.mediaType,
        bytes: item.bytes,
        width: item.width,
        height: item.height,
        name: `${item.slug}.jpg`,
      } as unknown as ImageAttachment,
    })),
  ]
}

function studyReferencesCallView(args: StudyReferencesArgs): GenericCallView {
  return {
    card: 'generic',
    title: `Study ${args.slugs.length} reference${args.slugs.length === 1 ? '' : 's'} with eyes`,
    kind: 'read',
    rawInput: args,
  }
}

const DESCRIPTION =
  'Fetch up to 6 SaturnAI design-library reference thumbnails as real images and study them with eyes, not vibes. '
  + 'Pass the exact slugs a prior compose/search/pick call returned — never invent one. Each image rides this '
  + 'result as a real image content block (not just a filename), is saved under the workspace at '
  + '.saturn/refs/<slug>.jpg, and the summary names every slug that had no published thumbnail as a miss — a '
  + 'missing thumbnail never fails the whole call. After this call returns, look at the images and record named '
  + 'structural moves per reference (exact layout mechanics, spacing rhythm, a specific interaction — never a mood '
  + 'adjective) to .saturn/reference-study.md before implementation begins.'

/**
 * Register `design_study_references` on `ctx.tools`. Independent of the `mcp__saturnai__*`
 * connection lifecycle in `./index.ts` in the sense that it talks straight to the public
 * thumbnail host rather than through the MCP transport — but its *registration* is gated by
 * `./index.ts`'s opt-in state (`DesignBrainService.syncStudyTool`), so a disabled design brain
 * does not pay the tool-schema token cost for a tool with no sanctioned slug source.
 * @param ctx - registrant context; `tools` must already be injected (design-brain declares it).
 * @param options - the deployment's thumbnail host base URL (tests point this at a local fixture).
 * @returns a disposer that unregisters the tool; the caller owns the tool's lifetime.
 */
export function registerStudyReferencesTool(ctx: Context, options: { thumbnailBaseUrl: string }): () => void {
  const baseUrl = options.thumbnailBaseUrl
  return ctx.tools.register(defineTool({
    name: 'design_study_references',
    description: DESCRIPTION,
    parameters: {
      slugs: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `Design-library slugs to study (1-${MAX_SLUGS}), exactly as returned by compose/search/pick.`,
      },
      prompt: {
        type: 'string',
        description: 'Optional focus for what to look for across these references, e.g. "how the nav collapses on scroll".',
      },
    },
    output: {
      schema: STUDY_REFERENCES_OUTPUT_SCHEMA,
      render: (_args, value) => studyReferencesContent(value),
    },
    async execute(args, exec): Promise<StudyReferencesValue> {
      assertValidSlugs(args.slugs)
      const attachments = ctx.get('attachments') as AttachmentSaver | undefined
      if (attachments === undefined) {
        throw new Error('design_study_references: no attachment store is mounted; images cannot be shown to the model')
      }
      const workspace = exec.agent?.session.header.cwd ?? process.cwd()
      const fetched: SavedReference[] = []
      const missed: { slug: string; reason: string }[] = []
      for (const slug of args.slugs) {
        const result = await fetchOneThumbnail(baseUrl, slug, exec.signal)
        if (result.kind === 'missed') {
          missed.push({ slug: result.slug, reason: result.reason })
          continue
        }
        fetched.push(await saveReference(workspace, attachments, result))
      }
      return { fetched, missed, ...args.prompt !== undefined ? { prompt: args.prompt } : {} }
    },
    presentCall: studyReferencesCallView,
  }))
}
