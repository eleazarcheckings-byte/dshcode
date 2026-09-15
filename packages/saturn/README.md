---
description: "The Saturn group map: Agent Teams, checkpoints, claims, the design-brain connector, definition of done, multi-task orchestration, and SaturnBot, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/saturn

English | [中文](README.zh.md)

## Summary

The Saturn group carries the harness's Saturn AI-branded additions: peer-messaging Agent Teams with a durable mailbox and shared task DAG, content-addressed workspace checkpoints, a TTL-leased claims ledger that denies colliding writes before the first edit, an opt-in SaturnAI design-review connector, per-session definition of done, always-on multi-task orchestration, and SaturnBot — a persistent, role-bound autonomous operator. Every package here is scoped `@saturnai/dsh-*`; their browser-side presentation counterparts (`ui-agent-team`, `ui-done`, `ui-fleet`, `ui-orchestrate`, `ui-saturnbot`, `ui-brand-saturn`, `ui-skin-saturn`) live under [`client/`](../client/README.md) alongside every other UI plugin.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team`](agent-team/README.md) | Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG | `ctx.agentTeams` |
| [`tool-agent-team`](tool-agent-team/README.md) | Scoped model-facing Agent Teams tools over `ctx.agentTeams` | no service key |
| [`checkpoints`](checkpoints/README.md) | Per-session code checkpoints: content-addressed snapshot, `checkpoints` projection, and the `/checkpoint` restore command | no service key |
| `claims` | Enforced workspace claims: a durable, TTL-leased ledger of which agent owns which file surface (README has no Chinese counterpart yet) | no service key |
| [`design-brain`](design-brain/README.md) | Opt-in SaturnAI MCP connection with durable preference and verified Host tool availability | `ctx.designBrain` |
| `done` | Per-session definition of done: the `done` projection, the `done:policy` prompt section, the `/done` command, and `set_definition_of_done` (README has no Chinese counterpart yet) | no service key |
| `orchestrate` | Logged per-session multi-task (always-orchestrate) mode: the `orchestrate` projection, its policy prompt section, and the `/orchestrate` command (README has no Chinese counterpart yet) | no service key |
| [`saturnbot`](saturnbot/README.md) | Persistent role-bound SaturnBot execution cycles, approvals, and typed business tools | `ctx.saturnbot` |

-----

<a id="related-documentation"></a>
## Related documentation

- [`client/`](../client/README.md) — the Web-GUI browser half, including every Saturn-branded `ui-*` presentation package for the services in this group.
- [packages/AGENTS.md](../AGENTS.md) — package conventions: exports, service access, invariants, and tests.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
