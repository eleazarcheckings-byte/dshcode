/**
 * Types only — no runtime code. Describes the Claude-Code-shaped `mcpServers`
 * map this package reads, and the plan and status shapes it derives from it.
 * @module
 */

/** One `stdio` row exactly as Claude Code's `mcpServers` map shapes it. */
export interface ClaudeStdioServerConfig {
  readonly type: 'stdio'
  /** Executable used to start the server. */
  readonly command: string
  /** Arguments passed directly, without shell interpolation. */
  readonly args?: readonly string[]
  /** Extra env vars; a `${VAR}` value expands from the process environment. */
  readonly env?: Readonly<Record<string, string>>
  /** Working directory for the spawned process. */
  readonly cwd?: string
}

/** One `http` (Streamable HTTP) row exactly as Claude Code's `mcpServers` map shapes it. */
export interface ClaudeHttpServerConfig {
  readonly type: 'http'
  /** MCP endpoint URL. */
  readonly url: string
  /** Extra request headers; a `${VAR}` value expands from the process environment. */
  readonly headers?: Readonly<Record<string, string>>
}

/** One `sse` row exactly as Claude Code's `mcpServers` map shapes it — unsupported, always skipped. */
export interface ClaudeSseServerConfig {
  readonly type: 'sse'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

/** One server row, in any transport shape Claude Code's config format allows. */
export type ClaudeServerConfig = ClaudeStdioServerConfig | ClaudeHttpServerConfig | ClaudeSseServerConfig

/** The `mcpServers` map read from a Claude-Code-shaped config file: server name → row. */
export type ClaudeMcpServersMap = Readonly<Record<string, ClaudeServerConfig>>

/** One server row this package declined to mount, and why. */
export interface SkippedServer {
  readonly serverName: string
  readonly reason: string
}

/** One server row resolved into a `dsh-mcp-client` child config, ready to mount. */
export interface PlannedMount {
  readonly serverName: string
  /** A `dsh-mcp-client` `Config` value (`StdioConfig | StreamableHttpConfig`). */
  readonly config: import('@deepseek-ai/dsh-mcp-client').Config
}

/** The result of filtering and translating one `mcpServers` map. */
export interface MountPlan {
  readonly mounts: readonly PlannedMount[]
  readonly skipped: readonly SkippedServer[]
}

/** Live status for one registration scope, published after `apply` mounts its children. */
export interface McpConfigClaudeStatus {
  /** The config file this status was derived from. */
  readonly configPath: string
  /** Server names whose child plugin mounted (mounting, not a live connection — see README). */
  readonly mounted: readonly string[]
  /** Rows this package declined to mount, with reasons. */
  readonly skipped: readonly SkippedServer[]
  /** Rows whose child plugin instance itself failed to load (rare — a config or namespace conflict). */
  readonly failed: readonly SkippedServer[]
}
