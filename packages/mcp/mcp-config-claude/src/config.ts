/**
 * Pure translation from a Claude-Code-shaped `mcpServers` map (already read
 * into memory as loosely typed JSON) to `dsh-mcp-client` child configs, plus
 * the one file read this package performs. No Cordis context is involved
 * here — the decision logic is unit-testable on its own; `src/index.ts`
 * mounts the plan's children.
 * @module
 */
import { readFile } from 'node:fs/promises'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { MountPlan, PlannedMount, SkippedServer } from './types.ts'

/**
 * Same pattern `dsh-mcp-client` enforces on `serverName`; checked here too,
 * so a bad name is a named skip, not a thrown plugin-load error.
 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Matches `${VAR_NAME}` placeholders in a config string. */
const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Options narrowing which rows of the map get mounted, and shared per-child settings. */
export interface PlanMountsOptions {
  /** Only these server names are considered; omit to consider every row. */
  readonly include?: readonly string[]
  /** These server names are never mounted, even when `include` allows them. */
  readonly exclude?: readonly string[]
  /** Per-tool-call timeout forwarded to every mounted child. */
  readonly toolCallTimeoutMs: number
  /** Connection-handshake deadline forwarded to every mounted child, when set. */
  readonly connectTimeoutMs?: number
}

/**
 * Expand `${VAR}` references in a string against the process environment.
 * An unset variable expands to the empty string, never to the literal
 * placeholder — a placeholder must never reach a spawned command or header
 * unresolved, and the expanded value itself is never logged by this package.
 * @param value - Raw string, possibly containing `${VAR}` placeholders.
 */
function expandEnvRefs(value: string): string {
  return value.replace(ENV_REF_PATTERN, (_match, varName: string) => process.env[varName] ?? '')
}

/**
 * Expand `${VAR}` references in every value of a string map; keys are
 * untouched. Non-string entries are dropped by the caller's shape check
 * before this runs.
 */
function expandMap(map: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (map === undefined) return result
  for (const [key, value] of Object.entries(map)) result[key] = expandEnvRefs(value)
  return result
}

/** Narrow an unknown JSON value to a `string[]`, or `undefined` if it is not one. */
function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined
  return value
}

/** Narrow an unknown JSON value to a `Record<string, string>`, or `undefined` if it is not one. */
function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.every(([, entryValue]) => typeof entryValue === 'string')) return undefined
  return value as Record<string, string>
}

/**
 * Decide whether one server row from a Claude-Code-shaped `mcpServers` map
 * should be mounted, and translate it into a `dsh-mcp-client` child config.
 * Never throws: a row this package cannot make sense of is a named skip.
 * @param serverName - The map key; becomes the mounted child's `serverName`
 *   and therefore the `mcp__<serverName>__<tool>` namespace.
 * @param row - The row exactly as parsed from the config file's JSON — not
 *   yet trusted to match any particular shape.
 * @param options - Include/exclude filtering and per-child timeouts.
 * @returns A planned mount, or a skip reason — never both.
 */
