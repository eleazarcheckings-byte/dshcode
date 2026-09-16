# Agent Note: The web client at phone size — drawer, docked composer, one breakpoint

Status: implemented

English | [中文](2026-09-15-mobile-shell-layout.zh.md)

## Problem

The web GUI was a desktop shell with a narrow mode, not a phone product. Below 768px the three-column `AppFrame` still rendered three columns: the sidebar auto-collapsed to a 56px rail that ate a seventh of a 390px screen, the details column stayed in the track list, and 40px `col-resize` strips sat over the transcript where a touch surface expects swipes. The composer docked at the layout viewport's floor, which on iOS is *under* the on-screen keyboard — the keyboard does not shrink the layout viewport there, it is drawn over it. No surface honored `env(safe-area-inset-*)`, so a notch overlapped the session title and the home indicator overlapped the send control. Tool rows kept their desktop 24px height, well under a usable touch target.

SPEC §8 M2 asked for the same product on a phone — the ring, the tokens, the motion system — not a shrunken desktop, and named the acceptance: a 390×844 screenshot with an open drawer and a keyboard-open composer, with `document.documentElement.scrollWidth <= 390`.

## Decision

One breakpoint, one sheet, and the smallest component change that can carry it.

### `ui-theme/src/styles/mobile.css` — the single authority

A new global sheet mounted last by `installThemeStyles`, holding exactly **one** top-level `@media (max-width: 768px)` block (the reduced-motion arm is nested inside it rather than opening a second query). It adapts components it does not own, so it anchors only on durable attributes those packages publish deliberately — `data-shell-frame`, `data-shell-center`, `data-shell-details`, `data-mobile-drawer`, `data-mobile-backdrop`, `data-mobile-strip`, `data-sidebar-root`, `data-composer-seat`, `data-tool`, `data-disclosure-row` — and never a CSS-module class name, which is hashed and free to change without notice. `mobile-styles.client.spec.ts` is that rule as a test: it fails on a second top-level at-rule, on any class selector, and on a raw `ms` literal in a transition.

What it does: `100dvh` on the shell (a collapsing URL bar leaves a gap under a `100%` composer every time it re-expands); `overflow-x: hidden` plus `overscroll-behavior: none` on the document; the frame's tracks become `100% / auto minmax(0, 1fr)` with the details column `display: none`; the sidebar column becomes a `position: fixed` drawer at `min(84vw, 360px)` — short of the viewport on purpose, because the conversation staying visible behind the backdrop is what makes it an overlay and not a second screen; 44px minimum tap targets in the strip, the drawer, the composer seat and every tool disclosure row; a single-line tool header with its disclosure intact; and the composer seat's `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--saturn-keyboard-inset, 0px))`.

### `ui-layout` — the phone shape

`isMobileViewport` / `drawerWidth` join `columns.ts`; the concession solver itself stays breakpoint-free, as it already was for `SIDEBAR_AUTO_COLLAPSE`. `AppFrame` reads the predicate off its own `ResizeObserver`-measured box and (a) drops the inline `grid-template-columns` — an inline template would outrank the sheet — (b) renders `MobileTitleStrip`, (c) renders a backdrop, (d) marks the sidebar column `role="dialog" aria-modal`, and (e) withholds both drag handles. The sidebar renders **wide** in the drawer, never the rail: a 56px rail floating over a transcript reads as debris.

The open state lives in the layout store as `drawer`, beside a `mobile` mirror of the breakpoint — the same shape `narrow`/`narrowExpanded` already used, and for the same reason: `toggleSidebar` needs to know which semantics it has. It now picks narrowest-band-first (phone → drawer, narrow → override, wide → width), so `ctx.layout.toggleSidebar()` and the column's own toggle button both work the drawer with no new service method and no new consumer edge. Leaving the phone band closes the drawer, so a resize can never strand an overlay on a desktop frame.

