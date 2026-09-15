# Agent Note: Saturn conversation ambience follows writing state

Status: implemented

English | [中文](2026-09-14-saturn-conversation-ambience.zh.md)

## Problem

The harness needs a recognizable visual identity and useful conversation starting actions without competing with the editor. Animation that continues throughout writing or implies agent activity makes the interface harder to read and understand.

## Decision

The conversation package contributes one full-window canvas through the layout-owned `shell.background` slot. The canvas sits behind the application columns and remains mounted across session and hero transitions. The hero provides a layout anchor for Saturn above the resident composer; removing that anchor leaves the shared sky in place. The independent SaturnBot window omits this background and uses its own execution canvas.

Idle lighting and ring inclination move slowly. An empty focused composer runs at 65% speed so autofocus preserves visible ambience. A nonempty text/image draft or editing another text field holds the composition still. Active animation time survives preference and focus changes, retaining the current orientation and reflection while paused. The bottom-right Motion control shares one per-application observable preference with the sky and persists it in browser storage. OS reduced motion, document visibility, and intersection visibility also govern the animation clock. Painting uses a four-million backing-pixel budget, caps display density at 2, and runs at most 30 frames per second. Every listener, observer, and pending frame is removed on unmount. A static SVG remains available without a canvas backend or visible dimensions.

The monochrome sky distributes stars and meteor routes across the full width and height of the application. Constellations occupy both upper and lower areas; narrow fields reduce density while retaining a lower constellation. Slow changes in a neutral light wash and star brightness keep the background active between short meteors without moving the stars. One meteor appears at a time, using a bounded trail. Every effect shares the existing animation clock, so pause, drafting, reduced motion, and visibility govern the complete scene. Mouse proximity reveals constellation lines with an eased intensity; it adds no parallax or pointer capture. A brief entrance fade follows the same motion preference.

The existing brand slot, workspace selector, preset selector, and composer stay in their owning locations. Localized starter actions populate only an available empty draft and never submit. Starter space remains reserved while writing so the composer does not shift. The pricing indicator uses a steady lamp instead of random particles.

The Saturn skin publishes shared semantic surface, stroke, ink, accent, and motion tokens. Components keep ownership of their own animation lifecycle and use upstream aliases as fallbacks.

## Alternatives considered

**Continuous particles across the application.** This gives unrelated activity the same visual emphasis, lacks a clear relationship to user work, and incurs rendering cost while reading or writing.

**A static logo alone.** It is inexpensive but does not provide the distinctive canvas composition requested for the empty workspace. The SVG remains the reduced-capability fallback.

**A separate hero editor.** It would remount the draft on the first session transition and risk losing editor selection or undo history. The resident composer remains in place.

## Consequences

The application retains its visual identity as sessions and hero content change, while the resident composer and draft entry points preserve their behavior. One canvas avoids duplicate animation clocks and bounds the full-window rendering cost. Animation intentionally carries no run progress or success meaning. Browser storage denial limits the motion preference to the current application instance; the toggle still works.

## Verification

Focused component tests cover the shared control preference, storage denial, draft and other-editor stillness, empty-composer focus motion, no-session rendering, SaturnBot exclusion, and focus-listener disposal. Registration tests verify one background entry and a shared preference source. Canvas tests cover planet-anchor changes without replacing the sky, full-window backing-pixel and display-density limits, frame budgeting, dynamic reduced motion, frame continuity, hidden/offscreen pause, zero-size and backend fallback rendering, and teardown. Stellar tests cover meteor routes across every horizontal and vertical third of the window, proportional travel on wide displays, quiet intervals between meteors, steady star placement during pointer reveal, and reduced density on narrow fields. SVG constellation paths and a rendered meteor position have owner-local snapshots. Hero and composer tests retain the planet anchor, localized starter availability, and the same editor through session transitions. Palette tests cover scale ordering and text contrast.

[Assembled browser coverage](../../../../apps/web/tests/ambient-canvas.e2e.ts) verifies full-frame canvas bounds at desktop and narrow widths, the same canvas when a Workspace connects, planet alignment during paused sidebar movement, unchanged pixels while drafting or reducing motion, and usable Settings above the main content.
