/**
 * Higgsfield provider: the async job API documented at `docs.higgsfield.ai`
 * (fetched live — quickstart, authentication, requests/lifecycle, polling,
 * errors, billing-and-retention, and the published `openapi.json` — on
 * 2026-09-15). One authenticated submission creates a `request_id`; the
 * result is retrieved by polling `status_url` (webhooks are documented but out
 * of scope here — this package has no inbound HTTP surface to receive one).
 *
 * Credential shape: Higgsfield's own `Authorization` header takes a COMBINED
 * `Key {id}:{secret}` value, not a single bearer token. SPEC §3 C7 names one
 * credential (`HIGGSFIELD_API_KEY`) for this provider, so that single
 * credential-ref is defined to hold the already-combined `"{id}:{secret}"`
 * string — resolved once and prefixed with `Key ` to form the header, with no
 * separate id/secret config fields to keep straight.
 *
 * Genjutsu (motion-transfer / object-swap) gap: the published `openapi.json`
 * this session (50 paths) names no motion-transfer, object-swap, or genjutsu
 * endpoint — only the aggregator's OWN Higgsfield MCP (a separate, already-
 * connected integration surface, not this package) exposes `hf_mult_motion_control`
 * / `hf_mult_replace_object` as internal model ids. Rather than guess an
 * unverified REST path, `media_motion_transfer` REQUIRES the caller to name
 * the exact model path via `params.modelPath`; omitting it is a configuration
 * error, not a silent fallback. See the README's Known Limitations.
 * @module @saturnai/dsh-tool-media/providers/higgsfield
 */

import { setTimeout as delay } from 'node:timers/promises'
import { httpFailure, readBoundedBody } from '../http.ts'
import type { MediaCost, MediaJobStatus } from '../types.ts'

/** Deployment configuration for the Higgsfield provider. */
export interface HiggsfieldConfig {
  readonly baseURL?: string
  /** Model path for `media_generate_image` when the call omits `params.modelPath`. */
  readonly imageModelPath?: string
  readonly timeoutMs?: number
  readonly pollIntervalMs?: number
  readonly pollTimeoutMs?: number
}

export const DEFAULT_HIGGSFIELD_BASE_URL = 'https://api.higgsfield.ai'
/** Verified live in `openapi.json` (2026-09-15): `POST /higgsfield-ai/soul/standard`. */
export const DEFAULT_HIGGSFIELD_IMAGE_MODEL_PATH = 'higgsfield-ai/soul/standard'
export const DEFAULT_HIGGSFIELD_TIMEOUT_MS = 30_000
/** Docs' own recommended starting interval (`concepts/polling.md`). */
export const DEFAULT_HIGGSFIELD_POLL_INTERVAL_MS = 2_000
/** Docs' own recommended interval ceiling. */
export const MAX_HIGGSFIELD_POLL_INTERVAL_MS = 10_000
export const DEFAULT_HIGGSFIELD_POLL_TIMEOUT_MS = 10 * 60_000

/** One validated, defaulted Higgsfield configuration snapshot. */
export interface ResolvedHiggsfieldConfig {
  readonly baseURL: string
  readonly imageModelPath: string
  readonly timeoutMs: number
  readonly pollIntervalMs: number
  readonly pollTimeoutMs: number
}

/**
 * Resolve raw config into validated connection facts.
 * @param config - raw plugin config.
 */
export function resolveHiggsfieldConfig(config: HiggsfieldConfig): ResolvedHiggsfieldConfig {
  const baseURL = (config.baseURL ?? DEFAULT_HIGGSFIELD_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseURL)) throw new Error('higgsfield: baseURL must be an absolute http(s) URL')
  const imageModelPath = (config.imageModelPath ?? DEFAULT_HIGGSFIELD_IMAGE_MODEL_PATH).trim().replace(/^\/+/, '')
  if (imageModelPath.length === 0) throw new Error('higgsfield: imageModelPath must be a non-empty model path')
  const timeoutMs = config.timeoutMs ?? DEFAULT_HIGGSFIELD_TIMEOUT_MS
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_HIGGSFIELD_POLL_INTERVAL_MS
  const pollTimeoutMs = config.pollTimeoutMs ?? DEFAULT_HIGGSFIELD_POLL_TIMEOUT_MS
  for (const [field, value] of [['timeoutMs', timeoutMs], ['pollIntervalMs', pollIntervalMs], ['pollTimeoutMs', pollTimeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`higgsfield: ${field} must be a positive safe integer`)
  }
  return { baseURL, imageModelPath, timeoutMs, pollIntervalMs, pollTimeoutMs }
}

