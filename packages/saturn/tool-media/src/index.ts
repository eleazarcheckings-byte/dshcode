/**
 * `ctx.media`: model-facing generation (image, video, audio, motion-transfer) over three providers
 * behind one seam — gemini (image + Veo video), openai (image, optional), higgsfield (async job API;
 * the only provider wired for motion-transfer/object-swap). Every paid call requests approval before
 * the billable network call fires, regardless of any permission preset — through `ctx.approval` (the
 * preferred route) when the call carries an `Agent` to route it through, falling back to
 * `ctx.userQuestions` (which accepts no agent at all) when it does not — with the estimated USD cost
 * line in either prompt; a missing approval route (neither service composed, or composed with no
 * answerer) fails the call closed rather than silently spending money.
 *
 * Template followed throughout: `packages/vision/tool-describe-image` (credential seam, redirect-
 * refusing HTTP client, bounded reads, re-resolved-per-call settings) and `packages/web/web-fetch-http`
 * (provider-seam shape). See the package README for the verified provider contracts and their dates.
 * @module @saturnai/dsh-tool-media
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'

import {
  DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_GEMINI_VIDEO_MODEL,
  generateGeminiImage, generateGeminiVideo, geminiImageCost, geminiVideoCost, resolveGeminiConfig,
} from './providers/gemini.ts'
import type { GeminiConfig, ResolvedGeminiConfig, VeoParams } from './providers/gemini.ts'
import {
  DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_IMAGE_MODEL,
  generateOpenAiImage, openAiImageCost, resolveOpenAiConfig,
} from './providers/openai.ts'
import type { OpenAiConfig, OpenAiImageParams, ResolvedOpenAiConfig } from './providers/openai.ts'
import {
  DEFAULT_HIGGSFIELD_BASE_URL, DEFAULT_HIGGSFIELD_IMAGE_MODEL_PATH,
  downloadHiggsfieldAsset, estimateHiggsfieldCost, normalizeHiggsfieldStatus, parseHiggsfieldCredential,
  pollHiggsfieldUntilTerminal, resolveHiggsfieldConfig, submitHiggsfieldRequest,
} from './providers/higgsfield.ts'
import type { HiggsfieldConfig, HiggsfieldCredential, HiggsfieldMediaOutput, ResolvedHiggsfieldConfig } from './providers/higgsfield.ts'
import type { MediaAsset, MediaCost, MediaGenerateRequest, MediaJob, MediaKind, MediaProviderId } from './types.ts'

export type { MediaAsset, MediaCost, MediaGenerateRequest, MediaJob, MediaJobStatus, MediaKind, MediaProviderId } from './types.ts'

/**
 * Every {@link MediaProviderId}, for option advertisement and runtime validation of a caller-supplied
 * provider string. Lives here (not `types.ts`) per this repo's `src/types.ts`-is-types-only convention.
 */
export const MEDIA_PROVIDER_IDS: readonly MediaProviderId[] = ['gemini', 'openai', 'higgsfield']

/** Every {@link MediaKind}. Lives here for the same reason as {@link MEDIA_PROVIDER_IDS}. */
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'motion-transfer']

declare module '@deepseek-ai/cordis' {
  interface Context {
    media: MediaService
  }
}

/** Cordis plugin name. */
export const name = 'tool-media'
/**
 * Services this plugin composes against; `approval` and `userQuestions` are both optional (soft
 * `ctx.get(...)` lookups below) — the spend Gate prefers `approval` when the call has an `Agent`,
 * falls back to `userQuestions` when it does not, and fails every paid call closed when neither route
 * is available to ask through.
 */
export const inject = ['tools']

const DEFAULT_GEMINI_API_KEY_ENV = 'GEMINI_API_KEY'
const DEFAULT_OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
const DEFAULT_HIGGSFIELD_API_KEY_ENV = 'HIGGSFIELD_API_KEY'

/** Loader-facing config for the Gemini sub-block, plus its credential fields. */
export interface GeminiPluginConfig extends GeminiConfig {
  /** Literal Gemini API key; mutually exclusive with `apiKeyEnv` and never logged. */
  readonly apiKey?: string
  /** Name of the environment variable holding the Gemini API key; defaults to `GEMINI_API_KEY`. */
  readonly apiKeyEnv?: string
}

/** Loader-facing config for the OpenAI sub-block, plus its credential fields. */
export interface OpenAiPluginConfig extends OpenAiConfig {
  /** Literal OpenAI API key; mutually exclusive with `apiKeyEnv` and never logged. */
  readonly apiKey?: string
  /** Name of the environment variable holding the OpenAI API key; defaults to `OPENAI_API_KEY`. */
  readonly apiKeyEnv?: string
}

