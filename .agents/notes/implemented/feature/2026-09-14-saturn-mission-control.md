# Agent Note: Team mission control from authoritative work

Status: implemented

English | [中文](2026-09-14-saturn-mission-control.zh.md)

## Problem

Parallel work is difficult to supervise when the Team roster, task dependencies, and task edits live in a narrow header popover. Animation without a stated relationship to runtime facts can make agents appear active when they are idle, and hidden animation consumes resources that belong to actual work.

## Decision

The Team header action opens a responsive mission control dialog. Its canvas gives every roster member a stable position, puts the lead at the center, and shows only real membership and unresolved assigned-task dependency links. Node numbers count open assigned tasks; a moving perimeter indicator marks running members. Hover and keyboard focus connect the diagram to ordinary teammate navigation buttons. The adjacent task board provides exact completion counts and filters for open, attention, and finished work.

The canvas is an enhancement to the accessible roster and task descriptions. It owns its frame, resize observer, intersection observer, and visibility listeners within one React effect. Reduced motion, hidden documents, offscreen canvases, and unmount stop the frame loop. Small screens show the complete HTML controls without the map. Idle and inactive roster members use neutral dots rather than completion indicators.

The Team Remote remains the authority for task state. Refresh happens on open, observed member running-state changes, window return, explicit refresh, and task mutation; pending edits keep their existing revision checks and refresh generations. The UI states the refresh behavior and keeps manual refresh available because the unary Remote does not deliver browser task-change events.

The composer Fleet presents exact activity and attention counts with three initial routes and an explicit expansion control. It keeps attention-first ordering and uses the existing addressed-subagent navigation path.

## Alternatives considered

**An always-running orbital ambience.** Continuous movement would make settled teams look busy and spend rendering time while offscreen. Animation is attached to the running status and suspended when the display cannot be seen.

**Estimated agent completion percentages.** The runtime supplies task lifecycle state, not remaining effort. The overview therefore shows completed task counts with an accessible progress element and no partial credit for open tasks.

**Automatic periodic task polling.** The current browser Team API is unary, and a fixed polling cadence introduces background requests and refresh races. Existing session activity and visibility events provide useful refresh points while an explicit refresh action covers task changes that do not alter member running state. A proper browser watch API can replace this limitation when the runtime owns one.

## Consequences

The user can inspect work ownership, dependencies, attention, and exact task completion in one dialog. The modal retains keyboard focus and returns focus to its trigger when dismissed. Canvas visuals stay grounded in the roster and task board, but large teams still use the textual roster for detailed inspection. Task-only updates can require manual refresh. The client adds no durable event, provider capability, model input, or deployment configuration.

## Verification

Focused Team and Fleet suites cover task revision races, exact counts, board filtering, teammate navigation, dependency deduplication, stable layout, modal focus and Escape behavior, visibility refresh, compact roster expansion, animation suspension, and observer cleanup. The application build and Web replay suite own assembled-browser verification.
