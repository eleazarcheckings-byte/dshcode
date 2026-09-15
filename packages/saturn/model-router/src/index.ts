/**
 * Deployment-wide model tiering: one settings namespace resolving four named
 * tiers (`coordinator`, `specialist`, `bulk`, `vision`) to a provider, model,
 * and optional reasoning effort, plus the toggle that mounts the native
 * Claude Code / Codex subagent providers.
 *
 * `resolve()` is what a subagent spawn or SaturnBot asks for a route instead
 * of hard-coding one: a tier left at `'default'` follows whatever
 * `agent-default-model` currently holds, so raising the deployment default
 * raises every tier that has not been overridden. The external-harnesses
 * toggle stays off on a fresh install (SPEC §3 C6, out-of-scope item
 * "turning `isolation: worktree` on by default" has the same shape of
 * reasoning for the neighboring worktree feature: opt-in, never a silent
 * default flip) and each Bundle it gates still self-hides when its
 * package-local platform CLI package is not installed, so enabling the
 * toggle alone never turns a missing optional dependency into a load error.
 *
 * @module @saturnai/dsh-model-router
 */

import { createRequire } from 'node:module'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type {
  Config,
  ExternalHarness,
  ModelRouterSettings,
  ModelTier,
  TierRoute,
  TierSetting,
} from './types.ts'

export {
  EXTERNAL_HARNESSES,
  MODEL_TIERS,
} from './types.ts'
export type {
  Config,
  ExternalHarness,
  ModelRouterSettings,
  ModelTier,
  TierRoute,
  TierSetting,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment-wide tier routing and the external-harnesses toggle. */
    modelRouter: ModelRouterService
  }
}

/** The registered settings namespace; the Plugins section renders it as one card. */
export const MODEL_ROUTER_SETTINGS_NAMESPACE = 'saturn-model-router'

const DEFAULT_TIER_SETTINGS: Record<ModelTier, TierSetting> = {
  coordinator: 'default',
  specialist: 'default',
  bulk: 'default',
  vision: 'default',
}

const TierRouteSchema: z<TierRoute> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

const TierSettingSchema: z<TierSetting> = z.union([
  z.const('default' as const).required(),
  TierRouteSchema,
]).default('default')

const TiersSchema: z<Record<ModelTier, TierSetting>> = z.object({
  coordinator: TierSettingSchema,
  specialist: TierSettingSchema,
  bulk: TierSettingSchema,
  vision: TierSettingSchema,
}).default(DEFAULT_TIER_SETTINGS)

/** Schema for the `saturn-model-router` settings namespace. */
export const ModelRouterSettingsSchema: z<ModelRouterSettings> = z.object({
  tiers: TiersSchema,
  externalHarnesses: z.boolean().default(false),
})

/** Fallback route used only when neither a tier override nor `agentDefaultModel` is available. */
const FALLBACK_ROUTE: TierRoute = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

/** The npm package each external harness's Host row mounts. */
const HARNESS_PACKAGE: Record<ExternalHarness, string> = {
  codex: '@deepseek-ai/dsh-subagent-codex',
  'claude-code': '@deepseek-ai/dsh-subagent-claude-code',
}

/**
 * The actual platform CLI dependency bundled INSIDE each harness's wrapper
 * package — this, not the wrapper's own resolvability, is the "CLI is
 * absent" check. `dsh-subagent-codex` depends on `@openai/codex`;
 * `dsh-subagent-claude-code` depends on `@anthropic-ai/claude-agent-sdk`.
 * Probing only the wrapper is a false positive whenever the wrapper is
 * declared (a devDependency of a consumer, say) but its own CLI dependency
 * failed to install or was pruned from a production install.
 */
const HARNESS_CLI_PACKAGE: Record<ExternalHarness, string> = {
  codex: '@openai/codex',
  'claude-code': '@anthropic-ai/claude-agent-sdk',
}

const requireFromHere = createRequire(import.meta.url)

/**
 * Whether `specifier` resolves from `resolver`'s own module graph, without
 * importing it. A harness Bundle is optional: it may never have been
 * installed, so resolution failure is the expected "not present" case, not a
 * defect to log.
 * @param resolver - a `createRequire`-produced resolver anchored at the caller's module.
 * @param specifier - the package specifier to probe.
 * @returns true when `require.resolve` would succeed.
 */
export function packageResolvable(resolver: NodeJS.Require, specifier: string): boolean {
  try {
    resolver.resolve(specifier)
    return true
  } catch {
    return false
  }
}

