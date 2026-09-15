# @saturnai/dsh-client-ui-done

The definition-of-done chip: one Session-header utility seat carrying the current contract in a single line, with the whole record — statement, evidence, editor, turn receipt, and checkpoints — behind a click.

## Why it exists

Project doctrine says **"'Done' means proven. Tests pass, smoke passes, the thing actually runs — not hoped. Missing evidence is NOT_ASSESSED and never counts as green."** That law was private to the agent. This chip makes it a visible contract: the user always knows what the work is striving at, and whether it has been *proven* or merely *stated*.

It is not a renamed todo list. A todo is a step; a definition of done is the one- or two-sentence fence around all of them, written before the work and met with evidence at the end.

## The two states

| state | ring | label | chip line |
| --- | --- | --- | --- |
| `stated` | hollow white | `STATED` (white outline) | the statement |
| `proven` | filled white | `PROVEN` (white fill, black text) | the statement · the evidence |

The ring and label use `--saturn-accent`, with a neutral white fallback. Only a proven contract fills them; their labels and geometry keep the distinction readable without color.

A Session with no stated contract but a checkpoint a restore can put back keeps the seat: the chip reads the checkpoint title and the panel carries only that half. A Session with neither renders nothing.

## Composition

- `@saturnai/dsh-done` (host) owns the contract — the `done` session projection, the `done:policy` system-prompt section, the `/done` command, and the `set_definition_of_done` model tool.
- this package (client) owns only the display: the `conversation.session.header.utilities` seat, reading the `done` projection through the standard-kit `useProjection` and the Chat target's timeline through `useConversation`.
- every verb here is a `/done` command through `remote.commands.execute`, so the control and the slash command are one path with one logged result line.

The chip declares no slot of its own and needs no edit inside `ui-conversation`: `conversation.session.header.utilities` is a declared list seat. The record panel is drawn in a portal positioned against the chip, so the header's own clipping and stacking cannot cut it; an outside pointer, Escape, or the chip closes it.

## Geometry

The chip is sized to the header's own controls — a 28px minimum with 12px text — and is one ellipsised line, so it never grows the bar. Below 720px that line drops out and the ring, label, and chevron remain. The panel is a fixed 380px glass surface bounded to the viewport, so it stays one column on a narrow window instead of stretching the header.

## Commands

The chip writes statements as `/done -- <statement>`. The `--` escape keeps the wording literal, so a contract whose first word happens to be `clear`, `prove`, or `edit` is never read as a control word.
