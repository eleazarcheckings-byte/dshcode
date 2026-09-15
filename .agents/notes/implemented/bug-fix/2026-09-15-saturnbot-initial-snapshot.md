# Agent Note: SaturnBot loads its first snapshot independently of visibility

Status: implemented

English | [中文](2026-09-15-saturnbot-initial-snapshot.zh.md)

## Problem

The installed Electron popup rendered its static roster while its first SaturnBot request waited approximately 199 seconds after navigation. The ordinary session request began at 512 ms. Once focus activated the dashboard, the snapshot and events endpoints returned HTTP 200 in approximately 8 ms and 12 ms. Skipping initialization based on a transient hidden state makes usable content depend on a later focus event.

## Decision

The SaturnBot controller requests its initial snapshot once when the standalone dashboard mounts, including while `document.hidden` is true. Visibility gates later automatic refreshes and their timers. The main-window launcher does not start the controller.

## Alternatives considered

**Defer the initial request until the window becomes visible.** A transient hidden state can leave the dashboard waiting for a later focus event before it shows usable content.

## Consequences

A hidden dashboard performs one bounded initial read. This removes the dependency on a later focus event while keeping subsequent background polling quiet until the window is visible.

## Verification

The controller regression starts hidden, observes the baseline without calling refresh itself, verifies no polling timer while hidden, then verifies refresh and polling after visibility returns. The test fails against the visibility-gated initializer. Existing ordering, mutation, disposal, and visible-polling tests remain applicable. The assembled browser regression opens a dashboard whose document is hidden at mount and requires the actual Remote projection to replace the loading state.

## Model experience

This change reads existing state only. It creates no model request, alters no prompt, and introduces no synthetic execution events.