/**
 * Whether `harness`'s real platform CLI dependency resolves — anchored not
 * at this package, but at the harness's OWN wrapper package, so a wrapper
 * that happens to resolve can never report "available" when the CLI
 * dependency bundled inside it failed to install. Two stages: first locate
 * the wrapper's own manifest from `resolver`'s module graph, then resolve
 * `cliPackage` from a `require` anchored at that manifest.
 *
 * The second stage tries `cliPackage` as a bare specifier AND as its
 * `/package.json` subpath, because the two shipped CLI dependencies need
 * opposite forms and there is no single "the" resolution order that covers
 * both: `@openai/codex` has no `main`/`exports` field (only `bin`), so the
 * bare specifier throws `MODULE_NOT_FOUND` and only `/package.json`
 * resolves; `@anthropic-ai/claude-agent-sdk` declares an `exports` map with
 * a `.` entry but no `./package.json` entry, so `/package.json` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` and only the bare specifier resolves.
 * Trying both forms answers the question this function actually asks — is
 * the CLI dependency present in the wrapper's module graph — without
 * hard-coding a specifier shape per harness (Mars r2 F1-r2, confirmed
 * against the real installed manifests in
 * `packages/subagent/subagent-codex` and `packages/subagent/subagent-claude-code`).
 * @param resolver - a `createRequire`-produced resolver anchored at the caller's module; locates the wrapper.
 * @param subagentPackage - the wrapper package's specifier (e.g. `@deepseek-ai/dsh-subagent-codex`).
 * @param cliPackage - the platform CLI specifier the wrapper actually depends on (e.g. `@openai/codex`).
 * @param createRequireFn - overridable in tests; real mounts always use `node:module`'s `createRequire`.
 * @returns true only when both the wrapper and its CLI dependency resolve.
 */
export function harnessCliResolvable(
  resolver: NodeJS.Require,
  subagentPackage: string,
  cliPackage: string,
  createRequireFn: (path: string) => NodeJS.Require = createRequire,
): boolean {
  let subagentManifest: string
  try {
    subagentManifest = resolver.resolve(`${subagentPackage}/package.json`)
  } catch {
    return false
  }
  const cliResolver = createRequireFn(subagentManifest)
  return packageResolvable(cliResolver, cliPackage) || packageResolvable(cliResolver, `${cliPackage}/package.json`)
}

/**
 * Owns the `saturn-model-router` settings namespace and answers tier and
 * external-harness questions for subagent spawns, SaturnBot, and the Bundle
 * rows that mount native product providers.
 */
export class ModelRouterService extends Service {
  static inject = ['settings']

  static Config: z<Config> = z.object({})

  private readonly scope: SettingsScope<ModelRouterSettings>
  private readonly harnessAvailability = new Map<ExternalHarness, boolean>()
  private readonly resolver: NodeJS.Require
  private readonly createRequireFn: (path: string) => NodeJS.Require

  /**
   * @param ctx - Host context carrying the settings service.
   * @param _config - composition entry; every field currently resolves through settings.
   * @param resolver - `require.resolve`-shaped probe locating each harness's wrapper package,
   *   overridable in tests; real mounts always use the module-anchored default.
   * @param createRequireFn - produces the second-stage resolver anchored at a wrapper's own
   *   manifest, overridable in tests; real mounts always use `node:module`'s `createRequire`.
   */
  constructor(
    ctx: Context,
    _config: Config,
    resolver: NodeJS.Require = requireFromHere,
    createRequireFn: (path: string) => NodeJS.Require = createRequire,
  ) {
    super(ctx, 'modelRouter')
    this.resolver = resolver
    this.createRequireFn = createRequireFn
    this.scope = ctx.settings.register(MODEL_ROUTER_SETTINGS_NAMESPACE, ModelRouterSettingsSchema, {
      applies: 'live',
    })
  }

  /**
   * Resolve one tier to a concrete route. A tier left at `'default'` follows
   * `agentDefaultModel` when a Host mounts one, then the packaged fallback.
   * @param tier - the routing tier a caller is spawning or dispatching work for.
   * @returns the provider, model, and optional reasoning effort to use.
   */
  resolve(tier: ModelTier): TierRoute {
    const setting = this.scope.get().tiers[tier]
    if (setting !== 'default') return setting
    const fallback = this.ctx.get('agentDefaultModel')
    if (fallback === undefined) return FALLBACK_ROUTE
    const selection = fallback.currentSelection()
    return {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) },
    }
  }

  /** Whether the deployment has opted into native product subagent providers. */
  externalHarnessesEnabled(): boolean {
    return this.scope.get().externalHarnesses
  }

  /**
   * Whether `harness`'s package-local platform CLI is installed. Cached per
   * process: package presence does not change while a process is running.
   * @param harness - the native product subagent to probe.
   * @returns true only when both the harness's wrapper package AND the
   *   actual CLI dependency bundled inside it resolve.
   */
  harnessAvailable(harness: ExternalHarness): boolean {
    const cached = this.harnessAvailability.get(harness)
    if (cached !== undefined) return cached
    const resolvable = harnessCliResolvable(
      this.resolver,
      HARNESS_PACKAGE[harness],
      HARNESS_CLI_PACKAGE[harness],
      this.createRequireFn,
    )
    this.harnessAvailability.set(harness, resolvable)
    return resolvable
  }

  /**
   * Whether a host-plane row for `harness` should mount: the deployment opted
   * in AND the harness's package-local CLI is actually installed. This is the
   * single check a Bundle row's `disabled` expression and a preset's tool row
   * both gate on, so enabling the toggle alone can never surface a tool with
   * nothing behind it.
   * @param harness - the native product subagent a row is gating.
   */
  externalHarnessMounted(harness: ExternalHarness): boolean {
    return this.externalHarnessesEnabled() && this.harnessAvailable(harness)
  }
}

export default ModelRouterService
