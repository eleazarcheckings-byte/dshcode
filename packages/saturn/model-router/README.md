---
description: "Deployment-wide model tiering settings namespace and resolve() service, plus the toggle mounting native Claude Code / Codex subagent providers."
kind: "package-reference"
---

# @saturnai/dsh-model-router

English | [中文](README.zh.md)

## Summary

`@saturnai/dsh-model-router` owns one settings namespace, `saturn-model-router`, naming four routing tiers — `coordinator`, `specialist`, `bulk`, `vision` — each an explicit `{ provider, model, reasoningEffort? }` route or `'default'`. A caller asks `ctx.modelRouter.resolve(tier)` instead of hard-coding a route: a tier left at `'default'` follows whatever `agent-default-model` currently holds, so raising the deployment default raises every tier nobody has overridden yet. The same namespace carries `externalHarnesses`, a single toggle (off on a fresh install) that a Bundle row or preset tool row gates on to decide whether to mount the native Claude Code / Codex subagent providers — each still self-hides when its own package-local platform CLI package is not installed, so flipping the toggle alone can never surface a tool with nothing behind it.

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

Mount the plugin once on the Host plane (the shared base bundle carries it). Any later row — a subagent spawn, SaturnBot, a Bundle's `disabled` expression — reads `ctx.get('modelRouter')` duck-typed, so a composition that omits this package degrades to "no router" rather than failing to mount.

### Resolve a tier

```ts
const route = ctx.modelRouter.resolve('specialist')
// { provider: 'deepseek-official', model: 'deepseek-v4-flash' } until either
// the user sets `saturn-model-router.tiers.specialist` or raises the agent
// default model.
```

### Configure tiers

Edited through the namespace's Plugins settings card, or directly in `settings.yaml`:

```yaml
saturn-model-router:
  tiers:
    specialist: default
    bulk:
      provider: llm-pi-ai
      model: gpt-5-mini
      reasoningEffort: low
  externalHarnesses: false
```

| Field | Default | Meaning |
|---|---|---|
| `tiers.coordinator` | `'default'` | Route for orchestration-level work; follows the agent default model until overridden |
| `tiers.specialist` | `'default'` | Route subagent spawns ask for by default |
| `tiers.bulk` | `'default'` | Route for high-volume mechanical work |
| `tiers.vision` | `'default'` | Route for image-carrying requests |
| `externalHarnesses` | `false` | Mounts the native Claude Code / Codex subagent providers when their packages are installed |

### Gate a Bundle row or preset tool on external harnesses

```yaml
- id: subagent-codex
  name: '@deepseek-ai/dsh-subagent-codex'
  disabled: !!js ctx.get('modelRouter')?.externalHarnessMounted('codex') !== true
```

`externalHarnessMounted(harness)` is the one check every gate should use: it is `externalHarnessesEnabled() && harnessAvailable(harness)`, so a row using it never mounts from the toggle alone, and never mounts a tool for a harness package that failed to install.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ModelRouterService` registers the namespace through `ctx.settings.register`, which resolves schema defaults, the composition `base` (none here — every field has a schema default), and the user layer, in that order; `resolve()` reads the live registration on every call rather than caching a snapshot, so an edited namespace takes effect on the next resolve without a restart. Falling back to `agentDefaultModel` is a duck-typed `ctx.get('agentDefaultModel')` read rather than a hard dependency, matching the interface contract in SPEC §4 (`ctx.modelRouter`, C6 → C5/C8a): a composition that never mounts `agent-default-model` still resolves every `'default'` tier to the packaged DeepSeek V4 Flash fallback instead of throwing.

`harnessAvailable()` is a `require.resolve` probe against each harness's own npm package (`@deepseek-ai/dsh-subagent-codex`, `@deepseek-ai/dsh-subagent-claude-code`), anchored at this package's own module — the SKILL.md authoring guide for the `cordis` preset documents these as bundling their own "package-local platform CLI", so package resolvability IS the CLI-presence check, not a `PATH` lookup or a spawn probe. The result is cached per process: whether an optional dependency is installed does not change while a process is running, and a spawned probe would carry latency and side effects the disabled-expression evaluator (a synchronous `eval`) cannot await.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [llm-pi-ai](../../llm/llm-pi-ai/README.md) — the multi-provider adapter the curated keyless profiles in the base bundle populate.
- [agent-default-model](../../core/agent-default-model/README.md) — the deployment default a `'default'` tier falls back to.
- [Editing Cordis compositions](../../preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md) — the native-subagent Bundle-install pattern this package's toggle replaces with a settings flip.
- [settings](../../settings/settings/README.md) — the namespace registration seam.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package resolves routing and mount decisions for other Host plugins and never contributes prompt text, tool schemas, or model-visible content of its own.

#### KV Cache effect

Independent: this package holds no per-request or per-session state and reaches zero model requests directly. A tier's resolved `provider`/`model` selects which adapter and model id a consumer's own request uses, and changing a tier's route is a consumer-level change (a different model, sometimes a different provider) whose cache effect belongs entirely to that consumer's own adapter, not to this router.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No client card ships in this package** — the settings namespace resolves and validates correctly, but rendering it as an editable "Plugins" card is a `packages/client/*` contribution this package does not include; until one is added, the namespace is edited directly in `settings.yaml`.
- **`harnessAvailable()` caches for process lifetime** — installing a harness package after the process starts (outside the ordinary `pnpm install` + restart flow) is not observed until the next restart.
- **`resolve()` does not validate the target route exists** — an explicit tier override naming an unregistered provider or unknown model id is only caught when the consumer's own adapter rejects the request.
- **No per-tier reasoning-effort validation against the target model's capabilities** — an effort level the resolved model does not support is the consuming adapter's own failure mode (see `dsh-llm-pi-ai`'s `UNSUPPORTED_OPTION`/reasoning-capability handling).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- Wiring `ctx.modelRouter.resolve('specialist')` into the actual `tool-subagent` spawn path, and into SaturnBot's planner/specialist model selection, is a consumer-side change in packages this cell does not own (`tool-subagent`, `saturnbot`); see this cell's `integration_needs`.
- A `settings.plugin.item` client card for `saturn-model-router` — tier pickers plus the external-harnesses switch — is the natural companion to the `ui-settings-models` provider picker and is unbuilt here.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond the settings registration enforced at its owning seam.
