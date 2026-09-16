/**
 * Live model listings for declared routes that set `modelsEndpoint: true`.
 *
 * A static `models` list cannot keep up with a router such as Hugging Face's,
 * which serves hundreds of chat models whose provider availability changes by
 * the hour. A flagged route therefore asks `GET {baseURL}/models` (bearer auth)
 * and merges what is live with the route's own `models`, which stay as the
 * seed: they lead the list, and they are the whole list until a listing
 * succeeds — so the picker is never empty, and a failed refresh keeps the
 * last good list instead of withdrawing models mid-session.
 *
 * The listing shape is OpenAI's `data[]` with the Hugging Face router's
 * extension: each entry's `providers[]` carries `status`, `context_length`, and
 * `supports_tools`. An entry with a `providers` array is kept only when one of
 * them is `live`, and only live providers contribute capacity and tool facts.
 * An entry without the array (vLLM, TGI, LM Studio) is kept as listed. Image
 * input is claimed only when the entry's `architecture.input_modalities` says
 * so; nothing is guessed from a model name.
 *
 * The token lives in the Authorization header and nowhere else: never in the
 * URL, never in a failure message.
 *
 * @module dsh-llm-pi-ai/live-models
 */

import { LlmError, normalizeApiKey, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { PiAiModality, PiAiModelProfile } from './catalog.ts'

/** How long one successful listing serves before the next request refreshes it. */
export const LIVE_MODEL_TTL_MS = 10 * 60 * 1000

/** Host of the Hugging Face router, whose failures get actionable messages. */
export const HUGGINGFACE_ROUTER_HOST = 'router.huggingface.co'

/** One live model, as a listing discloses it. */
export interface LiveModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Largest context any live provider serves, when disclosed. */
  contextWindow?: number
  /** Request modalities the endpoint declares; `['text']` when it declares none. */
  input: PiAiModality[]
  /** Whether any live provider supports tool calls. */
  tools: boolean
  /** Live provider names in listing order; empty for a plain OpenAI-compatible entry. */
  providers: readonly string[]
}

/** Router routing policies the model id suffix may name; `fastest` is the router default. */
export const ROUTING_POLICIES = ['fastest', 'cheapest', 'preferred'] as const

const MODEL_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/u
const SUFFIX = /^[\w.-]+$/u

/**
 * Split a routed id into its `org/name` base and optional `:suffix`.
 * @param id - the model id as selected or typed.
 * @returns the base id and the suffix (undefined when none).
 */
export function splitRoutedModelId(id: string): { base: string; suffix: string | undefined } {
  const at = id.indexOf(':')
  return at < 0 ? { base: id, suffix: undefined } : { base: id.slice(0, at), suffix: id.slice(at + 1) }
}

/**
 * Whether an id has the router's `org/name[:suffix]` shape.
 * @param id - the candidate id.
 * @returns true when the id can be sent to the router.
 */
export function isRoutableModelId(id: string): boolean {
  const { base, suffix } = splitRoutedModelId(id)
  return MODEL_ID.test(base) && (suffix === undefined || SUFFIX.test(suffix))
}

/**
 * Apply a routing choice to a model id. `fastest` is the router's default and
 * stays bare; an id already carrying a suffix is sent as typed.
 * @param id - `org/name`, or `org/name:suffix`.
 * @param choice - `fastest`, `cheapest`, `preferred`, or a provider name.
 * @returns the id to send in `model`.
 * @throws LlmError `INVALID_MODEL_ID` when the id or choice is malformed.
 */
export function withRoutingSuffix(id: string, choice: string | undefined): string {
  if (!isRoutableModelId(id)) {
    throw new LlmError(`"${id}" is not a model id of the form org/name[:provider]`, 'INVALID_MODEL_ID')
  }
  if (id.includes(':') || choice === undefined || choice === 'fastest') return id
  if (!SUFFIX.test(choice)) {
    throw new LlmError(`"${choice}" is not a routing policy or provider name`, 'INVALID_MODEL_ID')
  }
  return `${id}:${choice}`
}