`drawer.ts` is a plain installer, not a hook: it subscribes to the DOM, and business components reach everything through the four props shares. Escape dismisses, Tab wraps at the two ends only (every interior Tab is the browser's own), and focus returns to the strip control. The restore target is passed in rather than read from `document.activeElement`, because "whatever was focused" is only right when a focused control opened it — a pointer press moves no focus, and `ctx.layout` can open the drawer from anywhere; the recorded-activeElement path remains the fallback.

The strip's control is the signature ring of SPEC §2 — the favicon's ellipse, masked so it takes the button's own ink — tilted -18° closed and rotating flat as the drawer opens. That plus the drawer slide are the surface's two intentional motions, both on `--saturn-dur-2` + `--saturn-ease-out`, both cancelled under reduced motion. The contract is honored in JS as well as CSS: with motion reduced the trap moves focus in the same task instead of waiting a frame for a slide that will not happen.

The root entry now declares its own `layout` locale namespace instead of `common`; a namespace-bound `t` also reads the shared common vocabulary, so `brand.localBuild` still resolves and the strip's three strings are owned by the package that renders them.

### `ui-conversation/skeleton/keyboard-inset.ts` — the composer survives the keyboard

`keyboardInset(layoutHeight, visualViewport)` is the whole measurement: `max(0, round(innerHeight - viewport.height - viewport.offsetTop))`. Subtracting `offsetTop` matters — that band is already scrolled off the top and counting it again would double-pad. `installKeyboardInset` subscribes to the visual viewport's `resize` (the keyboard) and `scroll` (the browser keeping the focused field in sight, which moves `offsetTop` without changing the height) and publishes the value as `--saturn-keyboard-inset` on the document element. `ConversationRoot` installs it once — it is the resident owner of the composer seat and there is exactly one of it — and the sheet spends it as the seat's bottom padding. An engine with no `visualViewport` publishes `0px`: nothing reports a keyboard, and padding on a guess would move the composer for nothing.

## Alternatives considered

**A separate mobile route or a forked phone layout.** Rejected by the mandate and on merit: two shells drift, and every feature would then ship twice.

**Container queries instead of a media query.** The drawer is `position: fixed` against the viewport and the safe areas are the viewport's, so the viewport is the honest query subject. Container queries remain right for component-internal reflow and are not foreclosed.

**`inert` on the closed drawer.** Unnecessary: the sheet parks it off-canvas with `visibility: hidden`, which already removes every tab stop, and `focusableWithin` reads that same computed visibility so the trap agrees with the browser.

**Reading `offsetParent` for focusability.** Rejected: it is 0/null outside a real layout engine, which would make the trap untestable in jsdom and silently empty in any pre-paint call. Computed `display`/`visibility` answers both.

**A `closeDrawer` method on `ILayout`.** Rejected: `toggleSidebar` already means "show or hide the navigation column", and giving it the phone semantics keeps every existing caller correct with no contract widening.

## Testing

Running vitest over `ui-layout`, `ui-sidebar`, `ui-theme` and `ui-conversation` — 71 files, 660 tests green. New: `drawer-trap.client.spec.ts` (Escape, both Tab wraps, the empty-panel fallback, both focus-timing arms, restore and its idempotence), `mobile-columns.client.spec.ts` (the breakpoint and the store's drawer semantics), `mobile-frame.client.spec.tsx` (the phone shape, the drawer's dialog markup, close on backdrop/Escape/route change, focus hand-back, and the desktop shape at 1280px), `keyboard-inset.client.spec.ts`, `mobile-styles.client.spec.ts` (the sheet contract above), `drawer-anchor.client.spec.tsx`. Three existing expectations were widened for the two new store fields, one for the new sheet in the mount order, and the sidebar snapshots re-recorded for the new root attribute.

`apps/web/tests/mobile-layout.e2e.ts` drives the real composition at 390×844: the drawer opens from the strip, sits at `left: 0` across 84% of the screen with a live backdrop, offers no control under 44px, and closes on the route change when a session row is picked; the composer lifts clear of a simulated 336px keyboard band without clipping; `document.documentElement.scrollWidth` stays ≤ 390 in both states. Screenshots are written beside the run.

## Consequences

The phone shape is decided in one predicate and drawn by one sheet, so the next surface that needs a mobile arm adds a rule there rather than a breakpoint of its own. The cost is a standing coupling to the attribute names listed above: they are now product contract, not incidental markup, and `mobile-styles`' no-class-selector assertion is what keeps that visible to whoever renames one. `env(safe-area-inset-*)` resolves to 0 until the page's viewport meta carries `viewport-fit=cover`; every inset is written so that resolution degrades to the desktop-equivalent spacing rather than to a broken layout.
