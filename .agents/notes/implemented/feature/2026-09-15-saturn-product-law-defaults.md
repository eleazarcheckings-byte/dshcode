# Agent Note: Saturn product-law defaults

Status: implemented

English | [中文](2026-09-15-saturn-product-law-defaults.zh.md)

## Problem

The shipped Team and multi-task defaults treated Saturn as a shared-directory always-orchestrate harness. A fresh session fanned out, eight teammates could share one cwd, and the web-app persona still named a generic coding agent. That fights the product claim: one thread until the user asks for a team, private checkouts unless sharing is opted into, and a roster small enough that "team" stays a team.

## Decision

Four defaults, restated only on the web-app keys they own plus the spawn and fold code those keys describe:

1. Teammate isolation defaults to `worktree`. `shared` is opt-in on `spawn_teammate`.
2. The Team roster cap is 4 (`agent-team` `maxMembers: 4`).
3. Multi-task mode folds inactive. Delegation tools stay registered. `/orchestrate on` or the composer toggle turns the mode on.
4. The web-app `system-prompt` persona names Saturn AI as the harness that proves its work. Preset-local personas stay the coding-agent text.

The [worktree isolation](2026-09-15-agent-team-worktree-isolation.md) mechanism is unchanged. The [team-per-task ON policy](../architecture/2026-09-15-team-per-task-then-standby.md) still describes what happens after the toggle is on.

## Alternatives considered

- **Keep `shared` as the spawn default** so previously recorded Teams stay bit-identical. Rejected: silent cross-member writes are the failure isolation exists to stop; opt-in sharing is the honest exception.
- **Cap the roster at 8.** Rejected: eight concurrent checkouts is a fleet, not a team the Lead can merge.
- **Default multi-task ON.** Rejected: a fresh session is a single thread; ON is the expensive team-per-task shape.
- **Put the Saturn persona on every preset.** Rejected: only the web-app deployment overlay owns product voice; a preset is a composition the user can replace.

## Consequences

New teammates get a private checkout unless the caller asks for `shared`. A workspace that is not a git repository still refuses worktree at spawn. A fresh session is a straight thread; ON still means team-per-task then standby. The persona change is web-app only.

## Verification

`packages/saturn/agent-team` tests pin the worktree default and the cap of 4. `packages/saturn/orchestrate` policy tests pin inactive init. `packages/saturn/tool-agent-team` schema text names worktree as the default.
