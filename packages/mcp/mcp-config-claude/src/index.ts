/**
 * Reads a Claude-Code-shaped `mcpServers` map from disk and mounts one
 * `@deepseek-ai/dsh-mcp-client` child per row, so MCP servers already
 * registered for Claude Code — a local recall database, a browser driver, a
 * shop-ops backend, a chat relay, … — become harness tools under the same
 * `mcp__<serverName>__<tool>` names Claude Code and Codex use.
 *
 * Namespace plugin (named exports, no default export) — the same shape as
 * the `dsh-mcp-client` child it composes. One `mcpServers` row becomes one
 * child `ctx.plugin(mcpClient, ...)` fiber; a row this package cannot or
 * will not mount (an `sse` transport, an excluded name, a malformed row) is
 * skipped with a named reason and never reaches the child plugin. A row that
 * mounts but cannot connect (an unreachable stdio command, a dead endpoint)
 * is reported unavailable by the child itself — mounting never fails the
 * whole plugin unless `failOnStartupError` says otherwise.
 *
 * Every mounted server gains Gate-relevant power (a keychain, a send, a
 * spend) purely by being reachable — this package draws no policy line of
 * its own. Compose it only behind a Gate-class policy plugin mounted ahead
 * of it; see the README's "Gate posture" section.
 *
 * @module @deepseek-ai/dsh-mcp-config-claude
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { planMounts, readServerMap } from './config.ts'
import type { PlanMountsOptions } from './config.ts'
import type { McpConfigClaudeStatus, SkippedServer } from './types.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context, which
// every mounted dsh-mcp-client child requires.
import type {} from '@deepseek-ai/dsh-tools'

export type {
  ClaudeHttpServerConfig,
  ClaudeMcpServersMap,
  ClaudeServerConfig,
  ClaudeSseServerConfig,
  ClaudeStdioServerConfig,
  McpConfigClaudeStatus,
  MountPlan,
  PlannedMount,
  SkippedServer,
} from './types.ts'
export { planMounts, planOneRow, readServerMap } from './config.ts'
export type { PlanMountsOptions } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-config-claude'

/** Services required by this plugin; every mounted child needs the tool registry too. */
export const inject = ['tools']

/** Default per-tool-call timeout forwarded to every mounted child, mirroring `dsh-mcp-client`'s own default. */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Default connection-handshake deadline forwarded to every mounted child.
 * Rows mount concurrently (see `apply`), but each still needs its own bound:
 * without one, a hanging TCP connect (a captive portal, a blackholed
 * firewall) never settles `dsh-mcp-client`'s own `connection.ready`, and
 * that child plugin's `ctx.plugin(...)` await never resolves.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

/** Config as authored in `cordis.yml`, before Schemastery fills in defaults. */
export interface ConfigInput {
  /** Path to a Claude-Code-shaped config file (a `.claude.json` or `settings.json`) whose `mcpServers` key holds the map. */
  configPath: string
  /**
   * Only these server names are mounted; omit or pass `null` for "not
   * configured" (every row considered). An explicit empty array mounts
   * nothing — this plugin composes Gate-relevant tools, so the allowlist
   * fails closed rather than silently meaning "no filter".
   */
  include?: string[] | null
  /** These server names are never mounted, even when `include` allows them. */
  exclude?: string[]
  /** Per-tool-call timeout forwarded to every mounted child, in milliseconds. */
  toolCallTimeoutMs?: number
  /** Connection-handshake deadline forwarded to every mounted child, in milliseconds. */
  connectTimeoutMs?: number
  /** Reject this plugin's own activation when any row fails to mount, instead of logging and continuing. */
  failOnStartupError?: boolean
}

/** Config after Schemastery resolves defaults. */
export interface Config {
  readonly configPath: string
  readonly include: readonly string[] | null
  readonly exclude: readonly string[]
  readonly toolCallTimeoutMs: number
  readonly connectTimeoutMs: number
  readonly failOnStartupError: boolean
}

export const Config: z<ConfigInput, Config> = z.object({
  configPath: z.string().required(),
  include: z.union([z.const(null), z.array(String)]).default(null),
  exclude: z.array(String).default([]),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  connectTimeoutMs: z.number().step(1).min(1).default(DEFAULT_CONNECT_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
})

/** Live status per registration scope, published once `apply` finishes mounting. */
const liveStatus = new WeakMap<object, McpConfigClaudeStatus>()

/**
 * Read the most recent mount status for the caller's exact registration
 * scope. Undefined before `apply` has run in that scope. "Mounted" reports a
 * child plugin instance that loaded, not a live connection — a mounted
 * server can still be reconnecting or unavailable; ask
 * `mcpClient.isServerConnected(ctx, serverName)` for that.
 * @param ctx - Context in the scope that owns the plugin instance.
 */
export function getStatus(ctx: Context): McpConfigClaudeStatus | undefined {
  return liveStatus.get(scopeOf(ctx) ?? ctx.root)
}

/**
 * Read the configured `mcpServers` map, plan which rows to mount, and mount
 * one `dsh-mcp-client` child per planned row — concurrently. `ctx.plugin(...)`
 * for a stdio or http row blocks on that child's own connection handshake
 * (`dsh-mcp-client`'s `connection.ready`), which only ever times out when
 * `connectTimeoutMs` is set — mounting sequentially would let one hanging
 * row (a captive portal, a blackholed firewall) block every row after it,
 * and this plugin's own activation, indefinitely. A row's own config error
 * (an invalid `serverName`, a duplicate namespace) is caught and treated
 * exactly like an unreachable server unless `failOnStartupError` is set, in
 * which case this plugin's own activation rejects on the first row to fail,
 * in plan order.
 * @param ctx - Plugin context carrying the tool registry.
 * @param config - Resolved config path, filters, and per-child timeouts.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const serverMap = await readServerMap(config.configPath)
  const options: PlanMountsOptions = {
    exclude: config.exclude,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    connectTimeoutMs: config.connectTimeoutMs,
    ...(config.include === null ? {} : { include: config.include }),
  }
  const plan = planMounts(serverMap, options)

  for (const skip of plan.skipped) {
    ctx.logger.warn(`mcp-config-claude: skipping "${skip.serverName}" — ${skip.reason}`)
  }

  const results = await Promise.allSettled(
    plan.mounts.map(async planned =>
      ctx.plugin(mcpClient, { ...planned.config, failOnStartupError: config.failOnStartupError })),
  )

  const mounted: string[] = []
  const failed: SkippedServer[] = []
  let firstRejection: Error | undefined
  for (const [index, result] of results.entries()) {
    const planned = plan.mounts[index]
    if (planned === undefined) continue
    if (result.status === 'fulfilled') {
      mounted.push(planned.serverName)
      continue
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
    failed.push({ serverName: planned.serverName, reason })
    ctx.logger.error(`mcp-config-claude: failed to mount "${planned.serverName}": ${reason}`)
    firstRejection ??= result.reason instanceof Error ? result.reason : new Error(reason)
  }
  if (config.failOnStartupError && firstRejection !== undefined) throw firstRejection

  const owner = scopeOf(ctx) ?? ctx.root
  ctx.effect(() => {
    liveStatus.set(owner, { configPath: config.configPath, mounted, skipped: plan.skipped, failed })
    return () => void liveStatus.delete(owner)
  }, 'mcp-config-claude.status')
}
