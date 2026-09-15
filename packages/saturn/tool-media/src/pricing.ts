/**
 * Verified per-provider price tables, each entry dated to the session that
 * confirmed it directly against the provider's own pricing page (never a
 * third-party aggregator or memory). {@link estimateCost} turns a table entry
 * plus a call's params into the {@link MediaCost} the spend Gate shows the user
 * before any network call fires.
 * @module @saturnai/dsh-tool-media/pricing
 */

import type { MediaProviderId } from './types.ts'

/** One verified price point for one model. */
export interface PriceEntry {
  readonly provider: MediaProviderId
  readonly model: string
  readonly unit: 'per-image' | 'per-second' | 'per-request'
  readonly usd: number
  /** ISO date this figure was read directly off the provider's own pricing page this session — not carried forward from memory. */
  readonly verified: string
  /** The exact page this figure came from. */
  readonly source: string
  readonly notes?: string
}

/**
 * Gemini image and video prices, confirmed against `https://ai.google.dev/gemini-api/docs/pricing`
 * on 2026-09-15 (fetched with `curl` this session; see `.agents/notes` for the raw capture).
 * Only the model ids this provider defaults to are tabulated; an explicit `model` override with
 * no table entry falls back to {@link DEFAULT_GEMINI_IMAGE_USD} / {@link DEFAULT_GEMINI_VIDEO_USD_PER_SECOND}
 * rather than silently reporting $0.
 */
export const GEMINI_PRICES: readonly PriceEntry[] = [
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-image',
    unit: 'per-image',
    usd: 0.067,
    verified: '2026-09-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Paid-tier standard, 1K output (1120 tokens @ $60/1M). 0.5K=$0.045, 2K=$0.101, 4K=$0.151.',
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite-image',
    unit: 'per-image',
    usd: 0.0336,
    verified: '2026-09-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Paid-tier standard, 1K output (1120 tokens @ $30/1M); only resolution this model supports.',
  },
  {
    provider: 'gemini',
    model: 'veo-3.1-generate-preview',
    unit: 'per-second',
    usd: 0.40,
    verified: '2026-09-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Standard, with audio, 720p/1080p (default). 4k=$0.60/s.',
  },
  {
    provider: 'gemini',
    model: 'veo-3.1-fast-generate-preview',
    unit: 'per-second',
    usd: 0.10,
    verified: '2026-09-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Fast, with audio, 720p (default). 1080p=$0.12/s, 4k=$0.30/s.',
  },
  {
    provider: 'gemini',
    model: 'veo-3.1-lite-generate-preview',
    unit: 'per-second',
    usd: 0.05,
    verified: '2026-09-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Lite, with audio, 720p (default). 1080p=$0.08/s. 4k output is not supported.',
  },
]

/**
 * OpenAI's `images/generations` endpoint and its current model ids were confirmed live against
 * `developers.openai.com/api/reference/resources/images` on 2026-09-15, but no independently
 * verified $/image figure was captured this session (the public pricing page redirected without
 * serving static content to this session's fetcher) — see the package README's Known Limitations.
 * Deliberately empty: {@link resolveGeminiOrOpenAiPrice} refuses to guess an OpenAI price, and the
 * provider requires an explicit `params.pricePerImageUsd` override before it will run a paid call.
 */
export const OPENAI_PRICES: readonly PriceEntry[] = []

/** Default per-image Gemini price used only when a caller-overridden `model` has no table entry. */
export const DEFAULT_GEMINI_IMAGE_USD = 0.067
/** Default per-second Gemini Veo price used only when a caller-overridden `model` has no table entry. */
export const DEFAULT_GEMINI_VIDEO_USD_PER_SECOND = 0.40

/**
 * Look up one model's verified price entry.
 * @param table - the provider's price table.
 * @param model - the exact model id/path to look up.
 * @returns the entry, or `undefined` when the model was never independently verified.
 */
export function findPrice(table: readonly PriceEntry[], model: string): PriceEntry | undefined {
  return table.find(entry => entry.model === model)
}
