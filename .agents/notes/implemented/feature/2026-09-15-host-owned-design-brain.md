# Agent Note: Host-owned optional design tools

Status: implemented

English | [中文](2026-09-15-host-owned-design-brain.zh.md)

## Problem

An onboarding HTTP probe can report that a service answered without giving the agent any tools. A profile configured on one developer's computer also does not establish fresh-customer availability. Users need one durable connection whose status reflects the adapter and tool registry used by their agent.

## Decision

Ship an opt-in Host connector with a generated Remote API. First Light and the permanent Models settings card share its state and commands. The existing MCP adapter owns transport, schemas, and execution; the connector owns only the saved preference and managed child lifecycle. A same-scope profile row remains independently owned and is reused without mutation. Other agent scopes do not block the global connection.

A complete connection requires a live supervisor generation plus the registered compose and review tools. A partial list, disabled row, timeout, or failed refresh remains explicit. The model receives relevant-use instructions only when connected tools are visible in its scope, with the limitation that review evaluates caller-supplied evidence. Bundled premium guides remain useful without the external service.

The MCP supervisor supports an optional deadline covering handshake, initialized notification, and initial tool discovery. Expiry closes the actual transport before awaiting cleanup. An outer timeout followed by Fiber disposal cannot supply this guarantee because asynchronous plugin startup can delay its disposers until startup settles.

## Alternatives considered

**Browser probe and a saved memory preference.** It proves endpoint reachability but does not attach tools or preserve their lifecycle.

**Write another profile row automatically.** It risks namespace collisions and changes deployment-owned configuration. The connector instead reuses existing rows and stores managed opt-in through settings.

**Treat every registered wrapper as connected.** MCP retains wrappers during reconnect; status combines supervisor health with the actual required catalog.

## Consequences

Fresh profiles make no connection request. Connect and disconnect persist and apply immediately; direct settings edits take effect on restart. Setup can decline the optional integration, and permanent settings controls remain reachable later. Endpoint headers stay Host-owned and connection status omits URL credentials and queries. Connecting does not upload project files or conversation history; subsequent tool calls carry the arguments the agent supplies.

The transport deadline is optional for other MCP consumers and preserves their existing defaults. Tests use a real Loader, file settings, and production MCP transport against a local protocol server, including all three stalled startup stages, retry, teardown, profile reuse, tool dispatch, and persisted opt-in. UI tests cover connection actions, failure states, localization, and ownership.

The existing packaged-output-quality and MCP lifecycle notes remain independently useful; this decision adds connection ownership rather than replacing either workflow or transport semantics.
