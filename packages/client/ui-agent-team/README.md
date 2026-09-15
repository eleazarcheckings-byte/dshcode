---
description: "Inspect Team activity, task dependencies, and shared work in SaturnAI mission control."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-agent-team

English | [中文](README.zh.md)

## Mission control

The conversation-header Team action opens a keyboard-accessible mission control dialog. It reads the authoritative Team roster and shared task board through the generated `ctx.remote.agentTeams` contribution. The Client package owns presentation and temporary form state; it registers no model-facing input and writes no Team state outside the existing Remote operations.

The canvas shows one node per roster member, with the lead at the center. A node contains the exact count of its assigned open tasks. Solid lines identify lead membership; dashed lines identify unresolved task dependencies between distinct assigned members. Running members have a moving perimeter indicator. Roster hover and keyboard focus highlight the same node. Ordinary roster buttons and task descriptions provide the accessible equivalent and navigate through the stable addressed-subagent path.

The board shows the exact number of completed tasks out of all non-deleted tasks. Open tasks receive no estimated percentage. Filters select all, open, attention, or finished tasks. Attention includes pending tasks whose prerequisites are unresolved and open tasks carrying write-scope warnings. Each task keeps its status, owner, dependency names, identity, scopes, warnings, and existing mutation controls.

## Refresh and interaction

The dialog refreshes on open, observed member running-state changes, window return, explicit refresh, and successful mutations. Hidden documents do not refresh from activity changes. Refreshes carry session and request generations so an older response cannot replace newer work. There is no browser task-event subscription or periodic polling: the footer makes refresh behavior explicit, and manual refresh can collect changes that do not affect member running state.

Task create, edit, assign, unassign, complete, reopen, and delete use the current revision. Conflicts reload authoritative state before showing the conflict notice. Text/scope edits and dependency changes retain their separate sequential compare-and-set operations. Inputs have visible labels, the modal traps Tab navigation, Escape dismisses it, and closing restores focus to the trigger.

Canvas animation runs only for running members, at a bounded frame cadence. Reduced-motion preferences retain a static diagram. Document visibility, canvas intersection, and unmount stop animation; resize and visibility return redraw current facts. Small screens use the complete HTML roster and board without the canvas.

## Composition

The shipped `@saturnai/dsh-web-app` bundle mounts this package by default: its patch declares the `ui-agent-team` row, so a Web composition includes the panel automatically and there is no separate Web profile layer to add. The Host export is inert. The browser entry mounts generated Remote descriptors and registers locale and header-slot contributions through disposable Cordis effects. There are no package configuration fields. The [promotion record](../../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) describes package placement, release family, and dependency isolation.

## Model Experience

None. This package projects runtime facts and invokes existing task mutations; Team tools and ordinary conversation submission own later model-visible input. There is no direct KV Cache effect.

## Verification

`pnpm exec vitest run packages/client/ui-agent-team` covers Remote registration, task compare-and-set races, navigation, board filters, modal focus, exact totals, deterministic dependency projection, and canvas resource ownership. Browser assembly is verified by the application Web smoke and replay suite.

**Runtime invariant:** No companion is published. The Remote remains authoritative; the UI owns disposable presentation resources and local viewing state only.
