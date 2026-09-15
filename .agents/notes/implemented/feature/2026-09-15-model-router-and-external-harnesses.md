# Agent Note: Model router, curated keyless providers, and gated native harnesses

Status: implemented

English | [中文](2026-09-15-model-router-and-external-harnesses.zh.md)

## Problem

Recon for the 2026-09-15 upgrade (SPEC §1, §3 C6) found only one LLM route mounted end to end: `deepseek-official`. `@deepseek-ai/dsh-llm-pi-ai` was mounted dormant in the base bundle — zero routes until a `llm-pi-ai:` settings section supplied provider profiles — so Settings → Models showed nothing to pick from on a fresh install. There was no deployment-wide notion of "tier" (a coordinator route vs. a bulk route vs. a vision route): every consumer that wanted a different model for different work had to name a route directly. And the native Claude Code / Codex subagent providers existed as fully built, tested packages (`@deepseek-ai/dsh-subagent-codex`, `@deepseek-ai/dsh-subagent-claude-code`) but shipped disabled everywhere — mounting either required hand-installing an optional Bundle and manually flipping a preset's `disabled: true` to `false`, with no deployment-level toggle and no guard against enabling a tool row with no Host provider behind it (or vice versa).

## Decision

**`@saturnai/dsh-model-router`** (new package, mounted in the base bundle) owns one settings namespace, `saturn-model-router`, with four tiers — `coordinator`, `specialist`, `bulk`, `vision` — each `{ provider, model, reasoningEffort? } | 'default'`, plus one `externalHarnesses` boolean (default `false`). `ModelRouterService.resolve(tier)` reads the live registration on every call: a tier left at `'default'` follows `ctx.get('agentDefaultModel')` when one is mounted (duck-typed, matching the SPEC §4 `ctx.modelRouter` contract), falling back to the packaged DeepSeek V4 Flash route only when no default-model service is mounted at all.

The same service answers `harnessAvailable(harness)` — a `require.resolve` probe against each harness's own npm package, anchored at the model-router module and cached per process — and `externalHarnessMounted(harness) = externalHarnessesEnabled() && harnessAvailable(harness)`. This single method is what every gate uses, so flipping the settings toggle alone can never surface a tool with no Host provider behind it, and installing the optional package alone (toggle still off) never mounts anything either. Package resolvability is deliberately the "CLI is absent" check — the `cordis` preset's own authoring skill documents both subagent packages as bundling their "package-local platform CLI", so there is no separate binary or `PATH` lookup to perform, and a synchronous `!!js` disabled expression could not `spawn`/await one anyway.

**`llm-pi-ai` curated keyless profiles** (base bundle `cordis.patch.yml`): the six pi-ai installed-catalog providers SPEC §3 C6 names — `anthropic`, `openai`, `google`, `xai`, `moonshotai`, `zai` — are each configured with an empty profile (`{}`): no `apiKeyEnv`, so every route is "configured-but-keyless" per the adapter's own documented behavior (it defers to pi-ai's provider-native ambient discovery and never surfaces a keyless route as an error). Two hand-declared local routes, `ollama-local` and `lm-studio-local`, each carry `api: openai-completions`, a `baseURL` pointed at the product's default local port, a placeholder `Authorization` header (so a keyless local server still gets a well-formed request), and one representative model id so the route is immediately selectable; a user's own settings-layer `models` override corrects the id for whatever their local server actually serves.

**Web bundle + `cordis` preset gating**: two new Host-plane rows in `packages/bundle/web-app/cordis.patch.yml` (`subagent-codex`, `subagent-claude-code`) each carry `disabled: !!js ctx.get('modelRouter')?.externalHarnessMounted(<name>) !== true`. The `cordis` preset's existing `tool-subagent-codex` / `tool-subagent-claude-code` rows (previously `disabled: true` unconditionally) now gate on the identical expression, so the Host row and the tool row can never disagree.

## Alternatives considered

**Derive "CLI is absent" from a `PATH` lookup or a spawn probe.** Rejected: both subagent packages bundle their platform CLI as an npm dependency rather than expecting a system install, and a `!!js` disabled expression is a synchronous `eval` that cannot await a spawned process.

**Hard-require `model` on the mounted `subagent-codex`/`subagent-claude-code` Host rows.** Rejected after reading their `Config` schemas: `model` has no default but the `apply()` code already treats it as optional (`config.model === undefined ? {} : ...`), matching the interface JSDoc ("omitted to inherit \[the product's] settings"). Mounting with no `config` — the exact shape the packages' own optional-Bundle `cordis.patch.yml` already ships — is therefore correct, not a gap.

**Fold external-harness gating into a single `disabled` boolean flag instead of a method.** Rejected in favor of `externalHarnessMounted(harness)` as one reusable check: a bare boolean flag invites a Host row and a preset tool row to each reimplement (and potentially desync) the `enabled && available` logic.

**Fall back to a hardcoded route when `'default'` cannot resolve, always.** Narrowed instead to falling back only when `agentDefaultModel` is entirely unmounted; when it is mounted, its live value is followed even as it changes, so raising the deployment default raises every un-overridden tier without a restart.

## Consequences

- Settings → Models has six real keyless catalog providers plus two local presets to pick from on a fresh install, with no settings edit required first.
- Every tier defaults to whatever the deployment's `agent-default-model` currently is; an explicit per-tier override survives a live settings update and is not clobbered by raising the deployment default.
- Enabling `saturn-model-router.externalHarnesses` mounts native Claude Code / Codex delegation only where the matching optional package is actually installed; a fresh install (`externalHarnesses: false`, no optional Bundle installed) mounts neither row.
- `packages/bundle/base/package.json` gained `@saturnai/dsh-model-router`; `packages/bundle/web-app/package.json` gained `@deepseek-ai/dsh-subagent-codex` / `-claude-code` as `optionalDependencies` — both need `pnpm install` / a lockfile refresh (integration item, this cell does not run `pnpm install`).
- `packages/saturn/model-router` is a new workspace package; it needs a `tsconfig.base.json` `paths` entry (root config this cell does not edit) before another package can import it by specifier — internal tests import it relatively (`../src/index.ts`) so this does not block verification here.
- Wiring `ctx.modelRouter.resolve('specialist')` into the real `tool-subagent` spawn path and into SaturnBot's planner/specialist model selection is unowned by this cell; see the C6 report's `integration_needs`.
- Composition coverage: `packages/saturn/model-router/tests/model-router.spec.ts` (settings defaults, `resolve()` fallback chain, live override, harness-toggle independence) and `packages/saturn/model-router/tests/bundle-compose.spec.ts` (the base/web-app/preset YAML shape, including `!!js` interpolation of the gating expression under a present/absent/true/false `modelRouter`); `packages/bundle/base/tests/model-router.spec.ts` (row presence, the fresh-install `workspace-write`+`ask` permission default) and `packages/bundle/base/tests/llm-pi-ai-profiles.spec.ts` (a real `dsh-llm-pi-ai` mount over the exact curated config, proving every catalog route lists models and neither local route throws at mount).

## Related decisions

This note is the C6 slice of the 2026-09-15 ten-cell upgrade recorded in `SPEC.md`; the Claude Code / Codex providers themselves, and the `cordis` preset's disabled-template authoring guidance in `packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md`, predate this note and are unchanged except for the two `disabled` expressions this note describes.