/** Loader-facing config for the Higgsfield sub-block, plus its (combined `id:secret`) credential fields. */
export interface HiggsfieldPluginConfig extends HiggsfieldConfig {
  /** Literal, already-combined `"{id}:{secret}"` Higgsfield credential; mutually exclusive with `apiKeyEnv` and never logged. */
  readonly apiKey?: string
  /** Name of the environment variable holding the combined `"{id}:{secret}"` Higgsfield credential; defaults to `HIGGSFIELD_API_KEY`. */
  readonly apiKeyEnv?: string
}

/** Deployment configuration for the media tool package. */
export interface Config {
  /** Gemini provider sub-block: credentials plus `GeminiConfig`; omit to leave the provider unconfigured. */
  readonly gemini?: GeminiPluginConfig
  /** OpenAI provider sub-block: credentials plus `OpenAiConfig`; omit to leave the provider unconfigured. */
  readonly openai?: OpenAiPluginConfig
  /** Higgsfield provider sub-block: credentials plus `HiggsfieldConfig`; omit to leave the provider unconfigured. */
  readonly higgsfield?: HiggsfieldPluginConfig
  /** Provider used when a call omits `provider` for an `image` request; defaults to `gemini`. */
  readonly defaultImageProvider?: MediaProviderId
  /** Provider used when a call omits `provider` for a `video` request; defaults to `gemini`. */
  readonly defaultVideoProvider?: MediaProviderId
}

const providerSchema = z.union(['gemini', 'openai', 'higgsfield'] as const)

const geminiConfigSchema = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_GEMINI_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_GEMINI_BASE_URL),
  imageModel: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
  videoModel: z.string().default(DEFAULT_GEMINI_VIDEO_MODEL),
  timeoutMs: z.number().step(1).min(1),
  pollIntervalMs: z.number().step(1).min(1),
  pollTimeoutMs: z.number().step(1).min(1),
})

const openAiConfigSchema = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_OPENAI_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_OPENAI_BASE_URL),
  imageModel: z.string().default(DEFAULT_OPENAI_IMAGE_MODEL),
  timeoutMs: z.number().step(1).min(1),
})

const higgsfieldConfigSchema = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_HIGGSFIELD_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_HIGGSFIELD_BASE_URL),
  imageModelPath: z.string().default(DEFAULT_HIGGSFIELD_IMAGE_MODEL_PATH),
  timeoutMs: z.number().step(1).min(1),
  pollIntervalMs: z.number().step(1).min(1),
  pollTimeoutMs: z.number().step(1).min(1),
})

/** Loader schema for the media tool plugin; every nested block is optional (a provider with no config is simply unavailable). */
export const Config: z<Config> = z.object({
  gemini: geminiConfigSchema,
  openai: openAiConfigSchema,
  higgsfield: higgsfieldConfigSchema,
  defaultImageProvider: providerSchema.default('gemini'),
  defaultVideoProvider: providerSchema.default('gemini'),
})

/** Resolve one API key: an explicit inline value wins; otherwise the credential seam, falling back to the launch environment. */
async function resolveApiKey(ctx: Context, label: string, inline: string | undefined, envName: string): Promise<string> {
  if (inline !== undefined) return inline
  let ref: CredentialRef
  try {
    ref = credentialRef(envName)
  } catch {
    throw new Error(`${label}: apiKeyEnv ${JSON.stringify(envName)} is not a valid environment-variable name`)
  }
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined) return hit.value
  } else {
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) return ambient.value
  }
  throw new Error(
    `${label}: no API key; set apiKey, store ${envName} through the credentials service, or export it in the launching environment`,
  )
}

/** File extension for a workspace asset, derived from its media type. */
function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
  }
  return known[mimeType.toLowerCase()] ?? 'bin'
}

