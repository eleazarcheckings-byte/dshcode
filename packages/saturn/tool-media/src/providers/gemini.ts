/**
 * Gemini provider: image generation over the `interactions` REST endpoint and
 * video generation over Veo's `predictLongRunning` long-running-operation
 * contract. Both endpoints, their current model ids, and the accepted
 * parameters were fetched live with `curl` against `ai.google.dev` on
 * 2026-09-15 — the exact pages are cited on every {@link PriceEntry} in
 * `../pricing.ts` and in this package's README Model Experience section.
 *
 * The `interactions` endpoint's raw JSON response envelope was not shown
 * verbatim in the fetched docs (only via SDK convenience accessors such as
 * `interaction.output_image.data`); {@link parseOutputImage} therefore accepts
 * both the snake_case spelling the request body itself uses (`mime_type`) and
 * a camelCase fallback, and fails loud naming the keys it actually saw rather
 * than guess silently.
 * @module @saturnai/dsh-tool-media/providers/gemini
 */

import { setTimeout as delay } from 'node:timers/promises'
import { fetchAllowingRedirectTo, fetchNoRedirect, httpFailure, readBoundedBody } from '../http.ts'
import { DEFAULT_GEMINI_IMAGE_USD, DEFAULT_GEMINI_VIDEO_USD_PER_SECOND, GEMINI_PRICES, findPrice } from '../pricing.ts'
import type { MediaCost } from '../types.ts'

/** Deployment configuration for the Gemini provider. */
export interface GeminiConfig {
  readonly baseURL?: string
  readonly imageModel?: string
  readonly videoModel?: string
  /** Per-HTTP-call timeout (submission and each poll), not the whole video job. */
  readonly timeoutMs?: number
  readonly pollIntervalMs?: number
  /** Total wall-clock budget for polling a video job before giving up. */
  readonly pollTimeoutMs?: number
}

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_GEMINI_VIDEO_MODEL = 'veo-3.1-generate-preview'
export const DEFAULT_GEMINI_TIMEOUT_MS = 120_000
export const DEFAULT_GEMINI_POLL_INTERVAL_MS = 10_000
export const DEFAULT_GEMINI_POLL_TIMEOUT_MS = 10 * 60_000
/** Veo 3.1's own documented default clip length, used only when a call omits `durationSeconds`. */
export const DEFAULT_VEO_DURATION_SECONDS = 8

/** One validated, defaulted Gemini configuration snapshot. */
export interface ResolvedGeminiConfig {
  readonly baseURL: string
  readonly imageModel: string
  readonly videoModel: string
  readonly timeoutMs: number
  readonly pollIntervalMs: number
  readonly pollTimeoutMs: number
}

/**
 * Resolve raw config into validated connection facts, re-checked at every call site
 * (a settings-panel edit must not require a process restart to take effect).
 * @param config - raw plugin config.
 */
export function resolveGeminiConfig(config: GeminiConfig): ResolvedGeminiConfig {
  const baseURL = (config.baseURL ?? DEFAULT_GEMINI_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseURL)) throw new Error('gemini: baseURL must be an absolute http(s) URL')
  const timeoutMs = config.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_GEMINI_POLL_INTERVAL_MS
  const pollTimeoutMs = config.pollTimeoutMs ?? DEFAULT_GEMINI_POLL_TIMEOUT_MS
  for (const [field, value] of [['timeoutMs', timeoutMs], ['pollIntervalMs', pollIntervalMs], ['pollTimeoutMs', pollTimeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`gemini: ${field} must be a positive safe integer`)
  }
  return {
    baseURL,
    imageModel: config.imageModel?.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
    videoModel: config.videoModel?.trim() || DEFAULT_GEMINI_VIDEO_MODEL,
    timeoutMs,
    pollIntervalMs,
    pollTimeoutMs,
  }
}

/** The verified (or, for an overridden model, best-effort default) per-image cost. */
export function geminiImageCost(model: string): MediaCost {
  const entry = findPrice(GEMINI_PRICES, model)
  return { estimatedUsd: round2(entry?.usd ?? DEFAULT_GEMINI_IMAGE_USD), provider: 'gemini', model }
}

/** The verified (or, for an overridden model, best-effort default) cost for a video of the given length. */
export function geminiVideoCost(model: string, durationSeconds: number): MediaCost {
  const entry = findPrice(GEMINI_PRICES, model)
  const perSecond = entry?.usd ?? DEFAULT_GEMINI_VIDEO_USD_PER_SECOND
  return { estimatedUsd: round2(perSecond * durationSeconds), provider: 'gemini', model }
}

/**
 * Round to 4 decimal places — enough headroom for the verified table's 3-decimal per-image prices
 * (e.g. `0.067`) while still collapsing floating-point multiplication noise from `perSecond * durationSeconds`.
 */
