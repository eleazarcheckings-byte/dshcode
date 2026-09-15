---
description: "Opt-in Agent Teams profile layer over dsh-base, for base-backed profiles that want Team-scoped coordination tools while retaining one-shot delegation."
kind: "package-bundle"
---

# @saturnai/dsh-agent-team-profile

English | [中文](README.zh.md)

## Summary

`@saturnai/dsh-agent-team-profile` is an opt-in profile layer that enables [Agent Teams](../../saturn/agent-team/README.md) over `@deepseek-ai/dsh-base`. Its patch inserts the Team domain and Team-scoped tools, disables the overlapping global continuable-child controls, and keeps the ordinary fresh and fork delegation tools as one-shot operations. Add it explicitly to an initialized base-backed profile (headless, TUI, or a source checkout).

Do **not** stack it over the shipped Web bundle: `@deepseek-ai/dsh-web-app` already carries the three Team rows, and a second declaration of one `id:` makes the Loader throw `duplicate loader entry id`, failing the whole plugin tree. The rows have exactly one home — the shipped Web bundle patch for the Web surface, this layer for every base-backed profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

From this repository checkout, add the package to an initialized profile, then run a task that asks the Lead to delegate work:

```sh
pnpm dsh plugin --profile headless add ./packages/bundle/agent-team-profile
pnpm dsh --profile headless "Use Agent Teams to split this task between two teammates, wait, and summarize."
```

The profile must already contain `@deepseek-ai/dsh-base`, whose Subagent services and provider rows this layer consumes. Removing the package with `dsh plugin --profile <name> remove @saturnai/dsh-agent-team-profile` removes the bundle from the profile's ordered layer list.

### What you get

The layer adds the Agent Teams domain and its scoped creation, roster, messaging, interruption, waiting, and task-board tools. It disables the global continuable-child control rows whose tool names overlap with Team controls, while leaving `subagent` and `subagent_fork` available as one-shot delegation tools.

The shipped Web bundle already carries the same rows and the same disables, so this layer is for base-backed profiles only. Applying it over `dsh-web-app` declares `agent-team` and `tool-agent-team` twice and the Loader rejects the composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package's runtime content is [`cordis.patch.yml`](cordis.patch.yml). Applied after `dsh-base`, the patch disables `tool-subagent-control` and `tool-subagent-list-agents`; sets the fresh and fork Subagent rows to `one-shot`; and inserts the Team service and tool rows with explicit providers and limits.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Ordered patch over `dsh-base` |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |
| — | No runtime invariant companion is published; the package carries only a static profile patch. The Team domain and tool packages own the mutable relationships it activates. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Promotion record](../../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — placement, release family, and dependency isolation.
- [Agent Teams service](../../saturn/agent-team/README.md) — durable roster, messaging, and task-board behavior.
- [Agent Teams tools](../../saturn/tool-agent-team/README.md) — the Team-scoped model tool surface.
- [Base bundle](../../bundle/base/README.md) — the profile layer this patch extends.

-----

<a id="model-experience"></a>
## Model Experience

### Team policy and tools

#### What the model sees

The Team policy and schemas belong to [`@saturnai/dsh-tool-agent-team`](../../saturn/tool-agent-team/README.md). This bundle changes composition only: Team-scoped `list_agents`, `send_message`, and `interrupt_agent` replace the disabled global continuable-child controls. `subagent` and `subagent_fork` remain available as one-shot delegation tools, whose children do not receive the continuable-child `report` tool.

#### Token effect

The bundle adds the Team policy and tool schemas described by `dsh-tool-agent-team`; it adds no prompt text of its own.

#### KV Cache effect

The bundle's composition is prefix-stable while its patch, Team identity, and configured tool schemas remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Base-backed profiles only** — the shipped Web bundle owns the same rows. Stacking this layer over `dsh-web-app` declares `agent-team` and `tool-agent-team` twice, and the Loader rejects a repeated explicit id.
- **Shared checkout** — every teammate observes the same working directory; this bundle adds no worktree isolation or filesystem locking.
- **Base profile required** — the patch depends on row ids and Subagent providers supplied by `dsh-base`; it is not a standalone profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
