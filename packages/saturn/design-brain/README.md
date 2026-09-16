---
description: "Optional SaturnAI design tools with durable opt-in, verified tool availability, and Host-owned connection management."
kind: "package-reference"
---

# @saturnai/dsh-design-brain

English | [中文](README.zh.md)

## Summary

Connect SaturnAI design guidance and evidence-based review tools to the agents in a web or desktop profile. Users opt in during First Light or from Settings → Models, then retain that choice across restarts. Fresh profiles make no connection request and register no tool at all. The bundled premium output guides remain available without this service; tool calls send the selected brief and evidence to the configured external endpoint. The package also registers `design_study_references`, a small first-party tool (not an `mcp__saturnai__*` MCP call) that fetches design-library reference thumbnails as real images so the model studies them with eyes; its network path is independent of the `mcp__saturnai__` MCP transport, but its registration tracks the same opt-in state as the connection lifecycle above.

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
| `thumbnailBaseUrl` | `https://saturnai.tools/design/thumbnails/` | Host base `design_study_references` fetches `<slug>.jpg` from |

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
- [Premium output guides](../../skill/skill-premium-output/README.md) — bundled workflows available without an external connection, including the "Study the references with eyes" and "Look at what you built" steps this tool feeds.
- [Models settings](../../client/ui-settings-models/README.md) — provider and connection controls.
- [`describe-image`](../../vision/tool-describe-image/README.md) and [`tool-fs`'s `read_image`](../../fs/tool-fs/README.md) — the redirect-refusing HTTPS client and durable-image-block conventions `design_study_references` follows.

<a id="model-experience"></a>
## Model Experience

### Optional design context

#### What the model sees

When SaturnAI is connected and its tools are visible in the requesting scope, the `saturn:design-brain` section directs the model to use their schemas for relevant work, reuse existing context for focused edits, and report failures honestly. It now also names two concrete follow-ups: call `design_study_references` on the slugs `compose`/`search`/`pick` return, and read its own built screenshots with `read_image` before calling `review` — `review` grades the evidence supplied to it; it does not look at rendered pixels itself. Tool definitions and results follow the MCP client's and the tool registry's ordinary registration and execution path.

#### Token effect

The connected section adds one fixed paragraph. Available MCP schemas and explicitly requested tool results add their normal context cost. Disabled connections add no `saturn:design-brain` prompt text and register no tools at all — `design_study_references` included, per the next model-context entry below — so a never-opted-in profile pays none of this fixed cost.

#### KV Cache effect

The section is stable while connection state and tool visibility stay the same. Connecting, disconnecting, or losing availability can change the assembled prompt and tool set. Ordinary request/header and tool-result records remain the evidence of what the model received.

### Study references with eyes

#### What the model sees

`design_study_references({ slugs, prompt? })` accepts 1-6 design-library slugs — exactly what a prior `compose`/`search`/`pick` call returned, never invented — and fetches each `https://<thumbnailBaseUrl>/<slug>.jpg` over a redirect-refusing HTTPS client bounded to 10 MiB, gated to JPEG/PNG/WebP by magic bytes. Every fetched image is written under `<workspace>/.saturn/refs/<slug>.jpg` and returned as a real image content block (via `ctx.attachments.saveImage`, when an attachment store is mounted — the tool fails closed with a clear error otherwise), alongside one text block naming every fetched and missed slug. A slug with no published thumbnail (HTTP 404, or any other non-2xx status, or an unrecognized body) is one miss line, never a thrown call; a redirect or an over-the-cap response IS a thrown refusal of the whole call, since both leave the host's stated contract.

#### Token effect

Fixed tool-schema cost only while registered — the same opt-in gate as the section above, not the connected MCP tool set specifically — plus per call: one summary line per requested slug and one image per fetched thumbnail, bounded by the 1-6 slug limit, so a call costs at most 6 images.

#### KV Cache effect

Each call's result is a genuinely new turn (fetched bytes and image attachment ids differ call to call); there is nothing to cache across calls. The tool schema itself is stable for the KV-cache boundary described above.

## Known Limitations and Deferred Work

- The connector provides guidance and tool access, not guaranteed visual quality or model compliance.
- Existing profile rows remain deployment-owned. Failed profile connections must be corrected or restarted through that configuration.
- The endpoint is Host-controlled. Browser users cannot supply arbitrary URLs or read deployment headers through this API.
- External reviews use caller-supplied evidence. The harness does not silently capture or upload project files, screenshots, or conversation history when connecting.
- `design_study_references` requires a mounted `ctx.attachments` service; a deployment without one gets a clear per-call error, not a silent no-op. It never falls back to describing an image in text.
- `design_study_references` registers and unregisters with the same opt-in state as the `saturn:design-brain` connection above (`saturn-design-brain.enabled`, or an independent profile row) rather than through the `mcp__saturnai__` MCP transport directly — it talks straight to the fixed thumbnail host over plain HTTPS regardless of MCP connectivity, but a disabled design brain registers neither.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-host-owned-design-brain.md) explains ownership and the bounded transport deadline. The [study-with-eyes note](../../../.agents/notes/implemented/feature/2026-09-15-design-brain-study-with-eyes.md) explains why `design_study_references` is a first-party tool rather than a hosted MCP call, and why its registration tracks the connection lifecycle's opt-in state even though its own network path does not go through that lifecycle.

</details>