function round2(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  const bytes = await readBoundedBody(response, 8 * 1024 * 1024)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label}: returned invalid JSON`)
  }
}

/** One decoded media payload a provider call resolved to, before it is written to the workspace. */
export interface DecodedMedia {
  readonly data: Buffer
  readonly mimeType: string
}

/**
 * Extract `output_image` from an `interactions` response, tolerating both the
 * snake_case the endpoint's own request body uses and a camelCase fallback
 * (see the module doc for why both are accepted).
 */
export function parseOutputImage(payload: unknown): DecodedMedia {
  const root = payload as { output_image?: unknown; outputImage?: unknown } | null
  if (typeof root !== 'object' || root === null) {
    throw new Error('gemini: interactions endpoint returned a non-object response')
  }
  const block = (root.output_image ?? root.outputImage) as Record<string, unknown> | undefined
  if (typeof block !== 'object' || block === null) {
    throw new Error(`gemini: interactions response carried no output_image (keys seen: ${Object.keys(root).join(', ') || 'none'})`)
  }
  const data = block.data ?? block.imageBytes
  const mimeType = block.mime_type ?? block.mimeType
  if (typeof data !== 'string' || data.length === 0) throw new Error('gemini: output_image carried no base64 data')
  if (typeof mimeType !== 'string' || mimeType.length === 0) throw new Error('gemini: output_image carried no mime_type')
  return { data: Buffer.from(data, 'base64'), mimeType }
}

/**
 * Generate one image over `POST {baseURL}/interactions`
 * (verified 2026-09-15: `https://ai.google.dev/gemini-api/docs/image-generation`).
 * @param spec - resolved configuration.
 * @param apiKey - the caller's Gemini API key (sent as `x-goog-api-key`, never a URL param).
 * @param prompt - the model-facing generation prompt.
 * @param signal - caller cancellation.
 */
export async function generateGeminiImage(
  spec: ResolvedGeminiConfig,
  apiKey: string,
  prompt: string,
  signal: AbortSignal,
): Promise<DecodedMedia> {
  const body = JSON.stringify({ model: spec.imageModel, input: [{ type: 'text', text: prompt }] })
  const response = await fetchNoRedirect(
    `${spec.baseURL}/interactions`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body },
    AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  )
  if (!response.ok) throw await httpFailure('gemini: image generation', response)
  return parseOutputImage(await parseJson(response, 'gemini: image generation'))
}

/** Optional Veo request parameters a caller may pass through `params`. */
export interface VeoParams {
  readonly aspectRatio?: '16:9' | '9:16'
  readonly durationSeconds?: '4' | '6' | '8'
  readonly resolution?: '720p' | '1080p' | '4k'
  readonly personGeneration?: string
  /** Base64-encoded first-frame image for image-to-video, with its mime type. */
  readonly image?: { readonly data: string; readonly mimeType: string }
}

interface VeoOperationStatus {
  done?: boolean
  error?: { message?: string }
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } }
}

/**
 * Generate one video: submit to `POST {baseURL}/models/{videoModel}:predictLongRunning`, poll
 * `GET {baseURL}/{operationName}` until `done`, then download the signed `video.uri` — the exact
 * three-step flow `ai.google.dev/gemini-api/docs/veo` demonstrates with `curl` (verified 2026-09-15).
 * The download step is the package's one documented redirect exception: Google's own quickstart
 * follows a redirect on this URL while forwarding the API key header, so
 * {@link fetchAllowingRedirectTo} allows exactly one hop and only back onto the configured host.
 * @param spec - resolved configuration.
 * @param apiKey - the caller's Gemini API key.
 * @param prompt - the model-facing generation prompt.
 * @param params - optional Veo parameters (aspect ratio, duration, resolution, first-frame image).
 * @param signal - caller cancellation, honored both mid-request and between polls.
 */
export async function generateGeminiVideo(
  spec: ResolvedGeminiConfig,
  apiKey: string,
  prompt: string,
  params: VeoParams | undefined,
  signal: AbortSignal,
): Promise<DecodedMedia> {
  const parameters: Record<string, string> = {}
  if (params?.aspectRatio !== undefined) parameters.aspectRatio = params.aspectRatio
  if (params?.durationSeconds !== undefined) parameters.durationSeconds = params.durationSeconds
  if (params?.resolution !== undefined) parameters.resolution = params.resolution
  if (params?.personGeneration !== undefined) parameters.personGeneration = params.personGeneration
  const instance: Record<string, unknown> = { prompt }
  if (params?.image !== undefined) {
    instance.image = { inlineData: { mimeType: params.image.mimeType, data: params.image.data } }
  }
  const body = JSON.stringify({
    instances: [instance],
    ...Object.keys(parameters).length > 0 ? { parameters } : {},
  })
  const submitResponse = await fetchNoRedirect(
    `${spec.baseURL}/models/${spec.videoModel}:predictLongRunning`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body },
    AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  )
  if (!submitResponse.ok) throw await httpFailure('gemini: video submission', submitResponse)
  const submitPayload = await parseJson(submitResponse, 'gemini: video submission') as { name?: unknown }
  const operationName = submitPayload.name
  if (typeof operationName !== 'string' || operationName.length === 0) {
    throw new Error('gemini: video submission returned no operation name')
  }

  const deadline = Date.now() + spec.pollTimeoutMs
  for (;;) {
    signal.throwIfAborted()
    const statusResponse = await fetchNoRedirect(
      `${spec.baseURL}/${operationName}`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
      AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
    )
    if (!statusResponse.ok) throw await httpFailure('gemini: video status', statusResponse)
    const status = await parseJson(statusResponse, 'gemini: video status') as VeoOperationStatus
    if (status.done === true) {
      if (status.error !== undefined) {
        throw new Error(`gemini: video generation failed: ${status.error.message ?? 'unknown error'}`)
      }
      const uri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      if (typeof uri !== 'string' || uri.length === 0) throw new Error('gemini: completed operation carried no video uri')
      const videoResponse = await fetchAllowingRedirectTo(
        uri,
        { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]) },
        [new URL(spec.baseURL).host],
      )
      if (!videoResponse.ok) throw await httpFailure('gemini: video download', videoResponse)
      const data = await readBoundedBody(videoResponse, 200 * 1024 * 1024)
      const mimeType = videoResponse.headers.get('content-type') ?? 'video/mp4'
      return { data, mimeType }
    }
    if (Date.now() > deadline) throw new Error(`gemini: video generation did not complete within ${spec.pollTimeoutMs}ms`)
    await delay(spec.pollIntervalMs, undefined, { signal })
  }
}