/** Write generated bytes under `<workspace>/.saturn/media/` and return the durable asset reference. */
async function writeMediaAsset(workspace: string, data: Buffer, mimeType: string, url?: string): Promise<MediaAsset> {
  const dir = join(workspace, '.saturn', 'media')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${randomUUID()}.${extensionFor(mimeType)}`)
  await writeFile(path, data)
  return { path, mimeType, ...url !== undefined ? { url } : {} }
}

/** Execution identity a caller routes a generation call's spend-approval prompt through. */
export interface MediaExecContext {
  readonly agent?: Agent
  readonly callId?: ToolCallId
  readonly signal?: AbortSignal
  /** Model-facing tool name shown in the approval audit trail; defaults to `media`. */
  readonly toolName?: string
}

/**
 * A binding of `ctx.media` to one calling identity — matches SPEC §4's pinned single-argument
 * `{ generate(req): Promise<Job>; status(id): Promise<Job> }` interface exactly, so a consumer that
 * holds an {@link Agent} once (rather than per call) can hand this object anywhere the pinned shape
 * is expected. See {@link MediaService.withAgent}.
 */
export interface BoundMediaService {
  generate(request: MediaGenerateRequest): Promise<MediaJob>
  status(id: string): Promise<MediaJob>
}

/** One job this service is still tracking after `generate()` returned it non-terminal, or has already resolved. */
type TrackedJob =
  | { readonly kind: 'resolved'; job: MediaJob }
  | {
    readonly kind: 'higgsfield'
    readonly model: string
    readonly cost: MediaCost
    readonly workspace: string
    readonly requestId: string
    readonly spec: ResolvedHiggsfieldConfig
    readonly credential: HiggsfieldCredential
  }

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The two options `requireSpendApprovalViaUserQuestions` offers, matched by label (not position). */
const SPEND_APPROVE_LABEL = 'Approve'
const SPEND_DECLINE_LABEL = 'Decline'
/** Stable id for the single question the agentless fallback asks — echoed back in the answer. */
const SPEND_QUESTION_ID = 'media-spend-approval'

/**
 * Ask before any billable network call, preferring `ctx.approval` (needs an `Agent` to route its
 * prompt through) and falling back to `ctx.userQuestions` (accepts none) when that route is not
 * available for this call. Unconditional: this package has no free provider, so every `generate()`
 * call reaches here, and there is no permission preset that skips it.
 * @throws when neither route is available, or the chosen route's outcome is not an approval.
 */
async function requireSpendApproval(ctx: Context, exec: MediaExecContext, request: MediaGenerateRequest, cost: MediaCost): Promise<void> {
  const reason = `Generate ${request.kind} via ${cost.provider}/${cost.model} — estimated cost `
    + `$${cost.estimatedUsd.toFixed(3)} USD. Prompt: "${truncate(request.prompt, 200)}"`

  const approval = ctx.get('approval')
  if (approval !== undefined && exec.agent !== undefined) {
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.toolName ?? 'media',
      ...exec.callId !== undefined ? { callId: exec.callId } : {},
      reason,
      ...exec.signal !== undefined ? { signal: exec.signal } : {},
    })
    switch (outcome) {
      case 'allowed-once': return
      case 'rejected': throw new Error(`media: the user declined this $${cost.estimatedUsd.toFixed(3)} generation`)
      case 'cancelled': throw new Error('media: approval for this generation was cancelled')
      case 'unavailable': throw new Error('media: this generation costs money but no approval channel answered')
    }
    return
  }

  // The preferred ctx.approval-with-Agent route is unavailable — either no approval service is
  // composed, or (SPEC §4's pinned single-argument `generate(req)` shape, SaturnBot's real
  // `creative.generate` call site) this call carries no Agent to route its prompt through at all.
  // Fall back to ctx.userQuestions, which asks unscoped when given no agent and still fails closed
  // (a missing service, no answerer, an aborted ask, or a Decline all throw before any network call).
  const unavailableReason = approval === undefined
    ? 'no approval service is composed'
    : 'the call has no agent to route the approval prompt through'
  await requireSpendApprovalViaUserQuestions(ctx, exec, reason, cost, unavailableReason)
}

/**
 * The agentless spend-approval fallback: asks one yes/no question through `ctx.userQuestions` —
 * carrying the same estimated-cost line as the `ctx.approval` route — and fails closed on every
 * outcome except an explicit {@link SPEND_APPROVE_LABEL}. Never fires a billable network call itself;
 * the caller (`requireSpendApproval`) only proceeds to one after this resolves without throwing.
 */
async function requireSpendApprovalViaUserQuestions(
  ctx: Context, exec: MediaExecContext, reason: string, cost: MediaCost, unavailableReason: string,
): Promise<void> {
  const userQuestions = ctx.get('userQuestions')
  if (userQuestions === undefined) {
    throw new Error(
      `media: this generation costs money but ${unavailableReason}, and no user-questions answerer is `
      + 'composed either; refusing to spend without a Gate',
    )
  }
  let answer: AskUserQuestionAnswer
  try {
    answer = await userQuestions.ask({
      questions: [{
        id: SPEND_QUESTION_ID,
        question: `Approve this ${cost.provider}/${cost.model} generation?`,
        detail: reason,
        options: [{ label: SPEND_APPROVE_LABEL }, { label: SPEND_DECLINE_LABEL }],
      }],
      ...exec.agent !== undefined ? { agent: exec.agent } : {},
      ...exec.signal !== undefined ? { signal: exec.signal } : {},
    })
  } catch (error) {
    throw new Error(
      'media: this generation costs money but the user-questions approval failed closed '
      + `(${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const item = answer.answers.find(entry => entry.id === SPEND_QUESTION_ID)
  if (item === undefined || !item.selected.includes(SPEND_APPROVE_LABEL)) {
    throw new Error(`media: the user declined this $${cost.estimatedUsd.toFixed(3)} generation`)
  }
}

function assertAbsoluteWorkspace(workspace: string): void {
  if (workspace.trim().length === 0) throw new Error('media: workspace must be a non-empty absolute path')
}

/**
 * `ctx.media`: resolves a provider per call, gates every billable request behind the spend Gate
 * (`ctx.approval` when the call has an `Agent`, `ctx.userQuestions` when it does not), writes results
 * under the caller's workspace, and tracks non-terminal jobs for `status()`.
 *
 * `generate()` matches the `{ generate(req): Promise<Job>; status(id): Promise<Job> }` interface
 * SPEC §4 pins between this package and its consumers (C8a) exactly — a caller may call `generate(req)`
 * with only the pinned single-object shape, no second argument, and it runs. What varies is which
 * route the spend Gate takes: an optional second `exec` parameter (or {@link MediaService.withAgent}'s
 * binding) carries an `Agent`, and when one is present `ctx.approval` is the preferred route (it
 * fundamentally requires an `Agent` to attach its prompt/audit trail to). SaturnBot's real
 * `creative.generate` call site — the pinned shape's only known consumer — has no `Agent` anywhere in
 * its own execution model, so for a call with no `exec.agent` the Gate falls back to
 * `ctx.userQuestions` instead, which accepts an undefined agent and asks unscoped; both routes carry
 * the same estimated-cost line and both fail the call closed (never silently spend) when their
 * respective service isn't composed, has no answerer, or the human declines. See
 * {@link requireSpendApproval} for the exact preference order, and the README Known Limitations for
 * the fuller rationale.
 */
export class MediaService extends Service {
  static Config = Config
  private readonly pending = new Map<string, TrackedJob>()

  constructor(ctx: Context, public config: Config = {}) {
    super(ctx, 'media')
  }

  private resolvedGemini(): ResolvedGeminiConfig {
    return resolveGeminiConfig(this.config.gemini ?? {})
  }

  private resolvedOpenAi(): ResolvedOpenAiConfig {
    return resolveOpenAiConfig(this.config.openai ?? {})
  }

  private resolvedHiggsfield(): ResolvedHiggsfieldConfig {
    return resolveHiggsfieldConfig(this.config.higgsfield ?? {})
  }

  private async geminiApiKey(): Promise<string> {
    const raw = this.config.gemini ?? {}
    return resolveApiKey(this.ctx, 'gemini', raw.apiKey, raw.apiKeyEnv ?? DEFAULT_GEMINI_API_KEY_ENV)
  }

  private async openAiApiKey(): Promise<string> {
    const raw = this.config.openai ?? {}
    return resolveApiKey(this.ctx, 'openai', raw.apiKey, raw.apiKeyEnv ?? DEFAULT_OPENAI_API_KEY_ENV)
  }

  private async higgsfieldCredential(): Promise<HiggsfieldCredential> {
    const raw = this.config.higgsfield ?? {}
    const combined = await resolveApiKey(this.ctx, 'higgsfield', raw.apiKey, raw.apiKeyEnv ?? DEFAULT_HIGGSFIELD_API_KEY_ENV)
    return parseHiggsfieldCredential(combined)
  }

  /**
   * Bind this service to one calling {@link Agent}, producing a {@link BoundMediaService} that
   * matches SPEC §4's pinned single-argument `generate(req)`/`status(id)` shape exactly — the answer
   * to a consumer that holds an `Agent` up front (e.g. once per composition) and wants to hand the
   * pinned interface to code that has no `exec` parameter to thread through, rather than calling the
   * raw `generate(req, exec)` on every request. Spend approval still runs exactly as it would for the
   * raw call — `agent` here becomes `exec.agent` — so a rejected/cancelled/unavailable approval still
   * throws the same distinct errors, and there is still no free path for any provider in this package.
   * @param agent - the identity `ctx.approval` routes this binding's prompts through.
   * @param defaults - additional `exec` fields (`callId`, `signal`, `toolName`) applied to every call
   *   made through the binding; `toolName` defaults to `'media'` when omitted, matching direct `ctx.media` use.
   * @returns a `{ generate, status }` pair with `agent` and `defaults` already closed over, so callers
   *   invoke `generate(request)` / `status(id)` without threading `exec` themselves.
   */
  withAgent(agent: Agent, defaults: Omit<MediaExecContext, 'agent'> = {}): BoundMediaService {
    const exec: MediaExecContext = { agent, ...defaults }
    return {
      generate: request => this.generate(request, exec),
      status: id => this.status(id),
    }
  }

  /**
   * Resolve one generation request to a terminal (`'done'`/`'failed'`) job, gating the billable
   * network call behind approval first. See the class doc for the `exec` extension rationale.
   * @param request - the kind, prompt, target provider (or the configured default for `request.kind`
   *   when omitted), workspace, and provider-specific params for the generation; `request.workspace`
   *   must be an absolute path and `request.prompt` must be non-empty.
   * @param exec - the calling `Agent` (routes the spend-approval prompt through `ctx.approval` when
   *   present, else `ctx.userQuestions`) plus optional `callId`, `signal`, and `toolName`; defaults
   *   to `{}`, which fails the call closed if no approval route is composed.
   * @returns the terminal job, its produced assets, and the metered cost once approval and the
   *   provider call both succeed; throws on an empty prompt, an unknown provider, a rejected or
   *   unavailable approval, or a provider-side failure.
   */
  async generate(request: MediaGenerateRequest, exec: MediaExecContext = {}): Promise<MediaJob> {
    assertAbsoluteWorkspace(request.workspace)
    if (request.prompt.trim().length === 0) throw new Error('media: prompt must be non-empty')
    const provider = request.provider ?? this.defaultProviderFor(request.kind)
    switch (provider) {
      case 'gemini': return this.generateWithGemini(request, exec)
      case 'openai': return this.generateWithOpenAi(request, exec)
      case 'higgsfield': return this.generateWithHiggsfield(request, exec)
      default: throw new Error(`media: unknown provider "${provider as string}"`)
    }
  }

  /** Cache a terminal job under its own id so a later `status(id)` call can re-read it. */
  private cacheResolved(job: MediaJob): MediaJob {
    this.pending.set(job.id, { kind: 'resolved', job })
    return job
  }

  private defaultProviderFor(kind: MediaKind): MediaProviderId {
    if (kind === 'motion-transfer') return 'higgsfield'
    if (kind === 'audio') return 'higgsfield'
    if (kind === 'video') return this.config.defaultVideoProvider ?? 'gemini'
    return this.config.defaultImageProvider ?? 'gemini'
  }

  private async generateWithGemini(request: MediaGenerateRequest, exec: MediaExecContext): Promise<MediaJob> {
    const spec = this.resolvedGemini()
    if (request.kind === 'image') {
      const model = request.model ?? spec.imageModel
      const cost = geminiImageCost(model)
      await requireSpendApproval(this.ctx, exec, request, cost)
      const apiKey = await this.geminiApiKey()
      const signal = exec.signal ?? new AbortController().signal
      const media = await generateGeminiImage({ ...spec, imageModel: model }, apiKey, request.prompt, signal)
      const asset = await writeMediaAsset(request.workspace, media.data, media.mimeType)
      return this.cacheResolved({ id: randomUUID(), status: 'done', assets: [asset], cost })
    }
    if (request.kind === 'video') {
      const model = request.model ?? spec.videoModel
      const params = request.params as (VeoParams & { durationSeconds?: string }) | undefined
      const durationSeconds = params?.durationSeconds !== undefined ? Number(params.durationSeconds) : 8
      const cost = geminiVideoCost(model, durationSeconds)
      await requireSpendApproval(this.ctx, exec, request, cost)
      const apiKey = await this.geminiApiKey()
      const signal = exec.signal ?? new AbortController().signal
      const media = await generateGeminiVideo({ ...spec, videoModel: model }, apiKey, request.prompt, params, signal)
      const asset = await writeMediaAsset(request.workspace, media.data, media.mimeType)
      return this.cacheResolved({ id: randomUUID(), status: 'done', assets: [asset], cost })
    }
    throw new Error(`media: gemini does not support "${request.kind}" generation in this package (only image and video are wired)`)
  }

  private async generateWithOpenAi(request: MediaGenerateRequest, exec: MediaExecContext): Promise<MediaJob> {
    if (request.kind !== 'image') {
      throw new Error(`media: openai does not support "${request.kind}" generation in this package (only image is wired)`)
    }
    const spec = this.resolvedOpenAi()
    const model = request.model ?? spec.imageModel
    const params = request.params as (OpenAiImageParams & { pricePerImageUsd?: number }) | undefined
    const cost = openAiImageCost(model, params?.pricePerImageUsd)
    await requireSpendApproval(this.ctx, exec, request, cost)
    const apiKey = await this.openAiApiKey()
    const signal = exec.signal ?? new AbortController().signal
    const media = await generateOpenAiImage({ ...spec, imageModel: model }, apiKey, request.prompt, params, signal)
    const asset = await writeMediaAsset(request.workspace, media.data, media.mimeType)
    return this.cacheResolved({ id: randomUUID(), status: 'done', assets: [asset], cost })
  }

  private async generateWithHiggsfield(request: MediaGenerateRequest, exec: MediaExecContext): Promise<MediaJob> {
    const spec = this.resolvedHiggsfield()
    const params = (request.params ?? {}) as { modelPath?: string; body?: Record<string, unknown> }
    const modelPath = (request.model ?? params.modelPath
      ?? (request.kind === 'image' ? spec.imageModelPath : undefined))?.trim().replace(/^\/+/, '')
    if (modelPath === undefined || modelPath.length === 0) {
      throw new Error(
        `media: higgsfield "${request.kind}" generation requires an explicit model path — pass params.modelPath `
        + '(this package verified no default endpoint for this kind in the published docs.higgsfield.ai openapi.json '
        + 'as of 2026-09-15; see the README Known Limitations, especially for "motion-transfer")',
      )
    }
    const body: Record<string, unknown> = { prompt: request.prompt, ...params.body }
    const credential = await this.higgsfieldCredential()
    const signal = exec.signal ?? new AbortController().signal
    // The estimate call is Higgsfield's own documented free/read-only quote (billing-and-retention.md)
    // — it is not the billable generation call, so it may run before approval; the submission below
    // never fires until approval grants it.
    const cost = await estimateHiggsfieldCost(spec, credential, modelPath, body, signal)
    await requireSpendApproval(this.ctx, exec, request, cost)
    const accepted = await submitHiggsfieldRequest(spec, credential, modelPath, body, signal)
    const tracked: TrackedJob = {
      kind: 'higgsfield', model: modelPath, cost, workspace: request.workspace, requestId: accepted.request_id, spec, credential,
    }
    this.pending.set(accepted.request_id, tracked)
    const resolved = await this.resolveHiggsfieldJob(tracked, signal)
    return resolved
  }

  private async resolveHiggsfieldJob(tracked: Extract<TrackedJob, { kind: 'higgsfield' }>, signal: AbortSignal): Promise<MediaJob> {
    const status = await pollHiggsfieldUntilTerminal(tracked.spec, tracked.credential, tracked.requestId, signal)
    const normalized = normalizeHiggsfieldStatus(status.status)
    if (normalized === 'failed') {
      const job: MediaJob = {
        id: tracked.requestId,
        status: 'failed',
        assets: [],
        cost: tracked.cost,
        error: status.error ?? `higgsfield request ended as "${status.status}"`,
      }
      this.pending.set(tracked.requestId, { kind: 'resolved', job })
      return job
    }
    const outputs: HiggsfieldMediaOutput[] = [
      ...status.images ?? [],
      ...status.video !== undefined ? [status.video] : [],
      ...status.audio !== undefined ? [status.audio] : [],
      ...status.audios ?? [],
    ]
    const assets: MediaAsset[] = []
    for (const output of outputs) {
      const data = await downloadHiggsfieldAsset(output.url, signal)
      assets.push(await writeMediaAsset(tracked.workspace, data, output.content_type ?? 'application/octet-stream', output.url))
    }
    const job: MediaJob = { id: tracked.requestId, status: 'done', assets, cost: tracked.cost }
    this.pending.set(tracked.requestId, { kind: 'resolved', job })
    return job
  }

  /**
   * Re-read a job's last known result. Every job this package produces is already terminal by the
   * time `generate()` returns (see the README Known Limitations), so this is a cache read, not a fresh poll.
   * @param id - the `MediaJob.id` returned by an earlier `generate()` call.
   * @returns the cached terminal job for `id`; throws when `id` is unknown to this service instance
   *   (jobs do not persist across process restarts).
   */
  async status(id: string): Promise<MediaJob> {
    const tracked = this.pending.get(id)
    if (tracked === undefined) throw new Error(`media: unknown job id "${id}"`)
    if (tracked.kind === 'resolved') return tracked.job
    return this.resolveHiggsfieldJob(tracked, new AbortController().signal)
  }
}

const MEDIA_ASSET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    mimeType: { type: 'string', required: true },
    url: { type: 'string' },
  },
} as const

