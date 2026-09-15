# @saturnai/dsh-client-ui-fleet

English | [中文](README.zh.md)

## Team activity in the conversation

Fleet contributes to `conversation.composer.dock` at order 10. It keeps delegated workers visible beneath the composer, with direct navigation to each worker. The compact header counts real running workers and workers needing attention. The first three routes remain visible; a user can expand the remaining routes and collapse them again. Attention routes precede running and completed routes.

Each worker receives one fact-derived status. Pending human interaction takes precedence, followed by a blocked goal or failed background job, active running, and a completion reminder. Settled workers with no new state are omitted. The designed empty line remains when no routes qualify. Words accompany every state dot; counts have no estimated progress, cost, or duration.

## Data and navigation

The package folds `SessionListState.byId`, `jobsBySession`, and `useSessionPendingInteraction`. It traverses subagent descendants, stops at ordinary forks, and omits lineage cycles. It reads blocked reasons from the worker's goal projection and failed-job names from the worker's job list. Route ties preserve lineage ordering.

Navigation uses `sessions.subagentAddress(id)` and `openSubagent(address)` when an addressed route is known, otherwise `sessions.open(id)`. The browser export registers through the shared slot and locale services. The Host export is inert; there is no configuration, transport, persistent state, or model-facing tool.

## Model Experience

None. This package reads published session facts and changes only the selected conversation. There is no direct KV Cache effect.

## Verification

`pnpm exec vitest run packages/client/ui-fleet` verifies state precedence, lineage traversal, empty output, accessible route names, navigation, attention summaries, and roster expansion.

**Runtime invariant:** No companion is published because the package owns no independent runtime state; its routes derive from the existing session read models.
