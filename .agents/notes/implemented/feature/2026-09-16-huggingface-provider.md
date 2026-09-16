# Agent Note: Hugging Face in the model selector

Status: implemented

English | [中文](2026-09-16-huggingface-provider.zh.md)

## Problem

Users wanted to switch between any Hugging Face model from the model selector. The pi-ai catalog ships a short static `huggingface` list, while the Hugging Face router serves hundreds of chat models whose live providers change by the hour, and a declared route could only serve a static `models` array.

## Decision

`dsh-llm-pi-ai` gains a generic `modelsEndpoint: true` flag on a declared route (`src/live-models.ts`): the route's models come from `GET {baseURL}/models`, cached ten minutes, merged after the route's own `models`, which act as the seed and the failure fallback. Entries with a `providers[]` array are kept only when a provider is `live`; context is the largest live `context_length`, tools are any live `supports_tools`, and image input only when `architecture.input_modalities` says so. The route accepts `org/name:<policy|provider>` and any typed `org/name` id. Router 401/402/403/404/429 answers become `[huggingface:<kind>]` failures. The base bundle declares `huggingface` (`HF_TOKEN`, three seeds, `supportsDeveloperRole: false`).

The composer picker shows the Hugging Face group with a search field, context and tools badges, a typed model-id entry, and a Routing pane (fastest, cheapest, preferred, each live provider). Settings → Models renders a Hugging Face card: token onboarding with the fine-grained token link, a searchable live list, a routing policy, pinning into the route's `models`, and localized router failures.

## Alternatives considered

**HF-only discovery code.** Rejected: the flag is generic and also serves self-hosted TGI, vLLM, and LM Studio routes; only the error tags and the `providers[]` filter are router-shaped, and the filter is a no-op for plain listings.

**New wire fields for context, tools, and live providers.** Rejected for this cell: the catalog model shape and `LlmDiscoveredModel` live in packages outside its write scope. The adapter carries these facts in the model `description` line (`131K context · tools · via groq, cerebras`), which the picker parses into localized badges and routing choices.

## Consequences

A token pasted once in Settings → Models makes every live chat model selectable. The chat transcript shows the tagged English failure text (the tag is localized in the picker and the Models card only). The Models card offers policies but not per-provider routing, because discovery results carry no provider list; the composer picker offers both. Real router behaviour was verified only against fixtures and a local mock server, never the live network.
