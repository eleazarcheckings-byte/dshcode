# Agent Note: tool-media Mars fix round — a real `withAgent` binding, and the honest gaps left honest

Status: implemented

English | [中文](2026-09-15-tool-media-mars-fix-round.zh.md)

## Problem

A fresh-context Mars review of `packages/saturn/tool-media` (`@saturnai/dsh-tool-media`, SPEC §3 C7) returned REVISE with four required fixes: (1) `MediaService.generate()` throws "no agent to route the approval prompt through" for the exact SPEC §4 pinned single-argument call (`generate(req)`, no `exec`) — which is how the only known consumer, SaturnBot's `creative.generate`, actually calls it, so that call site is dead on arrival; (2) `media_motion_transfer`'s Higgsfield "Genjutsu" gap needed either a real endpoint or a written acceptance that it ships caller-configured; (3) the package's one implementation commit had edited a RED test file (a mock-route swap, not an assertion change, but still a process violation); (4) `src/types.ts` exported two runtime `const` arrays, violating this repo's types-only convention for that file.

## Decision

**Fix 1 (the blocking one) — `MediaService.withAgent(agent, defaults?)`.** Added to `src/index.ts`: binds the service to one calling `Agent`, returning a `BoundMediaService` (`{ generate(req): Promise<Job>; status(id): Promise<Job> }`) that matches the SPEC §4 pinned shape exactly — a consumer holding an `Agent` up front calls it with no `exec` parameter at all, and the real spend Gate still runs underneath. Proven by `tests/with-agent.spec.ts` (new file, committed RED first): the bound object's pinned-shape call succeeds through approval, the cost line still appears, and a rejected approval still throws closed.

This does **not** unblock SaturnBot's actual call site, and that is reported rather than silently patched: reading `packages/saturn/saturnbot/src/adapters/integrations.ts` and `contracts.ts` (both out of this cell's IN scope, read-only) shows SaturnBot has no `dsh-agent` `Agent` object anywhere in its own tool-execution model — its tools are gated up front by its own `roles`/`effect` central-approval mechanism (`ActionRequiredError`), not per-call against an interactive session. Requiring a second, independent `ctx.approval` prompt for a caller with no session-shaped identity is an architecture mismatch between two packages, not a missing binding this package can resolve alone from `packages/saturn/tool-media/**`. Recorded as a blocking `integration_needs` item with three concrete resolution options (a lightweight Agent-shim SaturnBot constructs once and binds via `withAgent`; accepting SaturnBot's own pre-dispatch approval as sufficient for this one call site; or a contract change to `BotMediaService`/`creative.generate`), for whoever owns the C7↔C8a wiring to decide.

**Fix 2 — Genjutsu re-verified, not guessed.** Re-fetched `docs.higgsfield.ai/docs/openapi.json` live this fix round: identical 50 paths, still no motion-transfer/object-swap/genjutsu operation. Also probed `docs/genjutsu`, `docs/motion-control`, `docs/models/genjutsu` directly — all 404 or redirect to the docs root (a client-rendered SPA with no static sitemap, so a non-JS fetcher cannot enumerate further). No written acceptance from izzy to ship a guessed path was available in this autonomous run, so the caller-configured behavior (`params.modelPath`/`params.body` required, refuses to guess) stands, now with both fetch results cited and dated in the README.

**Fix 3 — provenance, not a rewrite.** Git history cannot be rewritten after the fact; this fix round's own two commits (`test(saturn)` RED, then this `fix(saturn)`) are clean, and the README's Dev Note now names the prior misattributed commit explicitly for anyone auditing history later.

**Fix 4 — `src/types.ts` is types-only again.** `MEDIA_PROVIDER_IDS` and `MEDIA_KINDS` moved to `src/index.ts` (still exported under the same names from the same public entry point — no consumer-visible change); `types.ts` now carries only `MediaProviderId`/`MediaKind`/etc.

## Alternatives considered

**Silently patch SaturnBot's `integrations.ts` to construct an Agent shim and call `withAgent`.** Rejected: `packages/saturn/saturnbot/**` is C8a's IN scope, not this cell's; writing there would violate the exclusive-scope rule SPEC §3 states for every cell, even for a fix that would compile cleanly.

**Guess a Higgsfield Genjutsu path from the connected Higgsfield MCP's internal model ids (`hf_mult_motion_control`, `hf_mult_replace_object`).** Rejected again this round, for the same reason as the original build: those are the aggregator MCP's own internal ids, not a published REST path, and this package's craft bar is a verified contract or an honest refusal — never a guessed one.

**Drop the `exec` extension entirely and require every caller to have an `Agent`.** Rejected: that would make `ctx.media` unusable for any non-interactive-session caller by construction, not just SaturnBot; `withAgent` is the narrower, correct fix — it extends what a caller *can* do without changing what the pinned shape *is*.

## Consequences

Any consumer holding a real `dsh-agent` `Agent` can now use `ctx.media` exactly as SPEC §4 pins it, via `ctx.media.withAgent(agent)`. SaturnBot's `creative.generate` specifically remains unwired pending an orchestrator/C8a-owner decision among the three options above — this is a known, reported gap, not a silent one. `tsc -p packages/saturn/tool-media/tsconfig.json --noEmit` is clean and `vitest run packages/saturn/tool-media` is 62/62 green (up from 59, the three new `with-agent.spec.ts` tests). `doc-quick` on this package's README shows the same single pre-existing finding as before this round (the `docs/tool-catalog.md#saturnaidsh-tool-media` anchor, which only a repo-wide `doc-sync` regenerates) plus nothing new.
