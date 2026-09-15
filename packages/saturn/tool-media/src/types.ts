/**
 * Dependency-light shapes shared across the media generation seam: the request the
 * `ctx.media` service accepts, the job it returns, and the provider vocabulary the
 * tools and the loader-config schema both validate against.
 * @module @saturnai/dsh-tool-media/types
 */

/** The backend a generation call resolves to. */
export type MediaProviderId = 'gemini' | 'openai' | 'higgsfield'

/** Every {@link MediaProviderId}, for option advertisement and runtime validation of a caller-supplied provider string. */
export const MEDIA_PROVIDER_IDS: readonly MediaProviderId[] = ['gemini', 'openai', 'higgsfield']

/** The media family a generation call produces. */
export type MediaKind = 'image' | 'video' | 'audio' | 'motion-transfer'

/** Every {@link MediaKind}. */
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'motion-transfer']

/** Closed lifecycle vocabulary for one generation job, normalized across every provider. */
export type MediaJobStatus = 'queued' | 'running' | 'done' | 'failed'

/**
 * One generated (or generating) file, addressed by its on-disk path under the calling workspace.
 * Deliberately mutable (not `readonly`): every field must structurally match the plain JSON value
 * `defineTool`'s inferred output schema produces, which `tsc --noEmit` enforces under this repo's
 * `exactOptionalPropertyTypes`/strict settings — a `readonly` array here is not assignable to that
 * inferred mutable array type. Callers still receive a freshly constructed value per call.
 */
export interface MediaAsset {
  /** Absolute path under `<workspace>/.saturn/media/` where the asset was written. */
  path: string
  /** The asset's media type, e.g. `image/png`, `video/mp4`. */
  mimeType: string
  /** The provider's own hosted URL for the asset, when it issued one (kept for audit; the durable reference is `path`). */
  url?: string
}

/** The resolved (or estimated) monetary cost of one generation call. See {@link MediaAsset} for why this is mutable. */
export interface MediaCost {
  /** Best-effort USD estimate — a live provider quote when available, else a verified per-unit price entry. */
  estimatedUsd: number
  provider: MediaProviderId
  model: string
}

/** One generation job as `ctx.media` reports it, whether freshly submitted or polled. See {@link MediaAsset} for why this is mutable. */
export interface MediaJob {
  /** Stable id: the provider's own request/operation id when it issues one, else a locally minted id for a synchronous call. */
  id: string
  status: MediaJobStatus
  assets: MediaAsset[]
  cost: MediaCost
  /** Present only when `status` is `'failed'`. */
  error?: string
}

/** One call to `ctx.media.generate` — the interface contract SPEC §4 pins between this package (C7) and its consumers (C8a). */
export interface MediaGenerateRequest {
  readonly kind: MediaKind
  readonly prompt: string
  /** Explicit backend selection; omitted lets the service apply its configured default per kind. */
  readonly provider?: MediaProviderId
  /** Explicit model id/path override for the resolved provider. */
  readonly model?: string
  /** Provider-specific extras: aspect ratio, duration, resolution, reference media, the higgsfield model path, etc. — see the README. */
  readonly params?: Readonly<Record<string, unknown>>
  /** Absolute workspace root; assets land under `<workspace>/.saturn/media/`. */
  readonly workspace: string
}