/** A positive integer, or undefined. */
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** The request modalities an entry declares, text always included. */
function declaredInput(entry: Record<string, unknown>): PiAiModality[] {
  const architecture = entry['architecture'] as { input_modalities?: unknown } | undefined
  const declared = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : []
  return declared.includes('image') ? ['text', 'image'] : ['text']
}

/**
 * Map one `GET /models` reply to live models.
 * @param body - the parsed reply.
 * @returns the kept models in listing order.
 * @throws LlmError `DISCOVERY_FAILED` when the body has no `data` array.
 */
export function mapModelListing(body: unknown): LiveModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError('the model listing has no "data" array', 'DISCOVERY_FAILED')
  }
  const models: LiveModel[] = []
  for (const raw of data) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const id = entry['id']
    if (typeof id !== 'string' || id.length === 0) continue
    const input = declaredInput(entry)
    const listed = entry['providers']
    if (!Array.isArray(listed)) {
      const contextWindow = positive(entry['context_length']) ?? positive(entry['context_window'])
      models.push({ id, ...contextWindow === undefined ? {} : { contextWindow }, input, tools: false, providers: [] })
      continue
    }
    const live = listed.filter((provider): provider is Record<string, unknown> =>
      provider !== null && typeof provider === 'object' && (provider as Record<string, unknown>)['status'] === 'live')
    if (live.length === 0) continue
    let contextWindow: number | undefined
    for (const provider of live) {
      const length = positive(provider['context_length'])
      if (length !== undefined && (contextWindow === undefined || length > contextWindow)) contextWindow = length
    }
    models.push({
      id,
      ...contextWindow === undefined ? {} : { contextWindow },
      input,
      tools: live.some(provider => provider['supports_tools'] === true),
      providers: live.flatMap(provider => typeof provider['provider'] === 'string' ? [provider['provider']] : []),
    })
  }
  return models
}

