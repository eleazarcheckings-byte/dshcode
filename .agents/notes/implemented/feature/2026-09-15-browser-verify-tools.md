# Agent Note: Browser verify tools over in-tree Playwright

Status: implemented

English | [中文](2026-09-15-browser-verify-tools.zh.md)

## Problem

The shipped coding agent can search and fetch documents through `web_search` / `web_fetch`, but it cannot open a page in a real browser and read the rendered accessibility tree. UI work then stops at HTML source or a marketing MCP overlay. The harness already depends on Playwright for Web e2e, so a second browser stack would duplicate that engine.

## Decision

Ship `@deepseek-ai/dsh-tool-browser` under `packages/browser/tool-browser` and mount it on the `standard` agent preset only. The model-facing tools are `browser_navigate` and `browser_snapshot`. Chromium is launched through `playwright-core` on the first navigation and closed with the plugin fiber. Snapshot is Playwright's ARIA tree; an optional PNG is written to an owner-only temp path rather than returned as bytes. URLs are http(s) only. There is no host-plane row in `web-app` or `dsh-base` patches; resolution is a workspace dependency of the runtime closure so the preset specifier loads.

## Alternatives considered

- **Wrap a browser MCP or chrome-devtools overlay** — would add a second engine and a marketing-shaped tool catalog. The in-tree Playwright used by `apps/web` already launches Chromium.
- **Put the tools in `packages/web/`** — that group owns search and anonymous fetch and states that it does not browse. A `browser/` group keeps that split.
- **Hand-rolled CDP** — would reimplement launch, ARIA snapshot, and teardown that Playwright already provides.
- **Per-agent browser isolation** — the standing preset mount shares one tab. Isolating a browser per session would multiply processes without a current consumer that needs concurrent pages.

## Consequences

The `standard` preset can verify rendered UI against a public URL or a local fixture without a logged-in site. Hosts without Chromium fail at first navigate with install guidance instead of at plugin load, so schema harvest and keyless unit tests stay green. Click and type stay out of this package; adding them would be a later tool, not a silent expansion of snapshot.
