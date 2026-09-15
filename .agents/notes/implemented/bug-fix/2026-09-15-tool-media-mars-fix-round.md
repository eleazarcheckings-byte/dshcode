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

## Round 3 addendum (same day) — the "blocking" gap above was avoidable, and is now closed

A second fresh-context Mars review (`round 2` of this fix) found that the `integration_needs` item this
note recorded above did not actually require an orchestrator decision: `ctx.userQuestions`
(`packages/interaction/user-questions`, `UserQuestionService.ask()`) declares its `agent` parameter
**optional** and already asks unscoped (`ctx.waterfall('user-questions/request', request, noAnswerer)`)
when none is supplied — entirely inside this package's own IN scope, and exactly the "interaction/
approval capability" SPEC §3 C7 already names.

**Fix applied:** `requireSpendApproval` (`src/index.ts`) now prefers `ctx.approval` when the call
carries an `Agent` (unchanged from Fix 1 above — `withAgent`'s binding still routes through it), and
falls back to a new `requireSpendApprovalViaUserQuestions` when it does not — asking one yes/no
question through `ctx.userQuestions.ask()`, carrying the identical estimated-cost line, with zero
network requests before the human answers, and failing closed on Decline, an aborted/timed-out ask, or
no answerer being composed (`NO_PROVIDER`) — exactly as the preferred route fails closed. Proven by a
new file, `tests/agentless-spend-approval.spec.ts` (committed RED first): (a) the cost line reaches the
question's `detail`, (b) zero requests before the answer, (c) Decline → no request + refused result,
(d) no answerer composed → still fails closed with a distinct message. `SaturnBot`'s `creative.generate`
call site (`BotMediaService` in `packages/saturn/saturnbot/src/contracts.ts`; the call itself in
`src/adapters/integrations.ts`) is now unblocked *without* SaturnBot needing an `Agent` object at all —
the blocking `integration_needs` item from Fix 1 above is closed, not merely re-described.

Also fixed this round, from the same Mars pass: the Dev Note misattributed-commit callout in this
package's README now names the exact hash (`78a06d26b1`); the SaturnBot citations in both the README
and this note cite by symbol (`BotMediaService`, the `creative.generate` call site) rather than by line
number, since the round-1 line numbers had already drifted by round 2's review.

`tsc -p packages/saturn/tool-media/tsconfig.json --noEmit` is still clean (after adding a
`packages/interaction/user-questions` project reference to this package's `tsconfig.json`, and the
matching `workspace:^` dependency to `package.json`); `vitest run packages/saturn/tool-media` is 65/65
green (62 + 3 new). `pnpm install` was not run (prohibited for this cell) — a manual
`node_modules` junction was created so the new dependency resolves for tests/`tsc` right now, but a real
`pnpm install` is needed for `pnpm-lock.yaml` to pick up the edge properly; reported in
`integration_needs`.
