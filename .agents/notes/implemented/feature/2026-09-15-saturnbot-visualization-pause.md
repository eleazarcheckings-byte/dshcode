# Agent Note: SaturnBot visualization pauses independently of execution

Status: implemented

English | [中文](2026-09-15-saturnbot-visualization-pause.zh.md)

## Problem

The SaturnBot execution graph can move throughout a long run while the operator reads messages and approvals. The separate manager does not contain the main harness's ambient-motion control. Hiding the inspector removes useful context, and pausing the schedule does not express a request to stop visual motion.

## Decision

Place a native Pause/Resume visualization button beside the execution status. Its localized name and tooltip distinguish visual motion from agent work. Dashboard-local state survives inspector toggles and native window minimization; closing or reloading the manager resets it.

The canvas includes this preference in its animation eligibility check. Pause cancels the frame callback and retains elapsed active time. Branch changes still repaint the current topology and statuses. Resume uses that retained phase without advancing through paused wall-clock time. OS reduced motion, hidden/offscreen suspension, and the existing frame-rate and pixel-density limits remain authoritative.

This adds a viewing control to the [agent messenger](2026-09-14-saturnbot-agent-messenger.md); its transport, polling, and execution ownership remain unchanged.

## Alternatives considered

**Use Pause schedule.** It changes future execution and does not govern the current graph. An operator must be able to inspect a still visualization while work continues.

**Rely on OS reduced motion or hide the inspector.** Both already work, but changing a system preference or losing execution context is unnecessary for a local viewing choice.

**Import the conversation plugin's ambient control.** Feature plugins do not share runtime implementations, and that control owns the separate decorative sky. This local action needs no new cross-plugin service or persistent configuration.

## Consequences

Operators can keep live context visible without continuous movement. The preference stays in the current dashboard, introduces no Host command or model input, and is not persisted across window closure. Hiding the inspector retains the preference but remounts its canvas; phase retention applies to pause/resume while that canvas remains mounted.

## Verification

Canvas tests cover cancellation, live topology redraw during pause, phase retention across a long pause, and reduced-motion precedence. Dashboard tests cover the accessible actions and their snapshots, current execution status after pausing, inspector-toggle retention, and the absence of schedule or execution commands.
