---
description: "The definition-of-done chip: the contract in the Session header, its provenance, and the reviewer's verdict card behind a click."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-done

English | [中文](README.zh.md)

## Summary

One Session-header utility seat carrying the current contract on a single line, with the whole record — statement, evidence, provenance, the independent reviewer's verdict card, the turn receipt, and the checkpoints a restore can put back — behind a click. Doctrine says "'Done' means proven"; this is where that stops being private to the agent and becomes something a reader can check.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this package in the browser half beside `@saturnai/dsh-done` on the host. It occupies the declared `conversation.session.header.utilities` list seat, reads the `done` projection through the standard-kit `useProjection` and the Chat target's timeline through `useConversation`, and runs every verb as a `/done` command through `remote.commands.execute` — so the control and the slash command are one path with one logged result line.

| state | ring | label | chip line |
| --- | --- | --- | --- |
| `stated` | hollow | `STATED` (outline) | the statement |
| `proven` | filled | `PROVEN` (filled) | the statement · the evidence · the provenance |

A proven contract never shows the word alone. The chip carries its provenance beside the status: `receipt <tool>` for a contract proven by a run, `countersigned` for one an independent reviewer passed, and `attested by you` for a human attestation at the command. A countersigned contract opens the reviewer's whole rubric in the panel: the stamped verdict, who graded it, their summary, and one scored line per criterion with the evidence that earned it.

A Session with no stated contract but a checkpoint a restore can put back keeps the seat, reading the checkpoint title instead. A Session with neither renders nothing.

Statements are written as `/done -- <statement>`; the `--` escape keeps the wording literal, so a contract whose first word happens to be `clear`, `prove`, or `edit` is never read as a control word.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip is sized to the header's own controls — a 28px minimum with 12px text — and is one ellipsised line, so it never grows the bar; below 720px the statement and the provenance drop out and the ring, label, and chevron remain. The record panel is a fixed 380px glass surface drawn in a portal positioned against the chip, so the header's own clipping and stacking cannot cut it, and an outside pointer, Escape, or the chip closes it. Escape returns focus to the chip, except while the inline editor owns it.

The verdict card is presentational by construction: everything it draws comes from the durable proof the `done` projection already carries, so it performs no read of its own and cannot disagree with the bar. Its one motion is an assertion rather than decoration — on a PASS the signature ring draws itself once, at the product's -18° tilt, in `currentColor`; under reduced motion it is simply already drawn.

`provenance` is a pure function shared by the chip and the panel, so the two surfaces can never describe the same proof differently.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Definition of done](../../saturn/done/README.md) — the host half: the projection, the policy section, the command, and the proof gate.
- [Independent review](../../saturn/review/README.md) — the reviewer whose rubric this card renders.
- [Checkpoints](../../saturn/checkpoints/README.md) — the restore row folded into the same panel.

<a id="model-experience"></a>
## Model Experience

### Contract state, rendered for a reader

#### What the model sees

Nothing from this package. Every model-facing surface of the contract belongs to `@saturnai/dsh-done`: the `done:policy` section, the `set_definition_of_done` schema, and the `/done` command results. This package draws the same durable `done` projection for a human and registers no prompt section, tool, or tool result of its own.

#### Token effect

Zero direct token effect. The provenance line and the verdict card are read from state the host already carries, so rendering them adds nothing to any request.

#### KV Cache effect

Independent: no request tokens originate here, so nothing this package renders can invalidate a prefix.

## Known Limitations and Deferred Work

- **The verdict card shows the review, not the work.** It renders what the reviewer recorded; a reader who wants the underlying run still goes to the transcript.
- **Provenance is truncated in the bar.** A long tool name is ellipsised to keep the header one line; the full text is in the panel and in the chip's title.
- **The panel is one fixed column.** At 380px it never stretches the header, which also means a long rubric evidence line wraps rather than widening.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.md) explains why "proven" alone was judged too weak a claim to render, and where the provenance vocabulary is owned.

</details>
