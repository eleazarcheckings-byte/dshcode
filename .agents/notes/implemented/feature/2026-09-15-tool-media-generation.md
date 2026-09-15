# Agent Note: Media generation over gemini/openai/higgsfield behind a spend Gate

Status: implemented

English | [中文](2026-09-15-tool-media-generation.zh.md)

## Problem

SaturnAI had no path from a model call to Higgsfield-class image/video/motion-transfer output. SaturnBot's `creative.generate` was a single-endpoint webhook stub (`{kind, prompt}` → one configured URL) that could not express async job ids, per-provider parameters, cost estimates, or Genjutsu's reference/driving media — and nothing in the harness gated a generation call's real cost behind a human decision before spending it.

## Decision

New package `packages/saturn/tool-media` (`@saturnai/dsh-tool-media`), following `packages/vision/tool-describe-image`'s credential-seam/redirect-refusing-client shape: a `ctx.media` service with `generate(req, exec?)`/`status(id)`, three providers behind one seam (`src/providers/{gemini,openai,higgsfield}.ts`), and five model-facing tools (`media_generate_image`, `media_generate_video`, `media_generate_audio`, `media_motion_transfer`, `media_job_status`).

Every REST contract this package implements was fetched live with `curl` against the provider's own current docs on 2026-09-15, not carried from memory: Gemini's `interactions` image endpoint and Veo 3.1's `predictLongRunning` async video operation (`ai.google.dev/gemini-api/docs/{image-generation,veo,pricing}`), and Higgsfield's full async job API (`docs.higgsfield.ai/docs/*`, its published `openapi.json`). `src/pricing.ts` carries a verified price table with the exact source URL and date for every entry it can state; where a price or contract could not be honestly verified this session (OpenAI's per-image cost, Higgsfield's Genjutsu REST path, gemini/openai audio), the corresponding tool requires an explicit caller-supplied value or refuses to run, rather than guessing.

Every call requests approval through `ctx.approval` — cost spelled out in the reason — before its billable network request, unconditionally (no permission preset skips it, since no provider here is free); a missing agent or approval service fails the call closed. `MediaService.generate()` extends the SPEC-pinned `generate(req): Promise<Job>` signature with an optional second `exec` parameter carrying the agent/callId/signal `ctx.approval` needs to route its prompt — the pinned single-object `req` has no room for an `Agent`, and approval fundamentally requires one.

## Alternatives considered

**Force everything through the existing `creative.generate` webhook shape.** Rejected: that shape cannot express an async job id, per-provider parameters (aspect ratio, duration, reference/driving media), or a cost estimate, and none of the three real providers' contracts match a single `{kind, prompt}` → one URL shape.

**Guess the Higgsfield Genjutsu REST path from the connected Higgsfield MCP's internal model ids.** Rejected: `hf_mult_motion_control`/`hf_mult_replace_object` are the aggregator MCP's own internal ids, not a REST path, and Higgsfield's public `openapi.json` (50 endpoints, fetched this session) names no motion-transfer/object-swap operation. `media_motion_transfer` requires an explicit `params.modelPath`/`params.body` instead.

**Split Higgsfield's two-part credential into two config fields.** Rejected: SPEC §3 C7 names one credential (`HIGGSFIELD_API_KEY`); the single value instead holds the already-combined `"{key_id}:{key_secret}"` string Higgsfield's own `Authorization: Key {id}:{secret}` header wants, split by `parseHiggsfieldCredential`.

## Consequences

`ctx.media` is available to any composition that mounts this package and configures at least one provider's credentials; SaturnBot's `creative`/`growth` roles (or any other consumer) can call `ctx.media.generate(req)` against the pinned interface and get a real, working generation — gated by approval — instead of a stub. `media_generate_audio` and `media_motion_transfer` both require an explicit `params.modelPath` today (documented, not silent); wiring a verified default for either is a small, isolated follow-up once the corresponding contract is confirmed. `docs/tool-catalog.md` needs a `doc-sync` regeneration to pick up the five new tool schemas (tracked as an integration item, not done here — this package's own scope is `packages/saturn/tool-media/**` only).
