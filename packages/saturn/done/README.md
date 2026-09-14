# @saturnai/dsh-done

Per-session **definition of done**: one short, always-visible statement of what
is being built and how we will know it is finished — and the evidence that met
it.

This is the harness's "**'Done' means proven**" law made visible instead of
private. A definition of done is a contract, not a progress bar:

| status | meaning |
|---|---|
| `stated` | the contract is written; nothing has proven it yet |
| `proven` | the contract is met, and carries the one-line evidence that met it |

Amending the statement always resets it to `stated`, because a changed contract
must be proven on its own terms.

## What this package owns

| Piece | Role |
|---|---|
| `done` projection | folds the session log, so the contract survives resume and fork |
| `done:policy` section | the model reads the contract (or the instruction to state one) on every request |
| `/done` command | human control with no model turn |
| `set_definition_of_done` tool | how the model authors and proves it |

The durable event is `done/change` — log-only, non-surface, whole-value replace.
Its fold value is `null` until a contract is stated, so absence is honest.

## The three lanes of copy

- **No contract (`null`)** — the "always" default: state one first, in one or
  two sentences, before substantive work.
- **`stated`** — strive against it; prove it by running the thing and citing
  what you ran; leave it stated if you cannot.
- **`proven`** — settled work is not reopened; a changed contract loses its
  proof.

## Composition

Mount `@saturnai/dsh-done` on the host roster and
`@saturnai/dsh-client-ui-done` in the browser half. The command and tool attach
only when a `commands` / `tools` registry is composed; without them the plugin
still folds and still instructs, it simply cannot be authored from that side.

## Model Experience

The section is always non-empty for a live agent, so the model always knows
whether a contract exists, what it says, and what proving it requires.
`set_definition_of_done` is the only way the model authors it. The section text
varies per request with the folded value — no cache-busting, since an unchanged
contract renders an identical string.