const MEDIA_COST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    estimatedUsd: { type: 'number', required: true },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
  },
} as const

const MEDIA_JOB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['queued', 'running', 'done', 'failed'] },
    assets: { type: 'array', required: true, items: MEDIA_ASSET_SCHEMA },
    cost: { type: 'object', required: true, additionalProperties: false, properties: MEDIA_COST_SCHEMA.properties },
    error: { type: 'string' },
  },
} as const

const PROVIDER_PARAM = {
  type: 'string',
  enum: MEDIA_PROVIDER_IDS,
  description: 'Explicit backend override; omit to use the configured default for this media kind.',
} as const
const MODEL_PARAM = { type: 'string', description: 'Explicit model id/path override for the resolved provider.' } as const
const PARAMS_PARAM = {
  type: 'object',
  additionalProperties: true,
  description:
    'Provider-specific extras — see the tool-media README for the accepted fields per provider '
    + '(aspect ratio, duration, resolution, reference image, higgsfield modelPath/body, pricePerImageUsd, …).',
} as const

function jobCallView(title: string, args: { prompt: string }): GenericCallView {
  return { card: 'generic', title, kind: 'fetch', rawInput: { prompt: args.prompt } }
}

interface JobRenderValue {
  id: string
  status: string
  assets: readonly { path: string }[]
  cost: { estimatedUsd: number; provider: string; model: string }
}