export function planOneRow(
  serverName: string,
  row: unknown,
  options: PlanMountsOptions,
): { mount: PlannedMount } | { skip: SkippedServer } {
  // `include` is `undefined` only when the config field itself is `null`
  // (Schemastery's "not configured" sentinel — see index.ts's Config
  // schema). Any actual array, including an explicitly empty one, narrows
  // the mounted set — an empty allowlist fails closed and mounts nothing,
  // since this plugin composes Gate-relevant tools.
  if (options.include !== undefined && !options.include.includes(serverName)) {
    return { skip: { serverName, reason: 'not in the configured include list' } }
  }
  if (options.exclude?.includes(serverName) === true) {
    return { skip: { serverName, reason: 'excluded by configuration' } }
  }
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    return {
      skip: {
        serverName,
        reason: `server name does not match ${SERVER_NAME_PATTERN.source} — rename the mcpServers key to mount it`,
      },
    }
  }
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return { skip: { serverName, reason: 'row is not a JSON object' } }
  }

  const fields = row as Record<string, unknown>
  // Claude Code's own `.mcp.json` shape treats `type` as optional and
  // defaults an untyped row with a `command` to stdio — mirror that so a
  // canonical `{ "command": "node", "args": [...] }` row isn't dropped.
  const rawType = fields.type
  const type = typeof rawType === 'string'
    ? rawType
    : (typeof fields.command === 'string' && fields.command.length > 0 ? 'stdio' : rawType)

  if (type === 'sse') {
    return {
      skip: {
        serverName,
        reason: '"sse" transport is not supported by @deepseek-ai/dsh-mcp-client (only "stdio" and "http" are)',
      },
    }
  }

  const timeouts = options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }

  if (type === 'stdio') {
    const command = fields.command
    if (typeof command !== 'string' || command.length === 0) {
      return { skip: { serverName, reason: 'malformed "stdio" row: "command" must be a non-empty string' } }
    }
    const args = asStringArray(fields.args)
    if (fields.args !== undefined && args === undefined) {
      return { skip: { serverName, reason: 'malformed "stdio" row: "args" must be an array of strings' } }
    }
    const env = asStringRecord(fields.env)
    if (fields.env !== undefined && env === undefined) {
      return { skip: { serverName, reason: 'malformed "stdio" row: "env" must be an object of string values' } }
    }
    const cwd = fields.cwd
    if (cwd !== undefined && typeof cwd !== 'string') {
      return { skip: { serverName, reason: 'malformed "stdio" row: "cwd" must be a string' } }
    }
    const config: McpClientConfig = {
      transport: 'stdio',
      serverName,
      command,
      args: args ?? [],
      env: expandMap(env),
      cwd: cwd ?? '',
      toolCallTimeoutMs: options.toolCallTimeoutMs,
      failOnStartupError: false,
      ...timeouts,
    }
    return { mount: { serverName, config } }
  }

  if (type === 'http') {
    const url = fields.url
    if (typeof url !== 'string' || url.length === 0) {
      return { skip: { serverName, reason: 'malformed "http" row: "url" must be a non-empty string' } }
    }
    const headers = asStringRecord(fields.headers)
    if (fields.headers !== undefined && headers === undefined) {
      return { skip: { serverName, reason: 'malformed "http" row: "headers" must be an object of string values' } }
    }
    const config: McpClientConfig = {
      transport: 'streamable-http',
      serverName,
      url,
      headers: expandMap(headers),
      toolCallTimeoutMs: options.toolCallTimeoutMs,
      failOnStartupError: false,
      ...timeouts,
    }
    return { mount: { serverName, config } }
  }

  const label = typeof type === 'string' ? `"${type}"` : type === undefined ? '(missing)' : typeof type
  return { skip: { serverName, reason: `unrecognized transport ${label} — expected "stdio", "http", or "sse"` } }
}

/**
 * Plan mounts for every row of a `mcpServers` map.
 * @param serverMap - The full map, keyed by server name, as parsed JSON.
 * @param options - Include/exclude filtering and per-child timeouts.
 * @returns Every row sorted into either `mounts` or `skipped`, in map order.
 */
export function planMounts(serverMap: Record<string, unknown>, options: PlanMountsOptions): MountPlan {
  const mounts: PlannedMount[] = []
  const skipped: SkippedServer[] = []
  for (const [serverName, row] of Object.entries(serverMap)) {
    const decision = planOneRow(serverName, row, options)
    if ('mount' in decision) mounts.push(decision.mount)
    else skipped.push(decision.skip)
  }
  return { mounts, skipped }
}

/**
 * Read a Claude-Code-shaped config file and return its `mcpServers` map as
 * loosely typed JSON, ready for {@link planMounts}. A missing `mcpServers`
 * field returns an empty map; anything else wrong with the file — it does
 * not exist, is not valid JSON, or `mcpServers` is not an object — throws,
 * since that is a deployment misconfiguration distinct from any one server
 * being unreachable.
 * @param configPath - Path to a `.claude.json` or `settings.json`-shaped file.
 */
export async function readServerMap(configPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`mcp-config-claude: ${configPath} is not valid JSON`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`mcp-config-claude: ${configPath} does not contain a JSON object`)
  }
  const servers = (parsed as Record<string, unknown>).mcpServers
  if (servers === undefined) return {}
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    throw new Error(`mcp-config-claude: ${configPath}'s "mcpServers" field is not an object`)
  }
  return servers as Record<string, unknown>
}
