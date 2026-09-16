---
description: "Reads a Claude-Code-shaped mcpServers map and mounts one dsh-mcp-client child per row, for deployments and maintainers who want izzy's own MCP servers (awake recall, saturn-browser, saturn-gx, shop-ops, telegram-hive, gemini-media, saturndesign, …) reachable inside the harness at $0."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-config-claude

English | [中文](README.zh.md)

## Summary

`dsh-mcp-config-claude` reads a Claude-Code-shaped config file — the same `mcpServers` map `.claude.json` or `settings.json` already carries — and mounts one `@deepseek-ai/dsh-mcp-client` child per row, so every server already registered for Claude Code becomes a harness tool under the identical `mcp__<serverName>__<tool>` name. Add it when a deployment's MCP servers are already described in a Claude Code config and re-authoring them as `cordis.yml` rows would just be a lossy copy. It performs no discovery of its own: `stdio` rows spawn a child process, `http` rows dial Streamable HTTP, and an `sse` row — a transport `dsh-mcp-client` does not implement — is skipped with a named reason rather than attempted. The cost model is `dsh-mcp-client`'s own, multiplied by however many rows mount: tool-definition tokens per mounted server, plus whatever startup delay or reconnect churn an unreachable or slow server introduces.

## Table of Contents

- [Use this package](#use-this-package)
- [Gate posture](#gate-posture)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add `dsh-mcp-config-claude` when a Claude-Code-shaped config file already lists the MCP servers a deployment wants, and mounting each one by hand as a separate `dsh-mcp-client` row in `cordis.yml` would duplicate that list. One entry configures the whole file.

### Minimal configuration

```yaml
- id: mcp-config-claude
  name: '@deepseek-ai/dsh-mcp-config-claude'
  config:
    configPath: 'C:\Users\izzy\.claude.json'
```

| Field | Default | Meaning |
|---|---|---|
| `configPath` | required | Path to a `.claude.json` or `settings.json`-shaped file whose top-level `mcpServers` key holds the map (a per-project `mcpServers` map, e.g. `.claude.json`'s `projects["<path>"].mcpServers`, is not read — see Known Limitations) |
| `include` | omitted (every row) | Only these server names (map keys) are considered; omit or pass `null` for "not configured" (every row). An **explicit empty array mounts nothing** — this plugin composes Gate-relevant tools, so the allowlist fails closed rather than meaning "no filter" |
| `exclude` | `[]` | These server names are never mounted, even when `include` allows them |
| `toolCallTimeoutMs` | `60000` | Forwarded to every mounted child as its per-tool-call timeout |
| `connectTimeoutMs` | `30000` | Forwarded to every mounted child as its connection-handshake deadline. Every row needs a bound: rows mount concurrently, and one row whose connect hangs (a captive portal, a blackholed firewall) would otherwise never settle its own child plugin's activation |
| `failOnStartupError` | `false` | Reject this plugin's own activation when any row fails to mount, instead of logging the failure and continuing |

### Row shapes read from the config file

Each `mcpServers` entry is read by its `type` field, exactly as Claude Code writes it:

```json
{
  "mcpServers": {
    "awake": { "type": "stdio", "command": "node", "args": ["awake-server.mjs"] },
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp" },
    "cloudflare-bindings": { "type": "sse", "url": "https://bindings.mcp.cloudflare.com/sse" }
  }
}
```

- `"stdio"` mounts a `dsh-mcp-client` `StdioConfig` — `command`, `args`, `env`, and `cwd` translate directly, with `args` and `env` defaulting to `[]` and `{}` when absent.
- `"http"` mounts a `dsh-mcp-client` `StreamableHttpConfig` — `url` and `headers` translate directly, with `headers` defaulting to `{}` when absent.
- A row with **no `type` field at all** but a non-empty `command` is treated as `"stdio"` — the shape Claude Code's own `.mcp.json` documentation allows, where `type` is optional and defaults to stdio. Any other untyped row (no `command`), any `"sse"` row (`dsh-mcp-client` implements only `stdio` and `streamable-http`), any other unrecognized `type`, and any row that is not a JSON object are all skipped with a named reason.
- The map key becomes the mounted child's `serverName`, so `awake` above registers tools as `mcp__awake__<tool>` — the same name Claude Code and Codex would use for the identical server.

An `env` or `headers` string value containing `${VAR_NAME}` expands from the current process environment at mount time; an unset variable expands to the empty string, never to the literal placeholder. Expanded values are never written to a log line by this package.

### What "mounted" means, and what it does not

A row that passes filtering and shape validation is handed to `ctx.plugin(dsh-mcp-client, ...)` with `failOnStartupError: false` by default. That call resolving means the child plugin instance loaded — it does **not** mean the server answered. An unreachable `stdio` command or a dead `http` endpoint is reported unavailable by `dsh-mcp-client` itself (see its README), which logs the failure and, by default, keeps retrying with backoff; this package never treats that as fatal to the rest of the mount plan. Setting `failOnStartupError: true` changes that: it is forwarded to every mounted child, and the first row whose child rejects also rejects this plugin's own activation, stopping the remaining rows from being attempted.

Call `getStatus(ctx)` (exported from this package) to read the most recent plan for the caller's registration scope: `{ configPath, mounted, skipped, failed }`. `mounted` lists server names whose child plugin loaded; `skipped` lists rows this package declined to mount and why (an `sse` transport, an excluded name, a malformed row); `failed` lists rows whose child plugin instance itself could not load (a schema error, a duplicate namespace) — rare, and only non-empty without `failOnStartupError` since a set failure there aborts activation instead. Ask `mcpClient.isServerConnected(ctx, serverName)` (from `@deepseek-ai/dsh-mcp-client`) for live connection state.

<a id="gate-posture"></a>
## Gate posture

Every server this package mounts becomes a harness tool with whatever power that server's own tools carry — a keychain, a send, a spend, a database write. This package makes no policy decision about any of that; it only decides which configured rows get a chance to register tools. Compose it **only** with a Gate-class policy plugin (for example `@saturnai/dsh-gates`) mounted ahead of it in the plugin list, and let the deployment's integrator enforce that order. Mounting this package without a Gate-class policy ahead of it hands the model direct, unmediated access to every credential-bearing or spend-bearing tool the configured servers expose.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Namespace plugin (named exports `name` / `inject` / `Config` / `apply`, no default export) — the same shape as the `dsh-mcp-client` child it composes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, reads the file, mounts one child per planned row, publishes `getStatus` |
| [`src/config.ts`](src/config.ts) | Pure planning: `readServerMap` (the one file read), `planOneRow` / `planMounts` (filtering, shape validation, `${VAR}` expansion, translation to `dsh-mcp-client` `Config`) |
| [`src/types.ts`](src/types.ts) | Types only: the Claude-Code-shaped row and map shapes, the plan and status shapes |

### Design philosophy

- **One file read, then pure decisions.** `readServerMap` is the only I/O `src/config.ts` performs; `planOneRow` and `planMounts` take already-parsed JSON and return a plan, so the filtering and translation logic is unit-testable without a Cordis context or a live server.
- **A row is never trusted to match a shape.** The config file is deployment-owned JSON, not a Schemastery-validated value, so every field is narrowed defensively at the boundary; a row this package cannot make sense of is a named skip, never a thrown error.
- **Mounting delegates everything model-facing.** This package registers no tool, prompt section, or result-rendering logic of its own — every mounted server's tools, descriptions, and results are exactly what `dsh-mcp-client` would present for a hand-authored row with the same config.
- **An empty include list is "not configured."** Schemastery resolves an omitted `z.array(...)` field to `[]`, not `undefined`; treating a present-but-empty `include` as "no filter" (rather than "exclude everything") matches what an operator who never touched the field expects.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Mounted MCP tools (delegated to dsh-mcp-client)

#### What the model sees

Every tool of every mounted server, rendered exactly as `dsh-mcp-client`'s own README documents: a native tool named `mcp__<serverName>__<rawName>` (or its normalized form) with the server-provided description and input schema. This package contributes no prompt text, tool schema, or result projection of its own — it only decides, once per plugin activation, which configured rows are handed to a mounted `dsh-mcp-client` child and under what `serverName`.

#### Token effect

Indirect and fully delegated: each mounted server's token effect is `dsh-mcp-client`'s own (tool descriptions and schemas enter every request while registered). A row this package skips — an `sse` transport, an excluded name, malformed JSON — contributes no tokens at all, because no child ever mounts for it.

#### KV Cache effect

Indirect and fully delegated: identical to `dsh-mcp-client`'s own KV Cache effect once a server is mounted. This package makes no cache-affecting decision after mount; its own file read and planning happen once, at plugin activation, before any model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe what you cannot do with this plugin and when it needs operational attention. They are current package constraints, not a comparison with other config importers or a task backlog.

- **No OAuth** — a row that needs an OAuth flow to reach its server (rather than a static header) mounts as an `http` row with whatever `headers` the config file supplies, and fails to authenticate at connect time; there is no flow this package can drive on the model's or operator's behalf.
- **No `sse` transport** — `dsh-mcp-client` implements only `stdio` and `streamable-http`; every `sse` row is skipped with a named reason, never attempted. Migrating a server off `sse` is outside this package's scope.
- **No org-managed server list** — this package reads exactly one local file; a deployment that wants a centrally managed roster needs its own distribution mechanism for that file, or a different config source entirely.
- **Top-level `mcpServers` only — no per-project rows** — `.claude.json` can also carry a `projects["<path>"].mcpServers` map scoped to one project directory (Claude Code's own per-project server list); this package reads only the file's top-level `mcpServers` key and never looks inside `projects`. A server configured only at project scope needs its own row copied to the top level (or a dedicated `configPath` pointed at a file shaped that way) to be mounted here.
- **No live reload of the config file** — the file is read once, at plugin activation; editing it afterward has no effect until the plugin (or the Host) reloads.
- **No secret redaction inside a malformed row's own error text** — this package never interpolates a raw `env` or `header` value into a log line or skip reason itself, but an upstream error thrown by a dependency this package calls (rare, and only for a structurally invalid config value) is logged verbatim; see the composition tests for the boundary this package does control.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Note.

- Row validation is defensive but not exhaustive: a `stdio` row's `command` could still point at something that is not an MCP server at all, which surfaces the same way as any other unreachable server (logged, retried, never fatal by default) rather than as a distinct diagnosis.
- Whether `include`/`exclude` should also accept a glob or regex, rather than exact server names, is open; the real config this package was built against never needed one.
- A future `getStatus` consumer that wants a UI row per configured server (mounted / skipped / failed, with a reason) can read the shape as published; nothing here renders one yet.

</details>
