# Agent Note: OrchestrateToggle paints a real on/off/pending state

Status: implemented

English | [中文](2026-09-16-orchestrate-toggle-state.zh.md)

## Problem

The composer's multi-task chip already carried `aria-pressed` and an `on` CSS modifier, but `off` had no rule of its own — every state fell through to the same transparent, unbordered pill. Izzy: "thats fine, make sure the button indicates when its on /off it always looks like the same right now." The default staying OFF in the shipped product (`packages/saturn/orchestrate`, commit `4e1ad8184b`, `1.2.4`) makes this worse, not better: the one control a user has to confirm multi-task engaged, or disengage it, gave no legible signal either way.

## Decision

Give `off` a standalone rule (hairline `--dsw-alias-border-l2` outline, muted ink, transparent fill) and keep `on` filled with `--saturn-accent` against `--saturn-void` ink, transparent border — background AND border now differ between the two, not only a class name. Add a small mono `ON`/`OFF` tag beside the "Multi-task" label, sourced from two new locale keys (`toggle.tag.on` / `toggle.tag.off`) kept untranslated in both dictionaries — the same doctrine-token convention `@saturnai/dsh-client-ui-done`'s `VerdictCard` already uses for `PASS`/`REVISE`/`REJECT` — so the state reads as text and never depends on the fill color alone. `pending` now adds a dashed outline ring, colored by the queued `data-target`, instead of only underlining the label; the ring is dashed rather than solid so a flip in flight never reads as already sealed, and the title already said "applies next turn." The chip's color/border transition rides the shared `--saturn-dur-1` / `--saturn-ease-standard` motion tokens and is disabled under `prefers-reduced-motion: reduce`. Tests first: `toggle-state.client.spec.tsx` (jsdom render) and `toggle-state-styles.client.spec.ts` (plain Node, reads the CSS module text) landed RED in `ef1d0aaebf`, then the component/CSS/locale change landed in `07523de381` without editing either spec file.

## Alternatives considered

- **Tint change only (background color shift, same border).** Rejected: still color-only, which fails both the "never color alone" requirement and colorblind legibility — the exact complaint being fixed.
- **The `VerdictCard` SVG stamp-ring (`pathLength`, self-drawing) for the ON state.** Considered and deferred: that idiom seals a receipt-sized stamp; at the chip's 28px composer-row scale a filled pill reads more clearly at a glance than an animated ring, and a filled pill already matches the existing `PermissionSelect` business-tint convention this chip borrows its chrome from. Kept the ring device for PENDING only, where the job is "not yet landed," not "in force" — a different signal than ON's.
- **Repaint the chip to the queued target while pending.** Rejected: the component's own pre-existing contract is explicit that `aria-pressed` and the visual always report the state in force, never the queued target ("never painting the target as if it were already the mode"); overriding that would relitigate a settled decision outside this task's scope. The pending ring's color is the only place the target shows through, and only for a queued ON.

## Consequences

The three states are now visually distinct in both light and dark themes without relying on the theme's saturn-accent fallback alone: OFF outlines, ON fills, PENDING rings. `packages/saturn/orchestrate`'s default (`active: false`) is untouched — out of this task's scope, and izzy's sign-off on that default landing verbatim in `scripts/harness/SATURN-HARNESS-ADDENDUM.md`'s "Always-orchestrate" section. The pending ring's accent color only fires for a queued ON target; a queued OFF reuses the resting hairline color, a known, documented gap (package README "Known Limitations").