/** Compact token count: 131072 → `131K`, 1048576 → `1M`. */
function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`
  return `${String(Math.round(tokens / 1000))}K`
}

/**
 * The one-line description a picker shows for a live model. The wire model
 * shape carries no capacity, tool, or provider fields, so this line is the
 * carrier; its grammar (`<n>K context · tools · via a, b`) is stable because
 * the client renders localized badges from it.
 * @param model - the live model.
 * @returns the description, or undefined when there is nothing to say.
 */
export function describeLiveModel(model: LiveModel): string | undefined {
  const parts: string[] = []
  if (model.contextWindow !== undefined) parts.push(`${compactTokens(model.contextWindow)} context`)
  if (model.tools) parts.push('tools')
  if (model.providers.length > 0) parts.push(`via ${model.providers.join(', ')}`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * Merge a route's seed `models` with its live list: seeds first, each filling
 * unset capacity and modality fields from the live entry of its base id, then
 * every live model the seeds do not name.
 * @param seeds - the route's configured models.
 * @param live - the last good live list, if any.
 * @returns the model entries the route resolves.
 */
export function mergeLiveModels(
  seeds: readonly PiAiModelProfile[],
  live: readonly LiveModel[] | undefined,
): PiAiModelProfile[] {
  if (live === undefined) return [...seeds]
  const byId = new Map(live.map(model => [model.id, model]))
  const named = new Set(seeds.map(seed => seed.id))
  const fromLive = (model: LiveModel): Pick<PiAiModelProfile, 'contextWindow' | 'input'> => ({
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    input: [...model.input],
  })
  const merged = seeds.map((seed) => {
    const match = byId.get(splitRoutedModelId(seed.id).base)
    if (match === undefined) return seed
    const filled = fromLive(match)
    return {
      ...seed,
      ...seed.contextWindow === undefined && filled.contextWindow !== undefined
        ? { contextWindow: filled.contextWindow }
        : {},
      ...seed.input === undefined || seed.input.length === 0 ? { input: filled.input } : {},
    }
  })
  for (const model of live) {
    if (!named.has(model.id)) merged.push({ id: model.id, ...fromLive(model) })
  }
  return merged
}

/** The router statuses a user can act on. */
export type RouterFailureKind = 'unauthorized' | 'credits' | 'gated' | 'notFound' | 'rateLimited'

const FAILURES: Readonly<Record<number, { kind: RouterFailureKind; code: string; text: string }>> = {
  401: {
    kind: 'unauthorized',
    code: 'AUTH',
    text: 'the Hugging Face token is invalid or lacks the "Make calls to Inference Providers" permission',
  },
  402: {
    kind: 'credits',
    code: QUOTA_EXCEEDED_CODE,
    text: 'Hugging Face Inference Providers credits are exhausted; add credits at https://huggingface.co/settings/billing',
  },
  403: {
    kind: 'gated',
    code: 'AUTH',
    text: 'this model is gated; accept its license on huggingface.co with the account that owns the token',
  },
  404: {
    kind: 'notFound',
    code: 'UNKNOWN_MODEL',
    text: 'Hugging Face has no such model, or no provider is serving it right now',
  },
  429: {
    kind: 'rateLimited',
    code: 'RATE_LIMIT',
    text: 'Hugging Face is rate limiting this token; retry later',
  },
}

/**
 * The actionable kind of one router status.
 * @param status - HTTP status.
 * @returns the kind, or undefined for any other status.
 */
export function routerFailureKind(status: number): RouterFailureKind | undefined {
  return FAILURES[status]?.kind
}

/**
 * Build the failure for one router status. Actionable statuses carry a
 * `[huggingface:<kind>]` tag the client localizes; anything else keeps the
 * endpoint's own detail.
 * @param status - HTTP status.
 * @param detail - the response's `error` text, when any.
 * @returns the coded failure.
 */
export function routerFailure(status: number, detail?: string): LlmError {
  const known = FAILURES[status]
  const status_ = status >= 100 && status <= 599 ? { status } : {}
  if (known !== undefined) {
    return new LlmError(`[huggingface:${known.kind}] ${known.text}`, known.code, status_)
  }
  return new LlmError(
    `Hugging Face answered ${String(status)}${detail === undefined || detail.length === 0 ? '' : `: ${detail}`}`,
    status >= 500 ? 'SERVER' : 'PROVIDER_ERROR',
    status_,
  )
}

/** Where and how one route's listing is fetched. */
export interface LiveModelSource {
  /** Route endpoint; the listing is `{baseURL}/models`. */
  baseURL: string
  /** Deployment headers configured on the route. */
  headers?: Readonly<Record<string, string>>
  /** Resolve the route's token; undefined means none is stored, so nothing is fetched. */
  apiKey: () => Promise<string | undefined>
}

/** Construction options for {@link LiveModelCache}. */
export interface LiveModelCacheOptions {
  /** Fetch implementation; the global one by default. */
  fetch?: typeof fetch
  /** Clock in milliseconds; `Date.now` by default. */
  now?: () => number
  /** Listing lifetime; {@link LIVE_MODEL_TTL_MS} by default. */
  ttlMs?: number
  /** Observe a failed refresh; the message never carries the token. */
  onFailure?: (route: string, error: LlmError) => void
}

interface RouteEntry {
  models?: readonly LiveModel[]
  fetchedAt?: number
  attemptedAt?: number
  inflight?: Promise<void>
}

/** Pull a readable error string out of a failed reply body without trusting its shape. */
function errorDetail(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
    const nested = (body.error as { message?: unknown } | undefined)?.message
    return typeof nested === 'string' ? nested : undefined
  } catch {
    return text.length > 0 && text.length <= 300 ? text : undefined
  }
}

/** Remove every occurrence of a secret from text bound for a log. */
function redact(text: string, secret: string | undefined): string {
  return secret === undefined || secret.length === 0 ? text : text.split(secret).join('[redacted]')
}

/**
 * Per-route cache of live listings. `generation` advances whenever a route's
 * list changes, which is what lets the plugin's memoized profile resolution
 * notice a refresh.
 */
export class LiveModelCache {
  private readonly routes = new Map<string, RouteEntry>()
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly onFailure: ((route: string, error: LlmError) => void) | undefined
  private generationValue = 0

  constructor(options: LiveModelCacheOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? LIVE_MODEL_TTL_MS
    this.onFailure = options.onFailure
  }

  /** Advances whenever any route's list changes. */
  get generation(): number {
    return this.generationValue
  }

  /**
   * The last good list for one route.
   * @param route - provider route key.
   * @returns the list, or undefined before the first successful listing.
   */
  models(route: string): readonly LiveModel[] | undefined {
    return this.routes.get(route)?.models
  }

  /**
   * The picker description for one model id, suffix ignored.
   * @param route - provider route key.
   * @param modelId - the listed or routed id.
   * @returns the description, or undefined when the live list does not name it.
   */
  describe(route: string, modelId: string): string | undefined {
    const base = splitRoutedModelId(modelId).base
    const model = this.models(route)?.find(candidate => candidate.id === base)
    return model === undefined ? undefined : describeLiveModel(model)
  }

  /**
   * Refresh one route's list when it is older than the TTL. Failures are
   * reported and swallowed: the last good list keeps serving. Concurrent
   * callers share one request.
   * @param route - provider route key.
   * @param source - the endpoint and token resolution.
   * @param signal - optional cancellation.
   */
  refresh(route: string, source: LiveModelSource, signal?: AbortSignal): Promise<void> {
    const entry = this.routes.get(route) ?? {}
    this.routes.set(route, entry)
    if (entry.inflight !== undefined) return entry.inflight
    const last = entry.attemptedAt
    if (last !== undefined && this.now() - last < this.ttlMs) return Promise.resolve()
    const run = this.fetchListing(route, entry, source, signal).finally(() => { delete entry.inflight })
    entry.inflight = run
    return run
  }

  private async fetchListing(route: string, entry: RouteEntry, source: LiveModelSource, signal?: AbortSignal): Promise<void> {
    let secret: string | undefined
    try {
      const raw = await source.apiKey()
      // No token, no call: a keyless route stays on its seeds and is asked
      // again on the next request, so storing a token takes effect at once.
      if (raw === undefined || raw.length === 0) return
      const checked = normalizeApiKey(raw)
      if (!checked.ok) throw new LlmError('the stored token is not a usable API key', 'INVALID_CREDENTIAL')
      secret = checked.value
      entry.attemptedAt = this.now()
      const url = `${source.baseURL.replace(/\/+$/u, '')}/models`
      const headers = new Headers(source.headers === undefined ? undefined : Object.entries(source.headers))
      headers.set('accept', 'application/json')
      headers.set('authorization', `Bearer ${secret}`)
      const response = await this.fetchImpl(url, { method: 'GET', headers, ...signal === undefined ? {} : { signal } })
      const text = await response.text()
      if (!response.ok) throw routerFailure(response.status, errorDetail(text))
      const models = mapModelListing(JSON.parse(text) as unknown)
      if (models.length === 0) throw new LlmError('the model listing named no live model', 'DISCOVERY_FAILED')
      entry.models = models
      entry.fetchedAt = entry.attemptedAt
      this.generationValue += 1
    } catch (error: unknown) {
      const failure = error instanceof LlmError
        ? error
        : new LlmError('could not read the model listing', 'DISCOVERY_FAILED')
      const safe = new LlmError(redact(failure.message, secret), failure.failure.code,
        failure.failure.status === undefined ? {} : { status: failure.failure.status })
      this.onFailure?.(route, safe)
    }
  }
}
