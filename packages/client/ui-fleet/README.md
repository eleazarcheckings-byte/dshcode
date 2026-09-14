# @saturnai/dsh-client-ui-fleet — the fleet route surface

The product delegates by default, so parallel delegated work has to be readable
at a glance. The sidebar deliberately hides subagent sessions, which made a
fan-out look exactly like losing control of your own session. This package is
the surface that closes that gap: **one honest, fact-derived line per delegated
worker**, in the conversation the fleet belongs to.

## What a line says

| State | Line | Fact it is derived from |
|---|---|---|
| `waiting-for-you` | the pending need in the product's own words (`Waiting for approval`, `Plan awaiting review`, `Waiting for your answer`, else `Waiting for you`) | the pending-interaction map a Session-scoped UI consumer publishes |
| `blocked` | `Blocked on <X>` | the worker's own goal `phase === 'blocked'` with the host-authored `blockedReason.message`, or a background job it holds whose status is `failed` (its label names the thing) |
| `running` | `Running` | the list row's `running` bit |
| `done` | `Done` | the list row's completion reminder (the sidebar's green "done" dot) |

Precedence is a fact order, not a presentation choice: a human decision
outranks every other stop, a declared blocker outranks plain activity, and
activity outranks settlement. A settled worker with no news earns **no line** —
so zero lines is a legitimate answer, and the empty state is a designed line in
the same ambient register as the stats line beside it.

Nothing else is projected: no count, no percentage, no elapsed time, no token or
cost figure, no second metric per row. Colour is never the only signal — every
dot stands beside a word, so the fleet is readable without the palette.

## Where it is mounted

`conversation.composer.dock` — the declared **ambient** list seat below the
composer card (`packages/client/ui-conversation/src/client/contract/slots.ts`),
the seat the stats line already occupies, at `order: 10` so it appends *below*
the shipped entry and moves nothing already on screen.

This is deliberately **not** `conversation.input.dock`: that seat is the context
card stack (todo → definition of done → goal → queue) a prior inventory refused
to keep growing. The fleet adds no card — no border, no background, no second
metric — it is the dock's ambient tier, and the draft lines up with the message
column axis (`--dsh-chat-content-width`) like the stats line.

## Read models it folds (it owns no state)

| Fact | Source |
|---|---|
| delegated subtree, labels, `running`, completion reminder | `SessionListState.byId`, walked with the same subagent-origin discipline as `packages/client/ui-subagent/src/client/subagent-lineage.ts` |
| goal blocked phase + reason | the list row's own `projectionValues.goal` (`@deepseek-ai/dsh-goal`) |
| failed background job | `SessionListState.jobsBySession` (`@deepseek-ai/dsh-api-session-controller`) |
| human is needed | `useSessionPendingInteraction` (`@deepseek-ai/dsh-client-ui-session`) |
| navigation | `ctx.sessions.subagentAddress(id)` → `openSubagent(address)`, else `ctx.sessions.open(id)` |

No host-side state, no projection, no tool, no transport.

## Roster row

```yaml
- insert:
    - id: saturn-fleet
      name: '@saturnai/dsh-client-ui-fleet'
```

Client-only package: the node half's `apply` is intentionally empty, and the
browser half ships through `exports["./client"]` / `dsh.client`. Keep this row in
`~/.dsh/profiles/web/cordis.patch.yml` with the other Saturn rows.

## Tests

```
pnpm vitest run packages/client/ui-fleet
```

`tests/fleet.client.spec.ts` proves the fold (state → line, precedence, the
subtree walk, the empty case); `tests/fleet-route.client.spec.tsx` proves the
seat (empty state, one line per worker, the accessible name, activation).
