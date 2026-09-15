---
description: "SaturnBot's separate-window agent messenger, execution inspector, and workspace configuration."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-saturnbot

English | [中文](README.zh.md)

## Summary

This Client plugin places a SaturnBot launcher at the top right of the harness. It opens the same-origin `/?saturnbot=1` route in the named `saturnbot` window. Repeated clicks focus the open dashboard without reloading it, preserving unsent drafts; closing the dashboard allows the next click to open it again. On desktop, native Minimize hides the dashboard and returns to the harness; the same launcher restores the retained window through the narrow desktop bridge. Browser clients use ordinary window focus. The [desktop package](../../../apps/desktop/README.md) owns native admission and minimize behavior. The standalone surface makes the covered harness inert and gives the window its own product title.

## Agent workspace

The three-column messenger contains the Chief of Staff and four specialists, a role-specific conversation, and an execution inspector. Each role keeps its own local draft. Enter sends and Shift+Enter inserts a line break; composition input is respected. A failed command preserves the draft and exposes the error. The runtime's execution lease determines whether a new request can start.

The inspector shows actual branches, tool payloads, errors, staged paths and revisions, approval state, model, workspace, and schedule. Its canvas moves signals only along running or planning branches. The Pause/Resume visualization button beside the execution status controls motion independently of agent work and scheduling. Pausing retains the signal position while branch topology and status continue updating; resuming continues from that position, with OS reduced motion always taking precedence. The choice remains local to the open dashboard and survives hiding the inspector. Status text remains in the DOM; decorative motion is capped at 30 frames per second and DPR 2, stops for hidden/offscreen/reduced-motion surfaces, and cleans up observers and frame callbacks. An SVG supplies a static fallback.

Runs retain recorded summaries and status. Approvals show the exact action input and stage before an allow/deny decision. Memory reads the dedicated memory, ticket, and webhook APIs and renders durable Markdown briefings. Host history ordering is preserved: messages are chronological and reports, alerts, approvals, and runs are newest first. Connection rows distinguish configured and unconfigured services without claiming unverified health.

## State and commands

The source-safe mount owns the generated SaturnBot Remote contribution. A private React-free `SaturnBotController` publishes a `createSnapshotStore` through the slot's injected `hooks.bot`; the renderer creates `useBot`. Components receive plain data and callbacks and never receive a Cordis Context.

The controller serializes mutations and refreshes, shares overlapping refresh requests, ignores disposed results and older snapshots, and keeps admitted actions successful when a subsequent trace fetch fails. The initial baseline loads once even if the window begins hidden; subsequent automatic refreshes wait for visibility. A baseline loads the latest 1,000 journal records through at most five 200-record pages. The interface labels that limit explicitly. Visible running/approval work refreshes every two seconds. Idle instances refresh on focus, user request, or the next scheduled-run boundary. The main-window launcher starts no polling.

Settings submit an explicit configuration draft: workspace, business goal, model/provider IDs, schedule, action policy, per-role instructions and exact tool allowlists, command limits, validation command arrays, and integration environment-variable references. The Host owns validation, permitted tools, scheduling, persistence, and execution. First-run actions open configuration until the required setup exists.

## Model Experience

This package creates no model sessions or prompts. Its message command sends the selected role and the operator's text to the SaturnBot Host. Published proposals, outcomes, and digests come from durable Host records. It introduces no synthetic activity, success metrics, unread counts, or screen feed.

## Known Limitations and Deferred Work

This surface manages one configured workspace instance. It does not implement multi-tenant billing or account isolation. The recent tool journal is bounded at 1,000 records, while the Host supplies bounded run/message/report history. Full journal export and older-message pagination are not exposed here. Connection configuration indicates presence, not a health probe. Message drafts are local to the open window and are not durable across closing it. Desktop popup admission and native window behavior belong to the desktop package.

## Dev Note

Run `pnpm exec vitest run packages/client/ui-saturnbot/tests --maxWorkers=2` for messenger, approval, record, controller-ordering, window-lifecycle, and canvas checks. Run `pnpm exec tsc -p packages/client/ui-saturnbot --noEmit` after the generated Host Remote is built. The dictionaries own English and Simplified Chinese product copy; the UI i18n gate reports no hard-coded strings in this package. Build and native/browser smoke validation use the assembled application.