/** One `{id}:{secret}` Higgsfield credential, parsed from the single `HIGGSFIELD_API_KEY` value. */
export interface HiggsfieldCredential {
  readonly keyId: string
  readonly keySecret: string
}

/**
 * Split the single resolved `HIGGSFIELD_API_KEY` credential value into the id/secret pair the
 * `Authorization: Key {id}:{secret}` header needs (verified 2026-09-15: `docs.higgsfield.ai/docs/authentication`).
 * @param raw - the resolved credential value; must contain exactly one `:` separating a non-empty id and secret.
 */
export function parseHiggsfieldCredential(raw: string): HiggsfieldCredential {
  const sep = raw.indexOf(':')
  if (sep <= 0 || sep === raw.length - 1) {
    throw new Error('higgsfield: HIGGSFIELD_API_KEY must be "{key_id}:{key_secret}" (the id and secret joined by one colon)')
  }
  return { keyId: raw.slice(0, sep), keySecret: raw.slice(sep + 1) }
}

function authHeader(credential: HiggsfieldCredential): string {
  return `Key ${credential.keyId}:${credential.keySecret}`
}

/** The initial (and every subsequent, non-terminal) submission response. */
export interface HiggsfieldRequestAccepted {
  readonly status: string
  readonly request_id: string
  readonly status_url: string
  readonly cancel_url: string
}

/** A media output slot as the status/webhook envelope reports it. */
export interface HiggsfieldMediaOutput {
  readonly url: string
  readonly content_type?: string
}

/** The full request-status response shape (verified 2026-09-15 against the published `openapi.json`). */
export interface HiggsfieldRequestStatus {
  readonly status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'
  readonly request_id: string
  readonly error?: string | null
  readonly images?: readonly HiggsfieldMediaOutput[]
  readonly video?: HiggsfieldMediaOutput
  readonly audio?: HiggsfieldMediaOutput
  readonly audios?: readonly HiggsfieldMediaOutput[]
}

const TERMINAL_STATUSES: ReadonlySet<HiggsfieldRequestStatus['status']> = new Set(['completed', 'failed', 'nsfw', 'canceled'])

/** Map one Higgsfield terminal/non-terminal status onto this package's normalized {@link MediaJobStatus}. */
export function normalizeHiggsfieldStatus(status: HiggsfieldRequestStatus['status']): MediaJobStatus {
  switch (status) {
    case 'queued': return 'queued'
    case 'in_progress': return 'running'
    case 'completed': return 'done'
    case 'failed': case 'nsfw': case 'canceled': return 'failed'
    default: return 'failed'
  }
}

async function parseJsonOrThrow(response: Response, label: string): Promise<unknown> {
  const bytes = await readBoundedBody(response, 4 * 1024 * 1024)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label}: returned invalid JSON`)
  }
}

/**
 * Submit one generation request to `POST {baseURL}/{modelPath}`
 * (verified 2026-09-15: `docs.higgsfield.ai/docs/quickstart`).
 * @param spec - resolved configuration.
 * @param credential - the id/secret pair.
 * @param modelPath - the model path, e.g. `higgsfield-ai/soul/standard` (no leading slash).
 * @param body - the model-specific JSON body (validated by Higgsfield, not this package).
 * @param signal - caller cancellation.
 */
export async function submitHiggsfieldRequest(
  spec: ResolvedHiggsfieldConfig,
  credential: HiggsfieldCredential,
  modelPath: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<HiggsfieldRequestAccepted> {
  const response = await fetch(`${spec.baseURL}/${modelPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authHeader(credential) },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (!response.ok) throw await httpFailure(`higgsfield: submit ${modelPath}`, response)
  return await parseJsonOrThrow(response, `higgsfield: submit ${modelPath}`) as HiggsfieldRequestAccepted
}

/**
 * Retrieve current status via `GET {baseURL}/requests/{requestId}/status`.
 * @param spec - resolved configuration.
 * @param credential - the id/secret pair.
 * @param requestId - the request id returned by {@link submitHiggsfieldRequest}.
 * @param signal - caller cancellation.
 */
