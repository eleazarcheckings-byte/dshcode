/**
 * Types-only surface for `@saturnai/dsh-model-router`, kept free of runtime
 * imports so a consumer can name these shapes without pulling in the service.
 *
 * @module @saturnai/dsh-model-router/types
 */

/** The four deployment-wide routing tiers a caller resolves a model for. */
export type ModelTier = 'coordinator' | 'specialist' | 'bulk' | 'vision'

/** Every routing tier, in the order the settings form renders them. */
export const MODEL_TIERS: readonly ModelTier[] = ['coordinator', 'specialist', 'bulk', 'vision']

/** A native product subagent this router can mount behind the external-harnesses toggle. */
export type ExternalHarness = 'codex' | 'claude-code'

/** Every external harness this router knows how to gate, in settings-card order. */
export const EXTERNAL_HARNESSES: readonly ExternalHarness[] = ['codex', 'claude-code']

/** An explicit provider/model override for one tier. */
export interface TierRoute {
  /** Registered provider route (an `llm-pi-ai` route, `deepseek-official`, or another mounted adapter). */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort; omitted keeps the provider's own default. */
  reasoningEffort?: string
}

/** One tier's setting: an explicit route, or `'default'` to follow the agent default model. */
export type TierSetting = TierRoute | 'default'

/** The resolved `saturn-model-router` settings namespace value. */
export interface ModelRouterSettings {
  /** Per-tier routing; every tier starts at `'default'`. */
  tiers: Record<ModelTier, TierSetting>
  /**
   * Mounts the native Claude Code / Codex subagent providers on the Host
   * plane and exposes their preset delegation tools, when each provider's
   * package-local platform CLI is also installed. Off on a fresh install.
   */
  externalHarnesses: boolean
}

/** Composition entry for `@saturnai/dsh-model-router`; the package takes no composition fields today. */
export type Config = object
