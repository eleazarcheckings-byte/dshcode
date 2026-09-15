---
description: "Fleet route surface: one fact-derived line per delegated worker, in the composer's ambient dock."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-fleet

English | [中文](README.zh.md)

## Summary

Fleet contributes to `conversation.composer.dock` at order 10, keeping delegated workers visible beneath the composer with direct navigation to each one. It folds published session facts — subagent lineage, pending interactions, and background jobs — into one status line per worker; it owns no independent runtime state, transport, or model-facing tool.

## Table of Contents

- [Team activity in the conversation](#team-activity-in-the-conversation)
- [Data and navigation](#data-and-navigation)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="team-activity-in-the-conversation"></a>
## Team activity in the conversation

Fleet contributes to `conversation.composer.dock` at order 10. It keeps delegated workers visible beneath the composer, with direct navigation to each worker. The compact header counts real running workers and workers needing attention. The first three routes remain visible; a user can expand the remaining routes and collapse them again. Attention routes precede running and completed routes.

Each worker receives one fact-derived status. Pending human interaction takes precedence, followed by a blocked goal or failed background job, active running, and a completion reminder. Settled workers with no new state are omitted. The designed empty line remains when no routes qualify. Words accompany every state dot; counts have no estimated progress, cost, or duration.

-----

<a id="data-and-navigation"></a>
## Data and navigation

The package folds `SessionListState.byId`, `jobsBySession`, and `useSessionPendingInteraction`. It traverses subagent descendants, stops at ordinary forks, and omits lineage cycles. It reads blocked reasons from the worker's goal projection and failed-job names from the worker's job list. Route ties preserve lineage ordering.

Navigation uses `sessions.subagentAddress(id)` and `openSubagent(address)` when an addressed route is known, otherwise `sessions.open(id)`. The browser export registers through the shared slot and locale services. The Host export is inert; there is no configuration, transport, persistent state, or model-facing tool.

-----

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/client/ui-fleet` verifies state precedence, lineage traversal, empty output, accessible route names, navigation, attention summaries, and roster expansion.

**Runtime invariant:** No companion is published because the package owns no independent runtime state; its routes derive from the existing session read models.

-----

<a id="model-experience"></a>
## Model Experience

### Composer dock presentation

#### What the model sees

Nothing. Fleet reads `SessionListState.byId`, `jobsBySession`, and pending-interaction facts already published by the session, goal, and jobs services, and renders them as navigation routes; it introduces no prompt, tool schema, or tool result of its own.

#### Token effect

None. The dock is a browser-rendered summary; nothing it computes or displays is copied into a model request.

#### KV Cache effect

None. Selecting a route only changes which conversation is open in the browser; it does not alter any assembled request.

## Known Limitations and Deferred Work

- Route order beyond the first three is collapsed by default; a user must expand the dock to see the full roster, with no setting to change the default count.
- The dock has no live push subscription; it only recomputes on the state changes the owning services already publish, so a fact that changes without touching those read models will not appear until the next one does.
- There is no persisted expand/collapse preference across sessions.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
