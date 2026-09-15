---
description: "ctx.media and five model-facing tools for image/video/audio/motion-transfer generation over gemini, openai, and higgsfield — every paid call gated behind ctx.approval (or the agentless ctx.userQuestions fallback) before the network call fires."
kind: "package-reference"
---

# @saturnai/dsh-tool-media

English | [中文](README.zh.md)

## Summary

**Higgsfield-class media generation for the Saturn AI harness.** `ctx.media` is one seam over three provider backends — **gemini** (image via the `interactions` REST endpoint, video via Veo 3.1's `predictLongRunning` async operation), **openai** (image, optional), **higgsfield** (the async job API at `docs.higgsfield.ai`, the only provider wired for motion-transfer/object-swap) — exposed to the model as `media_generate_image`, `media_generate_video`, `media_generate_audio`, `media_motion_transfer`, and `media_job_status`. Every provider in this package's scope costs real money; every call therefore requests approval before the billable network request fires, regardless of any permission preset — through `ctx.approval` (preferred, when the call carries an `Agent`) or `ctx.userQuestions` (the agentless fallback, for a caller like SaturnBot with no `Agent` anywhere in its own model), each showing the estimated USD cost line — and fails closed (never silently spends) when neither route is available to ask through. Generated assets are written under `<workspace>/.saturn/media/` and returned as file references, never as inline bytes to the model.

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

Install the plugin and configure whichever provider blocks the deployment has credentials for; a provider with no config block is simply unavailable (its tools still register, but any call routed to it fails with a clear credential error, never a crash).

### When to choose it

Choose this package for model-facing image, video, audio, or motion-transfer/object-swap generation that must (a) go through a real, verified provider contract rather than a guessed one, and (b) never spend money without an explicit human approval showing the cost. Skip it for the Mac/local `$0` generation lane (a separate, unrelated tool) or for a deployment that will never fund any of the three providers below.

### Minimal configuration

```yaml
- id: tool-media
  name: '@saturnai/dsh-tool-media'
  config:
    gemini:
      apiKey: !!js process.env.GEMINI_API_KEY
    higgsfield:
      apiKey: !!js process.env.HIGGSFIELD_API_KEY   # "{key_id}:{key_secret}", see below
```

The tool table:

| Tool | Args | Behavior |
|---|---|---|
| `media_generate_image` | `prompt` (string), `provider?`, `model?`, `params?` | Generates one image. Default provider `gemini` (`gemini-3.1-flash-image`, $0.067/1K image, verified 2026-09-15). |
| `media_generate_video` | `prompt`, `provider?`, `model?`, `params?` | Generates one short video. Default provider `gemini` (Veo 3.1, $0.40/s standard — see the price table for the fast/lite tiers). `params` accepts Veo's own `aspectRatio`, `durationSeconds` (`"4"`\|`"6"`\|`"8"`), `resolution`, `personGeneration`, and a base64 `image` for image-to-video. |
| `media_generate_audio` | `prompt`, `provider?`, `model?`, `params?` | Routes to `higgsfield` only; **requires** `params.modelPath` (see Known Limitations). |
| `media_motion_transfer` | `prompt`, `model?`, `params?` | Higgsfield-only "Genjutsu"-class motion-transfer/object-swap; **requires** `params.modelPath` and `params.body` (see Known Limitations). |
| `media_job_status` | `id` (string) | Re-reads a previously resolved job by the id an earlier call returned. |

Config keys per provider (all under `gemini:` / `openai:` / `higgsfield:`):

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | — | Inline credential. `gemini`/`openai`: the API key. `higgsfield`: the combined `"{key_id}:{key_secret}"` string (see below). |
| `apiKeyEnv` | `GEMINI_API_KEY` / `OPENAI_API_KEY` / `HIGGSFIELD_API_KEY` | Credential-seam reference resolved when `apiKey` is absent. |
| `baseURL` | provider's documented base | Root of the REST endpoint. |
| `imageModel` / `videoModel` / `imageModelPath` | provider's current default model | Overridable per deployment. |
| `timeoutMs`, `pollIntervalMs`, `pollTimeoutMs` | provider-appropriate | Per-request timeout and async-job polling budget. |

**Higgsfield's credential is two parts, joined by one colon.** `docs.higgsfield.ai/docs/authentication` (verified 2026-09-15) wants `Authorization: Key {key_id}:{key_secret}` — not a single bearer token. Rather than add a second config field (which SPEC §3 C7 does not name), the single `HIGGSFIELD_API_KEY` credential holds the already-combined `"{key_id}:{key_secret}"` string; `parseHiggsfieldCredential` splits it on the first colon.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

**The spend Gate.** `MediaService.generate()` resolves the call's cost — a verified table lookup for gemini, a required explicit override for openai (no verified price was captured this session), a **live** `POST /estimate/{modelPath}` quote for higgsfield — then asks before any billable call: `ctx.approval.request({ agent, toolName, callId, reason, signal })` when the call carries an `Agent` (the preferred route), or `ctx.userQuestions.ask({ questions: [...], agent?, signal? })` when it does not (the agentless fallback — see below); either way the cost is spelled out in the prompt (`Generate image via gemini/gemini-3.1-flash-image — estimated cost $0.067 USD. Prompt: "…"`). Only an explicit approval proceeds; a decline, a cancellation, an unavailable/unanswered prompt, or neither route being composed at all each throw before touching the network — there is no permission preset that bypasses this, because this package has no free provider. The one documented nuance: Higgsfield's `/estimate` call is itself free and read-only (`docs.higgsfield.ai/docs/concepts/billing-and-retention`), so it runs *before* approval to populate the cost line; the billable `POST /{modelPath}` submission never does.

**Redirect policy.** Every credential-bearing request uses `redirect: 'error'` (`fetchNoRedirect`), matching `tool-describe-image`'s convention — a bearer/API key can never be forwarded to a host the deployment did not configure. The one documented exception is Gemini's own Veo video-download step: Google's `ai.google.dev/gemini-api/docs/veo` quickstart follows a redirect on the signed `video.uri` while still sending the `x-goog-api-key` header, so `fetchAllowingRedirectTo` allows exactly one hop, and only back onto the configured `baseURL`'s own host — a redirect to any other host throws.

**Providers behind one seam** (`src/providers/{gemini,openai,higgsfield}.ts`), each independently unit-tested against a local HTTP fixture (no live network calls in tests): `gemini.ts` implements the `interactions` image endpoint and the Veo `predictLongRunning` submit → poll → download flow; `openai.ts` implements `images/generations`; `higgsfield.ts` implements submit/status/cancel/estimate/poll against the async job API. `MediaService` (`src/index.ts`) is the seam: it resolves a provider per call, gates the network call behind approval, writes the resulting bytes under `<workspace>/.saturn/media/<uuid>.<ext>`, and caches every terminal job by id so `media_job_status` can re-read it later.

**The spend Gate has two routes, and the pinned shape needs both.** SPEC §4 pins `ctx.media`'s `generate(req): Promise<Job>` to a single-object signature with no room for an `Agent` — a call in exactly that shape, with no second argument, still type-checks and runs. `ctx.approval` (the preferred route, used whenever the call carries an `Agent` — via an optional second `exec` parameter, or via `MediaService.withAgent(agent, defaults?)` for a consumer that holds one up front) fundamentally requires an `Agent` to route its prompt and audit trail through. SaturnBot's real `creative.generate` call site — the pinned shape's only known consumer — has no `Agent` anywhere in its own execution model, so for that caller the Gate falls back to `ctx.userQuestions` instead: it accepts an undefined agent and asks unscoped, carries the identical estimated-cost line in the question's `detail`, and fails the call closed exactly as the preferred route would — a missing `userQuestions` service, a composed service with no answerer (`NO_PROVIDER`), an aborted ask, or an explicit Decline all throw before any network call. Both routes are implemented entirely inside this package (`requireSpendApproval` / `requireSpendApprovalViaUserQuestions` in `src/index.ts`); `MediaService.withAgent(agent, defaults?)` still returns a `BoundMediaService` — `{ generate(req): Promise<Job>; status(id): Promise<Job> }` — matching the pinned shape exactly for a consumer that DOES hold an `Agent`, routed through the preferred `ctx.approval` path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md)
- [Approval seam](../../interaction/user-approval/README.md)
- [User-questions seam (the agentless fallback)](../../interaction/user-questions/README.md)
- [Credentials seam](../../credentials/credentials/README.md)
- [`tool-describe-image`](../../vision/tool-describe-image/README.md) — the credential-seam/redirect-refusing-client template this package follows
- Gemini: [Image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Veo](https://ai.google.dev/gemini-api/docs/veo), [Pricing](https://ai.google.dev/gemini-api/docs/pricing) — all fetched live 2026-09-15
- Higgsfield: [API docs](https://docs.higgsfield.ai/docs) — fetched live 2026-09-15 (quickstart, authentication, requests/lifecycle, polling, errors, billing-and-retention, `openapi.json`)
- [Adding a package with a tool](../../../docs/cookbook/adding-a-package.md)

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The generated schemas for `media_generate_image`, `media_generate_video`, `media_generate_audio`, `media_motion_transfer`, and `media_job_status` in the [tool catalog](../../../docs/tool-catalog.md#saturnaidsh-tool-media). Each generation tool's description states that it costs money and that approval is required; provider endpoints, credential names, and internal polling parameters are not model-facing.

#### Token effect

Fixed schema cost per request while the five tools are registered.

#### KV Cache effect

Prefix-stable while the schemas and descriptions are unchanged.

### Result

#### What the model sees

A `MediaJob` value (`id`, `status`, `assets: [{path, mimeType, url?}]`, `cost: {estimatedUsd, provider, model}`, `error?`) rendered as a short text summary naming the job id, status, resolved cost, and each asset's workspace path — never the asset bytes themselves. A rejected/cancelled/unavailable approval, or a provider/config error, surfaces as a `media:`-prefixed error message naming the specific cause.

#### Token effect

Data-dependent per call; the tools add no persistent prompt sections beyond their own schemas.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`ctx.get('media')`'s only known consumer (SaturnBot's `creative.generate` tool, calling `BotMediaService` from `packages/saturn/saturnbot/src/contracts.ts`) calls the pinned single-argument shape directly and can never supply an `Agent`** — verified by reading the call site in `packages/saturn/saturnbot/src/adapters/integrations.ts` (`media.generate({ kind, prompt, workspace })`, no second argument) and the `BotMediaService` interface itself (the pinned shape, verbatim). Resolved this round: a call with no `exec.agent` now falls back from the preferred `ctx.approval` route to `ctx.userQuestions` (see "The spend Gate has two routes" above), which accepts an undefined agent and asks unscoped — matching exactly SaturnBot's own execution model, which has no `Agent` object anywhere. `MediaService.withAgent(agent)` remains the answer for a *different* kind of consumer — one that DOES hold a real `dsh-agent` `Agent` — and still routes through the preferred `ctx.approval` path.
- **Genjutsu (motion-transfer/object-swap) has no published REST path** — `docs.higgsfield.ai`'s public `openapi.json` (50 endpoints, fetched 2026-09-15 and **re-fetched this fix round**, same 50 paths, still no match) names no motion-transfer/object-swap/genjutsu operation; direct guesses at doc pages (`docs/genjutsu`, `docs/motion-control`, `docs/models/genjutsu`) all 404 or redirect to the docs root (a client-rendered SPA with no static sitemap, so this is as far as a fetcher without a JS runtime can confirm). Only the separate, already-connected Higgsfield MCP integration exposes it as internal model ids (`hf_mult_motion_control`, `hf_mult_replace_object`), which is a different integration surface from this package. `media_motion_transfer` requires the caller to supply the exact `params.modelPath` and `params.body` rather than guess a URL; once Higgsfield publishes the endpoint, wiring a real default is a small follow-up (change the one guard in `generateWithHiggsfield`, not the surrounding architecture). This stands as the honest choice absent a written decision from izzy to ship a guessed path instead.
- **No verified OpenAI per-image price** — the public pricing page did not serve static content to this session's fetcher (redirect with no body); the endpoint and current model ids (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2`) were confirmed live against `developers.openai.com`, but `media_generate_image` with `provider: 'openai'` requires an explicit `params.pricePerImageUsd` and refuses to guess. A follow-up session should re-fetch OpenAI's pricing page (or its API's own cost-reporting field, if one exists) and remove this requirement.
- **`generate()` blocks to a terminal job rather than returning `'queued'` immediately** — including polling Higgsfield's status endpoint and Veo's long-running operation internally, bounded by each provider's `pollTimeoutMs`. `media_job_status` therefore mostly re-reads an already-cached terminal result rather than resuming a genuinely in-flight poll; a caller that wants true fire-and-forget (submit now, poll later, possibly from a different process) needs a follow-up that persists the tracked-job map outside process memory. This was a deliberate scope decision for this session, not an oversight — see the class doc on `MediaService`.
- **No audio contract verified for gemini/openai** — Gemini's pricing page names TTS/music models (`gemini-3.1-flash-tts-preview`, `Lyria 3.5`) and OpenAI has its own audio APIs, but neither's request/response contract was fetched this session; `media_generate_audio` routes only through `higgsfield` (itself requiring an explicit `params.modelPath`, per the Genjutsu gap above — the public `openapi.json`'s 50 paths list no obvious audio endpoint either, though the status schema's `audio`/`audios` output fields imply one exists on some account tier).
- **No `x-goog-api-key`/`Authorization` value ever logged** — but this package does not itself redact them from a process-wide debug/trace log a *different* plugin might install; that responsibility sits with whatever logging layer is composed, same as `tool-describe-image`.
- **Webhook delivery is not implemented** — Higgsfield supports an `hf_webhook` query parameter for push-based completion notice (`docs.higgsfield.ai/docs/how-to/webhooks`), which would avoid the polling budget above; this package has no inbound HTTP surface to receive one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Built 2026-09-15 as SPEC §3 C7 of the SaturnAI upgrade fan-out. Every REST contract this package implements (Gemini `interactions` + Veo `predictLongRunning`, Higgsfield's full async job API) was fetched live with `curl` against the provider's own current docs this session, not carried forward from training-time memory or a third-party aggregator; every price in `src/pricing.ts` carries the exact source URL and a `2026-09-15` `verified` date. Where the docs did not show a contract clearly enough to implement honestly (OpenAI pricing, Higgsfield's Genjutsu endpoint, gemini/openai audio), this package says so in code and here rather than guessing.

**Fix round 1 (same day).** A fresh-context Mars review required four changes, all applied: (1) `MediaService.withAgent(agent)` added (tested in `tests/with-agent.spec.ts`, committed RED first) so a consumer holding an `Agent` can use the SPEC §4 pinned single-argument shape without threading `exec`; SaturnBot's actual call site was read and found to have no `Agent` anywhere in its own model, so at the time this stayed a documented `integration_needs` item rather than a code change guessed from outside this package's IN scope. (2) `MEDIA_PROVIDER_IDS`/`MEDIA_KINDS` moved from `types.ts` into `index.ts` (types-only `src/types.ts` is this repo's own package convention). (3) The Genjutsu absence was re-verified live (same result). (4) One prior commit, `78a06d26b1` ("docs(saturn): re-record translation-pairing sidecars for hygiene-docs READMEs"), carried this package's `feat` diff inside a sibling cell's commit (a shared-git-index hazard, not a tampering issue — the sole test-file hunk it touched only swapped a mock's response shape, not an assertion); called out here since the git history itself cannot be rewritten after the fact.

**Fix round 2 (same day).** A second fresh-context Mars review found the round-1 `integration_needs` item above was avoidable: `ctx.userQuestions` (`packages/interaction/user-questions`) declares its `agent` parameter optional and already asks unscoped when none is supplied, entirely inside this package's own IN scope. Added: the agentless spend-approval fallback in `requireSpendApproval`/`requireSpendApprovalViaUserQuestions` (`src/index.ts`) — tested in `tests/agentless-spend-approval.spec.ts`, committed RED first — so a call with no `exec.agent` (SaturnBot's real shape, verbatim) now asks through `ctx.userQuestions` instead of failing outright, with the same cost line, zero network requests before the answer, and the same fail-closed guarantee on Decline, timeout, or no answerer. The `ctx.approval`-with-`Agent` route stays preferred whenever an `Agent` is present. This closed the blocking `integration_needs` item; the class doc, this README, and the `.zh.md` sibling were rewritten accordingly rather than left describing the now-superseded architecture-mismatch framing.

</details>

**Runtime invariant:** No companion is published: `ctx.media` is this package's sole cross-plugin surface, consumed by whichever role config (SaturnBot's `creative`/`growth` roles, per SPEC §4) wires it in — see "The spend Gate has two routes" above for how the pinned `generate(req): Promise<Job>` signature is satisfied for both an agent-bearing caller (`ctx.approval`, preferred, or `MediaService.withAgent`) and an agentless one (`ctx.userQuestions`, the fallback).
