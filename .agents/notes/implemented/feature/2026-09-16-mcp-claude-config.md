# Agent Note: Claude Code's mcpServers map becomes harness tools at $0

Status: implemented

English | [中文](2026-09-16-mcp-claude-config.zh.md)

## Problem

Every MCP server izzy already runs for Claude Code — a local recall database, a browser driver with a keychain, a shop-ops backend, a chat relay, a media generator, a design brain — lived only in `.claude.json`'s `mcpServers` map. The harness's own `dsh-mcp-client` mounts one server per hand-authored `cordis.yml` row, so reaching the same eleven servers from inside the harness meant retyping eleven rows and keeping them in sync by hand every time a server's command, URL, or headers changed on the Claude Code side. Nothing read the config that already existed.

## Decision

`@deepseek-ai/dsh-mcp-config-claude` reads a Claude-Code-shaped config file's `mcpServers` map once, at plugin activation, and mounts one `@deepseek-ai/dsh-mcp-client` child per row through `ctx.plugin(mcpClient, ...)` — the exact composition `packages/saturn/design-brain` already uses for its own single managed connection, generalized to an arbitrary map. The map key becomes the mounted child's `serverName`, so a row named `awake` registers tools as `mcp__awake__<tool>`, identical to what Claude Code itself would show.

The package is a pure decision layer over an existing capability, not a new one: it never talks MCP itself. `src/config.ts` holds the whole contract as two pure functions — `readServerMap` (the one file read) and `planMounts`/`planOneRow` (filtering by `include`/`exclude`, defensive shape validation since the file is untrusted deployment JSON, and translation into a `dsh-mcp-client` `Config`) — so the planning logic is unit-testable with no Cordis context and no live server. `src/index.ts` mounts the plan: `stdio` and `http` rows translate directly; an `sse` row is always skipped with a named reason, because `dsh-mcp-client` implements only `stdio` and `streamable-http`. A `${VAR_NAME}` reference inside an `env` or `header` string value expands from the process environment at mount time — an unset variable expands to the empty string, never to the literal placeholder — and an expanded value is never written to a log line by this package.

Mounting is deliberately decoupled from connecting. Every child mounts with `failOnStartupError: false` unless the plugin's own `failOnStartupError` config says otherwise, so an unreachable `stdio` command or a dead `http` endpoint is reported unavailable by `dsh-mcp-client` itself — logged, retried with its own backoff — and never aborts the rest of the mount plan. `getStatus(ctx)` publishes `{ configPath, mounted, skipped, failed }` for the caller's registration scope so a consumer can see the plan without re-deriving it.

## Alternatives considered

**Add OAuth and an `sse` transport to `dsh-mcp-client` first, so every Claude Code row could mount.** Rejected for this mandate: the real config this package targets has zero rows needing either (two `sse` rows are Cloudflare's remote MCP servers, skipped with a named reason; `github` and `sentry` are plain `http`). Building unverified capability against no current consumer is exactly the evidence-for-public-choices smell this repository's own package conventions warn against.

**Make this package itself a `Service` that owns live per-server state (an `awake`-style managed connection with `connect()`/`disconnect()`).** Rejected: every server here is meant to be always-on once configured, not toggled per-session by a settings UI the way `design-brain`'s single SaturnAI connection is. A function plugin that mounts once at activation matches the actual usage and keeps the package to the two-file shape (`config.ts` + `index.ts`) the mandate scoped it to.

**Skip the `include`/`exclude` empty-array subtlety and just check `!== undefined`.** This was the first implementation and it shipped broken: Schemastery resolves an omitted `z.array(...)` config field to `[]`, not `undefined`, so every row was silently treated as excluded until the composition tests caught it (`mcp__awake__add` never registered). The fix treats a present-but-empty `include` as "not configured," matching what an operator who never touched the field expects — documented in the README's Design philosophy so the next reader does not reintroduce it.

## Consequences

A deployment that wants izzy's own MCP servers reachable from the harness adds one `cordis.yml` row naming his `.claude.json` path, instead of eleven hand-mounted `dsh-mcp-client` rows that drift from the source of truth. Every mounted server gains Gate-relevant power purely by being reachable — a keychain, a send, a spend — and this package draws no policy line of its own; the README's Gate posture section says plainly that it must be composed only behind a Gate-class policy plugin, with the ordering enforced by the deployment's integrator, not by this package. Reported blockers, all deferred to the integrator per this mandate's scope fence: the `full-access-gated` permission preset row, the `mcp-config-claude` bundle row (disabled by default, enabled for izzy's own profile), and the `tsconfig.base.json`/`tsconfig.host.json` registration.

## Verification

`node_modules/.bin/vitest run packages/mcp/mcp-config-claude` is green (35 tests): unit coverage for `planOneRow`/`planMounts` (stdio/http/sse translation, `${VAR}` expansion including an unset variable, malformed rows, include/exclude/name-pattern filtering, no secret value in a skip reason) and `readServerMap` (a real temp file, missing `mcpServers`, invalid JSON, a non-object `mcpServers`, a missing file); a real-composition suite that boots a Cordis `Context` with the actual tool registry and reuses `dsh-mcp-client`'s own stdio fixture server read-only to prove a tool genuinely registers as `mcp__awake__add` and executes over real stdio, that an unreachable command still lets a real row mount beside it, that an `sse` row is skipped with a reason containing "sse", that `exclude` leaves a named row unmounted, that a `streamable-http` row mounts even when its endpoint is unreachable, that no captured log line ever contains a secret value expanded from `${VAR}`, and that `failOnStartupError: true` rejects this plugin's own activation when a row cannot connect. `node_modules/.bin/tsc -p packages/mcp/mcp-config-claude/tsconfig.json --noEmit` is clean.
