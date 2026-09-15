---
description: "Optional SaturnAI design tools with durable opt-in, verified tool availability, and Host-owned connection management."
kind: "package-reference"
---

# @saturnai/dsh-design-brain

English | [中文](README.zh.md)

## Summary

Connect SaturnAI design guidance and evidence-based review tools to the agents in a web or desktop profile. Users opt in during First Light or from Settings → Models, then retain that choice across restarts. Fresh profiles make no connection request. The bundled premium output guides remain available without this service; tool calls send the selected brief and evidence to the configured external endpoint.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The shipped web bundle mounts the connector with the Host settings, tool registry, system prompt, and Loader services. Settings → Models provides Connect tools, Refresh status, and Disconnect. A saved opt-in reconnects at Host startup; disconnect closes the managed transport and unregisters its tools. Direct edits to the `saturn-design-brain.enabled` settings namespace apply after restart; the connection controls persist and apply their changes immediately.

A same-scope MCP profile row named `saturnai` owns its own connection. The connector reuses it without mounting another server or changing that row, including when it is disabled. The UI directs users to the profile configuration instead of offering an ineffective disconnect. Rows in other agent scopes do not suppress the global managed connection.

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://saturnai.tools/api/mcp` | Host-controlled Streamable HTTP URL; HTTP(S), without credentials, query, or fragment |
| `connectTimeoutMs` | `15000` | Deadline for handshake, initialized notification, and initial tool registration |
| `toolCallTimeoutMs` | `120000` | Deadline for each subsequent MCP tool invocation |
| `headers` | `{}` | Optional deployment credentials; never returned in connection status |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host owns one serialized connection lifecycle. Success requires the production MCP supervisor to report a connected generation and the same tool registry to contain `mcp__saturnai__compose` and `mcp__saturnai__review`. Partial catalogs, transport failures, disabled profile rows, and timeouts remain unavailable. A refreshed status is a current lifecycle observation, not a promise that a future remote call succeeds. The browser mounts the generated Remote contribution and never uses a separate fetch probe as proof of agent access.

The connector supplies its timeout to the MCP supervisor, which closes the actual transport before waiting for quiescence. This bounds requests stalled during initialization or initial tool discovery. Owner disposal cancels resources and prevents late state reads from torn-down services. The persistent choice is stored through the existing settings provider; no credentials or conversation contents are copied into the preference.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../../mcp/mcp-client/README.md) — transport lifecycle and tool semantics.
- [Premium output guides](../../skill/skill-premium-output/README.md) — bundled workflows available without an external connection.
- [Models settings](../../client/ui-settings-models/README.md) — provider and connection controls.

<a id="model-experience"></a>
## Model Experience

### Optional design context

#### What the model sees

When SaturnAI is connected and its tools are visible in the requesting scope, the `saturn:design-brain` section directs the model to use their schemas for relevant work, reuse existing context for focused edits, inspect actual rendered output, and report failures honestly. Tool definitions and results follow the MCP client's ordinary registration and execution path. The service reviews supplied evidence; it does not independently inspect a rendered website.

#### Token effect

The connected section adds one fixed paragraph. Available MCP schemas and explicitly requested tool results add their normal context cost. Disabled connections add no design-brain text or tools.

#### KV Cache effect

The section is stable while connection state and tool visibility stay the same. Connecting, disconnecting, or losing availability can change the assembled prompt and tool set. Ordinary request/header and tool-result records remain the evidence of what the model received.

## Known Limitations and Deferred Work

- The connector provides guidance and tool access, not guaranteed visual quality or model compliance.
- Existing profile rows remain deployment-owned. Failed profile connections must be corrected or restarted through that configuration.
- The endpoint is Host-controlled. Browser users cannot supply arbitrary URLs or read deployment headers through this API.
- External reviews use caller-supplied evidence. The harness does not silently capture or upload project files, screenshots, or conversation history when connecting.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-host-owned-design-brain.md) explains ownership and the bounded transport deadline.

</details>
