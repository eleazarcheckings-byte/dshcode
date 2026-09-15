# Agent Note: Context-menu events stay inside the portalled card

Status: implemented

English | [中文](2026-09-15-context-menu-event-containment.zh.md)

## Problem

React events follow component ancestry across portals even when the DOM card sits under `document.body`. The session row owns both navigation and its context-menu component. Without containment, Rename invokes the rename callback and the row's navigation callback in the same click.

## Decision

The shared `ContextMenu` card stops click and context-menu propagation. Selecting a row invokes the menu's callback; it does not also activate the control whose React subtree owns the portal. Right-clicking the card prevents the browser menu without reopening the invoking control's menu.

## Alternatives considered

**Portal-specific target checks in workspace rows.** They put event isolation in each clickable owner. The shared primitive gives every owner the same containment behavior.

## Consequences

Workspace rows do not need portal-specific target checks. Menu selection and ordinary activation of the invoking control remain separate actions, while right-clicks inside the card stay within the menu.

## Verification

A primitive regression renders the portalled card inside a clickable control, selects Rename, and asserts exactly one selection without parent activation. It also checks right-click isolation and that the original control still activates normally. The existing workspace row regression retains its no-navigation assertions for rename, fork, and archive. The assembled rename tests exercise successful rename and error preservation through the real workspace plugin and renderer.

Workspace fixtures provide the `remote.session` namespace already required by the plugin's open-folder integration, and the apply test verifies that operation reaches `openWorkspacePath`. Dark-theme and Saturn-brand expectations reflect the product defaults while preserving tests for explicit preference changes, no-op updates, and build-version suffixes. No runtime behavior is weakened to satisfy stale expectations.

## Model experience

The fix changes pointer event routing only. It does not create or alter model-visible content or durable session events.