function jobRenderText(value: JobRenderValue): string {
  const assetLines = value.assets.length > 0
    ? value.assets.map(asset => `  - ${asset.path}`).join('\n')
    : '  (none yet)'
  const costLabel = `${value.cost.provider}/${value.cost.model}, ~$${value.cost.estimatedUsd.toFixed(3)}`
  return `Job ${value.id} — ${value.status} (${costLabel})\n${assetLines}`
}

/**
 * Register `ctx.media` and its five model-facing tools. Every generation tool derives `workspace`
 * from the calling agent's session cwd (the same convention `packages/shell/tool-bash` uses) rather
 * than asking the model for it.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration, validated at load by the sub-resolvers.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Fail loud at load if any configured sub-block is malformed, mirroring tool-describe-image.
  if (config.gemini !== undefined) resolveGeminiConfig(config.gemini)
  if (config.openai !== undefined) resolveOpenAiConfig(config.openai)
  if (config.higgsfield !== undefined) resolveHiggsfieldConfig(config.higgsfield)

  ctx.plugin(MediaService, config)

  // Soft accessor, matching the codebase's own convention for an optional peer service
  // (`ctx.get('approval')`, `ctx.get('credentials')`, …): the tool closures below capture this
  // same `ctx`, and Cordis's direct-property access (`ctx.media`) is gated on THIS plugin having
  // declared `inject: ['media']` — which would be circular, since this plugin is what PROVIDES
  // `media`. `ctx.get(...)` carries no such requirement.
  const media = (): MediaService => {
    const service = ctx.get('media')
    if (service === undefined) throw new Error('media: ctx.media failed to mount (internal error)')
    return service
  }

  const workspaceOf = (exec: { agent?: Agent }): string => exec.agent?.session.header.cwd ?? process.cwd()
  const execOf = (exec: { agent?: Agent; callId: ToolCallId; signal: AbortSignal }, toolName: string): MediaExecContext =>
    ({ ...exec.agent !== undefined ? { agent: exec.agent } : {}, callId: exec.callId, signal: exec.signal, toolName })

  ctx.tools.register(defineTool({
    name: 'media_generate_image',
    description:
      'Generate one image from a text prompt. Costs money — the user is asked to approve the estimated cost '
      + 'before generation starts. Returns a file reference under the workspace, not the image bytes.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image to generate, described in detail.' },
      provider: PROVIDER_PARAM,
      model: MODEL_PARAM,
      params: PARAMS_PARAM,
    },
    output: {
      schema: MEDIA_JOB_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: jobRenderText(value) }],
    },
    async execute(args, exec) {
      const request: MediaGenerateRequest = {
        kind: 'image', prompt: args.prompt, workspace: workspaceOf(exec),
        ...args.provider !== undefined ? { provider: args.provider } : {},
        ...args.model !== undefined ? { model: args.model } : {},
        ...args.params !== undefined ? { params: args.params } : {},
      }
      return media().generate(request, execOf(exec, 'media_generate_image'))
    },
    presentCall: args => jobCallView('Generate image', args),
  }))

  ctx.tools.register(defineTool({
    name: 'media_generate_video',
    description:
      'Generate one short video from a text prompt (optionally seeded by a first-frame image). Costs money — '
      + 'the user is asked to approve the estimated cost before generation starts. Returns a file reference under the workspace.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The video to generate, described in detail (subject, action, camera, style).',
      },
      provider: PROVIDER_PARAM,
      model: MODEL_PARAM,
      params: PARAMS_PARAM,
    },
    output: {
      schema: MEDIA_JOB_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: jobRenderText(value) }],
    },
    async execute(args, exec) {
      const request: MediaGenerateRequest = {
        kind: 'video', prompt: args.prompt, workspace: workspaceOf(exec),
        ...args.provider !== undefined ? { provider: args.provider } : {},
        ...args.model !== undefined ? { model: args.model } : {},
        ...args.params !== undefined ? { params: args.params } : {},
      }
      return media().generate(request, execOf(exec, 'media_generate_video'))
    },
    presentCall: args => jobCallView('Generate video', args),
  }))

  ctx.tools.register(defineTool({
    name: 'media_generate_audio',
    description:
      'Generate one audio clip (speech or music) from a text prompt, via the higgsfield provider. Costs money — '
      + 'the user is asked to approve the estimated cost before generation starts. Requires params.modelPath '
      + '(the exact Higgsfield audio model path) since no default is configured.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The audio to generate — the words to speak, or a description of the music.',
      },
      provider: PROVIDER_PARAM,
      model: MODEL_PARAM,
      params: PARAMS_PARAM,
    },
    output: {
      schema: MEDIA_JOB_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: jobRenderText(value) }],
    },
    async execute(args, exec) {
      const request: MediaGenerateRequest = {
        kind: 'audio', prompt: args.prompt, workspace: workspaceOf(exec), provider: args.provider ?? 'higgsfield',
        ...args.model !== undefined ? { model: args.model } : {},
        ...args.params !== undefined ? { params: args.params } : {},
      }
      return media().generate(request, execOf(exec, 'media_generate_audio'))
    },
    presentCall: args => jobCallView('Generate audio', args),
  }))

  ctx.tools.register(defineTool({
    name: 'media_motion_transfer',
    description:
      'Higgsfield-only motion-transfer or object-swap on a source video (the "Genjutsu" capability): keep the '
      + 'motion/camera/timing and rebuild the cast/location/product from references, or swap one element while '
      + 'leaving the rest untouched. Costs money — the user is asked to approve the estimated cost before '
      + 'generation starts. Requires params.modelPath (the exact Higgsfield endpoint path) and params.body '
      + '(the exact request body that endpoint needs — reference/driving media URLs, etc.), since '
      + 'docs.higgsfield.ai does not publish a fixed path for this feature as of 2026-09-15.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'What should change (or stay the same) in the rebuilt footage.',
      },
      model: MODEL_PARAM,
      params: PARAMS_PARAM,
    },
    output: {
      schema: MEDIA_JOB_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: jobRenderText(value) }],
    },
    async execute(args, exec) {
      const request: MediaGenerateRequest = {
        kind: 'motion-transfer', prompt: args.prompt, workspace: workspaceOf(exec), provider: 'higgsfield',
        ...args.model !== undefined ? { model: args.model } : {},
        ...args.params !== undefined ? { params: args.params } : {},
      }
      return media().generate(request, execOf(exec, 'media_motion_transfer'))
    },
    presentCall: args => jobCallView('Motion transfer', args),
  }))

  ctx.tools.register(defineTool({
    name: 'media_job_status',
    description: 'Look up the status and output assets of a previously started media generation job, by the id it returned.',
    parameters: {
      id: { type: 'string', required: true, description: 'The job id a previous media_generate_* / media_motion_transfer call returned.' },
    },
    output: {
      schema: MEDIA_JOB_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: jobRenderText(value) }],
    },
    async execute(args) {
      return media().status(args.id)
    },
    presentCall: args => ({ card: 'generic', title: 'Media job status', kind: 'read', rawInput: { id: args.id } }),
  }))
}

// Named exports only. cordis-plugin-loader's unwrapExports takes `module.default ?? module`;
// a default `apply` function would replace the namespace and drop `inject` / `Config` / `name`,
// and the row would fail at boot with "cannot get property \"tools\" without inject".
