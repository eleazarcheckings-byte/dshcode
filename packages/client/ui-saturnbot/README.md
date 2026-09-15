---
description: "SaturnBot's separate-window agent messenger, execution inspector, and workspace configuration."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-saturnbot

English | [中文](README.zh.md)

## Table of Contents

- [Summary](#summary)
- [Agent workspace](#agent-workspace)
- [State and commands](#state-and-commands)
- [Guided setup, connect forms, and the status strip](#guided-setup-connect-forms-and-the-status-strip)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="summary"></a>
## Summary

This Client plugin places a SaturnBot launcher at the top right of the harness. It opens the same-origin `/?saturnbot=1` route in the named `saturnbot` window. Repeated clicks focus the open dashboard without reloading it, preserving unsent drafts; closing the dashboard allows the next click to open it again. On desktop, native Minimize hides the dashboard and returns to the harness; the same launcher restores the retained window through the narrow desktop bridge. Browser clients use ordinary window focus. The [desktop package](../../../apps/desktop/README.md) owns native admission and minimize behavior. The standalone surface makes the covered harness inert and gives the window its own product title.

<a id="agent-workspace"></a>
## Agent workspace

The three-column messenger contains the Chief of Staff and four specialists, a role-specific conversation, and an execution inspector. Each role keeps its own local draft. Enter sends and Shift+Enter inserts a line break; composition input is respected. A failed command preserves the draft and exposes the error. The runtime's execution lease determines whether a new request can start.

The inspector shows actual branches, tool payloads, errors, staged paths and revisions, approval state, model, workspace, and schedule. Its canvas moves signals only along running or planning branches. The Pause/Resume visualization button beside the execution status controls motion independently of agent work and scheduling. Pausing retains the signal position while branch topology and status continue updating; resuming continues from that position, with OS reduced motion always taking precedence. The choice remains local to the open dashboard and survives hiding the inspector. Status text remains in the DOM; decorative motion is capped at 30 frames per second and DPR 2, stops for hidden/offscreen/reduced-motion surfaces, and cleans up observers and frame callbacks. An SVG supplies a static fallback.

Runs retain recorded summaries and status. Approvals show the exact action input and stage before an allow/deny decision. Memory reads the dedicated memory, ticket, and webhook APIs and renders durable Markdown briefings. Host history ordering is preserved: messages are chronological and reports, alerts, approvals, and runs are newest first. Connection rows distinguish configured and unconfigured services without claiming unverified health.

<a id="state-and-commands"></a>
## State and commands

The source-safe mount owns the generated SaturnBot Remote contribution. A private React-free `SaturnBotController` publishes a `createSnapshotStore` through the slot's injected `hooks.bot`; the renderer creates `useBot`. Components receive plain data and callbacks and never receive a Cordis Context.

The controller serializes mutations and refreshes, shares overlapping refresh requests, ignores disposed results and older snapshots, and keeps admitted actions successful when a subsequent trace fetch fails. The initial baseline loads once even if the window begins hidden; subsequent automatic refreshes wait for visibility. A baseline loads the latest 1,000 journal records through at most five 200-record pages. The interface labels that limit explicitly. Visible running/approval work refreshes every two seconds. Idle instances refresh on focus, user request, or the next scheduled-run boundary. The main-window launcher starts no polling.

Settings submit an explicit configuration draft: workspace, business goal, model/provider IDs, schedule, action policy, per-role instructions and exact tool allowlists, command limits, validation command arrays, and integration environment-variable references. The Host owns validation, permitted tools, scheduling, persistence, and execution. First-run actions open configuration until the required setup exists.

<a id="guided-setup-connect-forms-and-the-status-strip"></a>
## Guided setup, connect forms, and the status strip

Settings opens a five-step guided setup (objective, workspace, model, connections, schedule) whenever the runtime reports `needs-setup`, resuming at the first field the Host has not filled in; each Continue persists only that step, so closing mid-setup keeps progress. A status strip states exactly what still blocks a run — a blank required field, or a credential the Host could not resolve — or states plainly that SaturnBot can run. Either surface links back to advanced configuration and back again. The workspace step's Browse button opens the Host's native directory picker (the injected `uiWorkspace` service); a cancelled or unavailable picker leaves the freeform path field untouched.

Connections are field-level forms generated from the Host's integration catalog, one per integration: an ordinary text input for a non-secret field the runtime's fixed integration record admits (a repository slug, an endpoint URL), a disabled note for any other field key the catalog names (the runtime does not yet round-trip it), and for a secret field only the exact required environment variable name with a copy action and the file to paste it into — never an input a secret value could be typed into. An "Advanced JSON" disclosure keeps the raw integrations object reachable underneath the generated forms; while that draft cannot be parsed, the generated forms disable themselves and show a fix-first notice rather than collapsing the draft to an empty object on the next field edit.

This package is coded against the `firstRun`/`integrationCatalog` snapshot fields ahead of the Host runtime package (`@saturnai/dsh-saturnbot`) landing them, through a local widened type (`SaturnBotSnapshot` in `contracts.ts`) that keeps both members optional. Every reader in this package degrades to the pre-wizard behavior — the status strip falls back to the four config-derived checks, and connect forms show their empty state — when a snapshot omits them, so the two packages can land in either order.

<a id="model-experience"></a>
## Model Experience

This package creates no model sessions or prompts. Its message command sends the selected role and the operator's text to the SaturnBot Host. Published proposals, outcomes, and digests come from durable Host records. It introduces no synthetic activity, success metrics, unread counts, or screen feed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- This surface manages one configured workspace instance. It does not implement multi-tenant billing or account isolation.
- The recent tool journal is bounded at 1,000 records, while the Host supplies bounded run/message/report history. Full journal export and older-message pagination are not exposed here.
- Connection configuration indicates presence, not a health probe. Message drafts are local to the open window and are not durable across closing it. Desktop popup admission and native window behavior belong to the desktop package.
- The guided setup's model step offers a static, keyless list of common provider identifiers as quick picks; it is not a live query against the harness's configured-provider directory (`@saturnai/dsh-model-router`), so the field stays freeform and never blocks an unlisted provider.
- The connect form's `.env` path hint falls back to generic copy when a snapshot's `firstRun` omits `envPath` — the SPEC's documented snapshot contract does not name this field; wiring it through is a small follow-up on the Host side.
- The Browse button is only on the guided setup's workspace step; the advanced Configuration page's workspace field still takes the workspace list and a freeform path with no picker button.

<a id="dev-note"></a>
### Dev Note

Run `pnpm exec vitest run packages/client/ui-saturnbot/tests --maxWorkers=2` for messenger, approval, record, controller-ordering, window-lifecycle, canvas, guided-setup, connect-form, and status-strip checks. Run `pnpm exec tsc -p packages/client/ui-saturnbot --noEmit` after the generated Host Remote is built. The dictionaries own English and Simplified Chinese product copy; the UI i18n gate reports no hard-coded strings in this package. Build and native/browser smoke validation use the assembled application.
