# Agent Note: Saturn quick switch

Status: implemented

English | [中文](2026-09-14-saturn-quick-switch.zh.md)

## Problem

Moving between conversations and workspaces requires finding their sidebar rows. A collapsed sidebar or long conversation list makes that navigation slower while the user is composing or coordinating work.

## Decision

The workspace UI owns a Ctrl/Cmd+K palette over the current session and workspace snapshots. It matches metadata locally, favors title matches, preserves recency or workspace order for equal ranks, and excludes archived and blank conversations. The rendered list contains at most 30 destinations, with an additional new-conversation action when it matches. Selecting an item delegates to the existing open or start-session action.

The palette keeps focus in one combobox, exposes its active option to assistive technology, supports arrow selection and Enter, and restores the invoking control's focus when closed. Its global shortcut leaves another modal workflow undisturbed and is removed with the workspace browser.

## Alternatives considered

Reusing the sidebar's content search would add remote search latency to a navigation action. Model-generated navigation would spend a model request on destinations already available in browser state. Duplicating session data in a new store would require synchronizing a second copy. The palette instead derives results from the framework's existing snapshots.

## Consequences

Search requires no remote request, model call, or repository scan. It covers loaded metadata rather than conversation contents; the sidebar's separate content search retains that role. The result cap bounds rendering and keyboard traversal, and opening a destination uses normal session navigation.

Focused tests cover ranking and archive/blank exclusion, keyboard opening and selection, workspace selection, empty results, focus restoration, modal shortcut isolation, and listener cleanup. The [package README](../../../../packages/client/ui-workspace/README.md#quick-switch) owns user-facing instructions.
