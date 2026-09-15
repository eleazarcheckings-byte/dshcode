# Agent Note: SaturnBot minimizes back to the harness

Status: implemented

English | [中文](2026-09-15-saturnbot-minimize-to-harness.zh.md)

## Problem

SaturnBot is a management window within the Saturn AI workflow. Sending it to a separate taskbar entry on minimize separates it from its launcher. Recreating the dashboard to bring it back loses local drafts, while ordinary browser focus cannot reliably show an Electron window that the host has hidden.

## Decision

The desktop owns one SaturnBot child window with `skipTaskbar: true`. Native Minimize hides that window and shows and focuses the main harness. The existing top-right launcher restores the retained window without navigation or a second UI bar. Closing the child still destroys it; the next launch creates a new dashboard.

The preload provides only `restoreSaturnBot(): Promise<boolean>` for this operation. The main process accepts the request only from the main harness renderer, restores and focuses a live child, and returns `false` when none exists. Browser clients retain the named-window focus path. The bridge grants no general window control and changes no tool permissions.

This extends the [agent messenger](2026-09-14-saturnbot-agent-messenger.md) while retaining its separate-window composition. The [main-window tray policy](../architecture/2026-08-14-desktop-tray-and-close-to-tray.md) and [initial snapshot behavior](../bug-fix/2026-09-15-saturnbot-initial-snapshot.md) remain separate decisions.

## Alternatives considered

**Ordinary taskbar minimization.** It makes the operating-system taskbar the dashboard's return path instead of the harness launcher.

**A second minimized-window bar in the harness.** It duplicates the existing SaturnBot launcher and adds a second place to manage the same window.

**Close and recreate on minimize.** It discards role-local drafts and the current inspection state. Retaining the hidden window preserves both.

## Consequences

Minimize preserves local UI state and makes the harness the return point. A hidden dashboard keeps its renderer memory until closed; visibility still governs background UI refresh. The Host runner remains independent of window visibility and continues while the Host is open. Drafts remain local to the retained window and are lost when that window is closed.
