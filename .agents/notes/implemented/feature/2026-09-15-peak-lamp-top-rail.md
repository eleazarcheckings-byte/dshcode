# Agent Note: the DeepSeek pricing lamp moves to the top-right rail

Status: implemented

English | [中文](2026-09-15-peak-lamp-top-rail.zh.md)

## Problem

The DeepSeek API bills half price off-peak, and the harness shows which tier the clock is in as a small PEAK / OFF-PEAK lamp. The lamp lived in the composer's trailing row, beside the model selector. That put a standing fact about the clock inside the one control that moves with every session state: centred on the blank hero, docked at the bottom of a transcript, gone from the SaturnBot window. izzy asked for the lamp at the top of the UI.

## Decision

The lamp is frame chrome, not composer chrome. It now occupies one `shell.overlay` seat (`deepseek-peak`) in the frame's top-right rail, beside the SaturnBot launcher, so it reads the same on the hero and inside every session and never moves with the composer.

Two seats share the rail without knowing each other's width:

- The launcher already publishes its own footprint as `--dsh-shell-trailing-inset` on the frame. The lamp's seat sits at that inset, so it lands immediately left of the launcher; with no launcher mounted it takes the corner itself (the launcher's 18px).
- The lamp measures its own box (a `ResizeObserver` follows the label across the tier switch and locale changes) and publishes width plus a 12px gap as `--dsh-shell-trailing-extra`. The Session header adds that to its right padding, so the right-aligned header utilities (the definition-of-done chip) stop short of the rail. The two properties are independent, so the seats can mount in any order and neither overwrites the other.

The lamp keeps its accessible shape: one named `role="img"` node, never a live region, with a bottom-side tooltip carrying the next switch time. It stays out of the SaturnBot window under the same rule as the ambient-motion control. `data-peak-rail` and `data-peak-chip` are the durable anchors for specs and for the mobile sheet, which cannot reach a hashed CSS-module class.

## Alternatives considered

- **A `conversation.session.header.utilities` seat**, beside the definition-of-done chip. It is the top of the column, but the header is hidden on the blank hero, so the lamp would vanish exactly when a first message is being decided. Rejected.
- **A second copy on the hero.** Two mounts of one clock, two places to keep in step, and a jump when the session starts. Rejected.
- **A hard-coded `right: 134px`** matching the launcher's published inset. Breaks the moment the launcher is absent or changes width. Rejected in favour of reading the inset the launcher already publishes.
- **The lamp bumping `--dsh-shell-trailing-inset` itself.** The launcher sets that property to a fixed value, so whichever seat mounted last would win and the other's reservation would be lost. A second, independent property removes the ordering dependence.

## Consequences

- The Session header's right padding now depends on two frame properties. A new rail occupant should publish its own footprint the same way rather than editing the header.
- The composer's trailing row is one control shorter; nothing else there moved.
- On a phone the top-right corner is the title strip, so the mobile sheet hides the rail (`ui-theme/src/styles/mobile.css`, `[data-peak-rail]`); the seat then measures 0 wide and reserves no header inset. The lamp is a desktop affordance until the strip grows a seat for it.
- The client slot catalog gains the `deepseek-peak` occupant on `shell.overlay` (regenerated with `pnpm run gen-client-catalog`).

## Files

- `packages/client/ui-conversation/src/client/skeleton/PeakChip.tsx` — `PeakChip` (unchanged lamp) plus the new `PeakRail` seat and `PEAK_RAIL_GAP`.
- `packages/client/ui-conversation/src/client/skeleton/PeakChip.module.css` — the `.rail` seat: absolute, `top: 14px`, `right: var(--dsh-shell-trailing-inset, 18px)`, centred on the launcher's 32px line, `-webkit-app-region: no-drag`.
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` — the lamp leaves the trailing row.
- `packages/client/ui-conversation/src/client/apply.ts` — the `shell.overlay` registration (`order: 110`, after the ambient-motion control, which stays the overlay's first entry).
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` — the header's right padding becomes `calc(var(--dsh-shell-trailing-inset, 28px) + var(--dsh-shell-trailing-extra, 0px))`.

## Verification

- `tests/peak-rail.client.spec.tsx`: the lamp renders as one named image node inside the rail, reads Peak on a weekday window and Off-peak on a weekend, reserves `width + 12px` in `--dsh-shell-trailing-extra` and releases or restores it on unmount, and follows the tier switch on its minute tick.
- `tests/skeleton.client.spec.tsx`: neither the active composer nor the hero composer renders the lamp any more.
- `tests/apply-wiring.client.spec.tsx`: `shell.overlay` carries `ambient-motion` then `deepseek-peak`.
- Tests were committed RED first. Two post-RED test edits are declared, both mechanical: the minute-tick case advanced the fake clock outside `act()`, so the state update never flushed, and the edit wraps the advance in `act()`; the layout stub became a `vi.spyOn` to satisfy the linter. No assertion changed. A second RED round (Mars r1) added the zero-width guard and the SaturnBot-window case.
- Runtime proof: the installed desktop build, relaunched with a remote debugging port, shows the lamp at the top-right beside the SaturnBot launcher on the hero and in a session, with the definition-of-done chip clear of it.
