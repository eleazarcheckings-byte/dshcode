---
description: "Composer multi-task toggle: the conversation.input.left seat over the orchestrate projection and the /orchestrate command channel."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-orchestrate

English | [中文](README.zh.md)

## Summary

Multi-task toggle for the composer tool row: a two-state control occupying `conversation.input.left`, next to the permission trigger. State rides the host `orchestrate` projection through the standard-kit `useProjection`; the click executes `/orchestrate on|off` through `command.execute`, so the control and the slash command share one logged event and one result line. Multi-task behavior itself (the `/orchestrate` command, the `orchestrate` projection unit, the policy prompt section) is owned by `@saturnai/dsh-orchestrate`, composed independently on the host roster — this package is presentation only.

## Table of Contents

- [What it renders](#what-it-renders)
- [State contract](#state-contract)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-renders"></a>
## What it renders

The toggle renders both states — multi-task mode is off by default, so a control that appears only while active would hide the switch that turns it on. `aria-pressed` reports the state currently in force, never a queued target; a pending change is shown by a dotted label instead of painting the target state as if it had already landed. A failed toggle shows an inline, non-localized error string next to the button (error-surface policy: failure text stays English).

The component subscribes to the `orchestrate` session projection through `useProjection('orchestrate')`. When the host row is not composed, the projection key is simply absent and the component renders nothing — capability absence is the key's absence, never a special value.

-----

<a id="state-contract"></a>
## State contract

Three states, three distinct paintings — never color alone (izzy, 2026-09-16: "make sure the button indicates when its on /off it always looks like the same right now"):

| State | Class | Fill / border | Tag | `aria-pressed` |
|---|---|---|---|---|
| OFF | `.off` | transparent, hairline `--dsw-alias-border-l2` outline | `OFF` (muted ink) | `false` |
| ON | `.on` | filled `--saturn-accent`, no border | `ON` (`--saturn-void` ink) | `true` |
| PENDING | `.pending` (layers on top of `.off`/`.on`) | adds a dashed outline ring, colored by the queued `data-target` | tag stays the state in force | unchanged — still the state in force |

The `ON`/`OFF` mono tag (`toggle.tag.on` / `toggle.tag.off` — kept untranslated in both dictionaries, the same doctrine-token convention `@saturnai/dsh-client-ui-done`'s `VerdictCard` uses for `PASS`/`REVISE`/`REJECT`) sits beside the "Multi-task" label and survives the narrow-composer breakpoint that hides the label, so the state is always legible as text, never only as the fill color. `aria-pressed` and the tag always agree with `active`; a queued flip only adds the dashed `pending` ring plus the "applies next turn" title — it never repaints the chip as if the flip had already landed. The chip's background/border/color transition rides the shared `--saturn-dur-1` / `--saturn-ease-standard` motion tokens and is disabled under `prefers-reduced-motion: reduce`.

-----

<a id="composition"></a>
## Composition

Occupies `conversation.input.left` (a `list`-kind, session-scoped slot declared by `@saturnai/dsh-client-ui-conversation`) with `id: 'multi-task'` at `order: 10`, and registers the `orchestrate` locale namespace through `ctx.locale`. Both registrations ride `ctx.slots.inject`/`ctx.effect`, so the seat and its dictionary install and retract together whenever the declaring slot or the locale registry itself reloads under HMR — no stale entry can outlive the module that registered it. The Host export (`lib/index.js`) is an empty `apply()`: this package contributes no node-side behavior of its own, only the browser half shipped through `exports["./client"]`.

Required client services: `slots`, `remote`, `remote.commands`, `locale` (declared in `inject`).

-----

<a id="model-experience"></a>
## Model Experience

### Composer toggle presentation

#### What the model sees

Nothing from this package directly. Clicking the toggle executes `/orchestrate on|off` through the same `remote.commands.execute` path an operator's typed slash command would take; the command's own model-visible policy section and projection are owned by `@saturnai/dsh-orchestrate`, not by this presentation seat.

#### Token effect

None. The button, its labels, and its busy/error state are entirely browser-local; nothing this package renders is copied into a model request.

#### KV Cache effect

None directly. A successful toggle changes the `orchestrate` projection, which can change the policy section `@saturnai/dsh-orchestrate` assembles into a later prompt — that cache effect belongs to the command's own package, not to this seat.

## Known Limitations and Deferred Work

- The control has no independent state: a projection read failure or a missing `orchestrate` row renders nothing, with no distinct error affordance for "not composed" versus "loading."
- The toggle always targets the opposite of the state currently in force; there is no direct on/off pair of controls, only a single flip.
- Failure text is deliberately English-only (error-surface policy) and is not covered by the `orchestrate` locale namespace.
- The pending ring's color signals only a queued ON target (`--saturn-accent`); a queued OFF target reuses the resting hairline border color, so on that path the ring itself carries no extra signal — the title and `aria-pressed` still do.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
