/**
 * OpenAI provider (optional per SPEC §3 C7): image generation over
 * `POST {baseURL}/images/generations`. The endpoint path, current model ids
 * (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`,
 * `gpt-image-1`), and the `Image` response schema (`b64_json` /
 * `revised_prompt` / `url`) were confirmed live against
 * `developers.openai.com/api/reference/resources/images` on 2026-09-15. No
 * independently verified $/image figure was captured this session — see
 * `../pricing.ts` (`OPENAI_PRICES` is deliberately empty) and the package
 * README's Known Limitations. Because of that gap this provider REFUSES to
 * run a paid call without an explicit `params.pricePerImageUsd` override, so
 * the spend Gate never shows a guessed number.
 * @module @saturnai/dsh-tool-media/providers/openai
 */

import { fetchNoRedirect, httpFailure, readBoundedBody } from '../http.ts'
import type { MediaCost } from '../types.ts'
import type { DecodedMedia } from './gemini.ts'

/** Deployment configuration for the OpenAI provider. */
export interface OpenAiConfig {
  /** REST origin for `POST {baseURL}/images/generations`; defaults to `DEFAULT_OPENAI_BASE_URL`. */
  readonly baseURL?: string
  /** Model id passed to the images-generations endpoint; defaults to `DEFAULT_OPENAI_IMAGE_MODEL`. */
  readonly imageModel?: string
  /** HTTP timeout for the single generation request; defaults to `DEFAULT_OPENAI_TIMEOUT_MS`. */
  readonly timeoutMs?: number
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare'
export const DEFAULT_OPENAI_TIMEOUT_MS = 120_000

/** One validated, defaulted OpenAI configuration snapshot. */
export interface ResolvedOpenAiConfig {
  readonly baseURL: string
  readonly imageModel: string
  readonly timeoutMs: number
}

/**
 * Resolve raw config into validated connection facts.
 * @param config - raw plugin config.
 */
export function resolveOpenAiConfig(config: OpenAiConfig): ResolvedOpenAiConfig {
  const baseURL = (config.baseURL ?? DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseURL)) throw new Error('openai: baseURL must be an absolute http(s) URL')
  const timeoutMs = config.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('openai: timeoutMs must be a positive safe integer')
  return { baseURL, imageModel: config.imageModel?.trim() || DEFAULT_OPENAI_IMAGE_MODEL, timeoutMs }
}

/**
 * Resolve the cost of one OpenAI image call. Unlike Gemini and Higgsfield, this provider has no
 * verified price table entry, so it demands an explicit override rather than guessing.
 * @param model - the resolved model id.
 * @param pricePerImageUsd - required caller-supplied per-image price (`params.pricePerImageUsd`).
 * @throws when `pricePerImageUsd` is missing, non-finite, or not positive.
 */
export function openAiImageCost(model: string, pricePerImageUsd: unknown): MediaCost {
  if (typeof pricePerImageUsd !== 'number' || !Number.isFinite(pricePerImageUsd) || pricePerImageUsd <= 0) {
    throw new Error(
      'openai: no verified per-image price is on file for this provider (see the README Known Limitations); '
      + 'pass params.pricePerImageUsd (a positive number) to state the cost the spend Gate should show',
    )
  }
  return { estimatedUsd: Math.round(pricePerImageUsd * 100) / 100, provider: 'openai', model }
}

/** Optional OpenAI image request parameters a caller may pass through `params`. */
export interface OpenAiImageParams {
  readonly size?: '1024x1024' | '1536x1024' | '1024x1536'
  readonly quality?: 'low' | 'medium' | 'high'
  readonly outputFormat?: 'png' | 'jpeg' | 'webp'
}

/**
 * Generate one image over `POST {baseURL}/images/generations`
 * (verified 2026-09-15: `developers.openai.com/api/reference/resources/images`).
 * @param spec - resolved configuration.
 * @param apiKey - the caller's OpenAI API key (sent as a bearer token).
 * @param prompt - the model-facing generation prompt.
 * @param params - optional size/quality/format overrides.
 * @param signal - caller cancellation.
 */
export async function generateOpenAiImage(
  spec: ResolvedOpenAiConfig,
  apiKey: string,
  prompt: string,
  params: OpenAiImageParams | undefined,
  signal: AbortSignal,
): Promise<DecodedMedia> {
  const body = JSON.stringify({
    model: spec.imageModel,
    prompt,
    n: 1,
    ...params?.size !== undefined ? { size: params.size } : {},
    ...params?.quality !== undefined ? { quality: params.quality } : {},
    ...params?.outputFormat !== undefined ? { output_format: params.outputFormat } : {},
  })
  const response = await fetchNoRedirect(
    `${spec.baseURL}/images/generations`,
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body },
    AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  )
  if (!response.ok) throw await httpFailure('openai: image generation', response)
  const payloadBytes = await readBoundedBody(response, 32 * 1024 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new Error('openai: images/generations returned invalid JSON')
  }
  const root = payload as { data?: unknown } | null
  const first = Array.isArray(root?.data) ? (root.data as unknown[])[0] : undefined
  const record = first as { b64_json?: unknown; url?: unknown } | undefined
  const b64 = record?.b64_json
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('openai: images/generations returned no inline b64_json image (only a hosted url, which this provider does not follow)')
  }
  const format = params?.outputFormat ?? 'png'
  return { data: Buffer.from(b64, 'base64'), mimeType: `image/${format === 'jpeg' ? 'jpeg' : format}` }
}