export async function getHiggsfieldStatus(
  spec: ResolvedHiggsfieldConfig,
  credential: HiggsfieldCredential,
  requestId: string,
  signal: AbortSignal,
): Promise<HiggsfieldRequestStatus> {
  const response = await fetch(`${spec.baseURL}/requests/${requestId}/status`, {
    method: 'GET',
    headers: { authorization: authHeader(credential) },
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (!response.ok) throw await httpFailure('higgsfield: request status', response)
  return await parseJsonOrThrow(response, 'higgsfield: request status') as HiggsfieldRequestStatus
}

/**
 * Cancel a queued (not-yet-started) request via `POST {baseURL}/requests/{requestId}/cancel`.
 * A `202` with no body is success; a `400` means processing already started (not thrown — the
 * caller decides whether that is an error).
 * @returns `true` when canceled, `false` when the request had already started.
 */
export async function cancelHiggsfieldRequest(
  spec: ResolvedHiggsfieldConfig,
  credential: HiggsfieldCredential,
  requestId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetch(`${spec.baseURL}/requests/${requestId}/cancel`, {
    method: 'POST',
    headers: { authorization: authHeader(credential) },
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (response.status === 202) return true
  if (response.status === 400) return false
  throw await httpFailure('higgsfield: cancel request', response)
}

/**
 * Get a LIVE cost quote via `POST {baseURL}/estimate/{modelPath}` — verified 2026-09-15:
 * `docs.higgsfield.ai/docs/concepts/billing-and-retention` (`{"credits": "1.500", "usd": "0.094"}`).
 * Preferred over a static table because Higgsfield's own per-model/per-parameter pricing is not
 * published anywhere else this session confirmed; a failed estimate call is NOT masked with a
 * guessed number — it throws, so the spend Gate never shows an invented figure.
 * @param spec - resolved configuration.
 * @param credential - the id/secret pair.
 * @param modelPath - the same model path {@link submitHiggsfieldRequest} will be called with.
 * @param body - the same request body {@link submitHiggsfieldRequest} will be called with.
 * @param signal - caller cancellation.
 */
export async function estimateHiggsfieldCost(
  spec: ResolvedHiggsfieldConfig,
  credential: HiggsfieldCredential,
  modelPath: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<MediaCost> {
  const response = await fetch(`${spec.baseURL}/estimate/${modelPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authHeader(credential) },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (!response.ok) throw await httpFailure(`higgsfield: estimate ${modelPath}`, response)
  const payload = await parseJsonOrThrow(response, `higgsfield: estimate ${modelPath}`) as { usd?: unknown }
  const usd = Number(payload.usd)
  if (!Number.isFinite(usd)) throw new Error(`higgsfield: estimate ${modelPath} returned a non-numeric usd value`)
  return { estimatedUsd: Math.round(usd * 1000) / 1000, provider: 'higgsfield', model: modelPath }
}

/**
 * Poll `status_url` (via {@link getHiggsfieldStatus}, following the docs' own recommendation to use
 * the returned URLs rather than construct them) with the docs' own recommended 2s→10s backoff until
 * a terminal status.
 * @param spec - resolved configuration.
 * @param credential - the id/secret pair.
 * @param requestId - the request id returned by {@link submitHiggsfieldRequest}.
 * @param signal - caller cancellation.
 */
export async function pollHiggsfieldUntilTerminal(
  spec: ResolvedHiggsfieldConfig,
  credential: HiggsfieldCredential,
  requestId: string,
  signal: AbortSignal,
): Promise<HiggsfieldRequestStatus> {
  const deadline = Date.now() + spec.pollTimeoutMs
  let interval = spec.pollIntervalMs
  for (;;) {
    signal.throwIfAborted()
    const status = await getHiggsfieldStatus(spec, credential, requestId, signal)
    if (TERMINAL_STATUSES.has(status.status)) return status
    if (Date.now() > deadline) {
      throw new Error(`higgsfield: request ${requestId} did not reach a terminal state within ${spec.pollTimeoutMs}ms`)
    }
    await delay(interval, undefined, { signal })
    interval = Math.min(Math.round(interval * 1.5), MAX_HIGGSFIELD_POLL_INTERVAL_MS)
  }
}

/**
 * Download one completed output URL. Higgsfield's own file-uploads guide is explicit that these
 * hosted URLs never carry (and must never be sent) Higgsfield API credentials, so this is a plain,
 * uncredentialed fetch — there is no bearer/API key here for a redirect to leak.
 */
export async function downloadHiggsfieldAsset(url: string, signal: AbortSignal, cap = 200 * 1024 * 1024): Promise<Buffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw await httpFailure('higgsfield: asset download', response)
  return readBoundedBody(response, cap)
}
