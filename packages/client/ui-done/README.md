# @saturnai/dsh-client-ui-done

The definition-of-done strip: the first card in the composer context stack,
ahead of the todo, goal, and queue cards.

## Why it exists

Project doctrine says **"'Done' means proven. Tests pass, smoke passes, the
thing actually runs — not hoped. Missing evidence is NOT_ASSESSED and never
counts as green."** That law was private to the agent. This strip makes it a
visible contract: the user always knows what the work is striving at, and
whether it has been *proven* or merely *stated*.

It is not a renamed todo list. A todo is a step; a definition of done is the
one- or two-sentence fence around all of them, written before the work and met
with evidence at the end.

## The two states

| state | ring | chip | text |
| --- | --- | --- | --- |
| `stated` | hollow gold | `STATED` (gold outline) | the statement |
| `proven` | filled gold | `PROVEN` (gold fill) | the statement · the evidence |

Gold is earned: the filled chip and ring exist only for a proven contract.

## Composition

Three rows, one behavior each:

- `@saturnai/dsh-done` (host) owns the contract — the `done` session projection,
  the `done:policy` system-prompt section, the `/done` command, and the
  `set_definition_of_done` model tool.
- this package (client) owns only the display: the `conversation.input.dock`
  seat, reading the `done` projection through the standard-kit `useProjection`.
- every verb here is a `/done` command through `remote.commands.execute`, so the
  button and the slash command are one path with one logged result line.

The strip declares no slot of its own and needs no edit inside
`ui-conversation`: `conversation.input.dock` is a declared list seat.

## Fixed geometry

The bar is a fixed 52px box with a 40px two-line text region. A one-line
contract, a two-line one, the inline editor, and the stated → proven flip all
occupy exactly that box, so the composer below never moves.

## Commands

The strip writes statements as `/done -- <statement>`. The `--` escape keeps the
wording literal, so a contract whose first word happens to be `clear`, `prove`,
or `edit` is never read as a control word.
