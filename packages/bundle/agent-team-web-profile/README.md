---
description: "Agent Teams browser layer for a Web composition that does not already mount the shipped dsh-web-app Team rows."
kind: "package-bundle"
---

# @saturnai/dsh-agent-team-web-profile

English | [中文](README.zh.md)

## Summary

`@saturnai/dsh-agent-team-web-profile` is the Web layer for [Agent Teams](../../saturn/agent-team/README.md): one `insert` that adds the `ui-agent-team` row for [`@saturnai/dsh-client-ui-agent-team`](../../client/ui-agent-team/README.md).

The shipped `@deepseek-ai/dsh-web-app` bundle already owns that row, together with the Team service and tool rows, so a stock Web profile needs nothing from this package. Add it only to a Web composition that mounts the browser surface without the bundle's own Team rows, and never on top of them: a second declaration of the `ui-agent-team` id makes the Loader throw `duplicate loader entry id`, failing the whole plugin tree. The row has exactly one home per composition.

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

From this repository checkout, add the Web layer to an initialized `web` profile whose composition does not already mount the shipped Team rows:

```sh
pnpm dsh plugin --profile web add ./packages/bundle/agent-team-web-profile
```

For a base-backed (non-Web) profile the Host Team layer is [`@saturnai/dsh-agent-team-profile`](../agent-team-profile/README.md); a stock Web profile needs neither, because `@deepseek-ai/dsh-web-app` already declares all three rows. Removing the package with `dsh plugin --profile web remove @saturnai/dsh-agent-team-web-profile` removes the Web layer from the profile's ordered bundle list.

### What you get

The conversation header gains the Team roster, shared task board, and teammate navigation. [`@saturnai/dsh-client-ui-agent-team`](../../client/ui-agent-team/README.md) owns those browser interactions and mounts the generated Client Remote namespace used to reach the Host Team service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package's runtime content is [`cordis.patch.yml`](cordis.patch.yml). Applied after `dsh-web-app` and the Host Agent Teams layer, its single `insert` entry adds the `ui-agent-team` row for `@saturnai/dsh-client-ui-agent-team`. The inserted Client plugin owns the generated Remote assembly and Team UI; this static bundle holds no mutable state and installs no runtime invariant.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Ordered Web patch containing the `ui-agent-team` row |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |
| — | No runtime invariant companion is published; the package carries only a static profile patch. The Remote assembly and Team UI own their activation requirements. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Promotion record](../../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — placement, release family, and dependency isolation.
- [Agent Teams Host profile](../agent-team-profile/README.md) — the base-backed domain, Remote, and model-tool layer.
- [Agent Teams browser UI](../../client/ui-agent-team/README.md) — roster, task-board, and teammate-navigation behavior.
- [Web bundle](../../bundle/web-app/README.md) — the browser layer that owns the shipped Team rows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host-side Agent Teams profile selected alongside this Web layer.

#### KV Cache effect

This Web bundle adds no model request content; the Host-side Team tools own prompt, schema, and cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Ordered composition** — when this layer is used at all, it mounts after the composition's own `dsh-web-app`-equivalent base, and the `ui-agent-team` id must not also come from that base.
- **Preset-scoped legacy controls** — stable Web presets still mount continuable Subagent controls inside the preset scope. Top-level Host profile overrides do not replace those scoped registrations, so the Team roster and legacy child controls can both appear until Web has a Team-aware preset. The [Web Agent Teams decision](../../../.agents/notes/implemented/feature/2026-08-06-agent-teams-web.md) records this deferred composition work.
- **Shipped surface owns the row** — `@deepseek-ai/dsh-web-app` declares `ui-agent-team`, so a stock Web profile already shows the panel and must not also add this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
