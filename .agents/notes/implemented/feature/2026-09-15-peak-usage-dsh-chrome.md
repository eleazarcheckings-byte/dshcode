# Agent Note: Peak lamp is DeepSeek capacity chrome; session usage is real tokens

Status: implemented

English | [中文](2026-09-15-peak-usage-dsh-chrome.zh.md)

## Problem

The peak/off-peak lamp is DeepSeek engine capacity, not Saturn identity, but it rendered for every session. Composer chrome had no real session token totals. First Light still led with “Connect DeepSeek here,” and About’s fork note needed to stay licenses, not product identity.

## Decision

- PeakRail injects the current session’s `modelSelection` provider and mounts the lamp only for `deepseek-official`. Any other engine, or none, hides the rail and releases `--dsh-shell-trailing-extra`.
- A quiet `UsageChip` in the composer trailing row reads the existing `tokenUsage` projection (uncached input + cache + output). It renders nothing until a provider has reported a non-zero total. No bar, no invented USD — token-meter has no currency table, and DeepSeek peak pricing stays on the lamp.
- First Light / Models copy connects a model engine; DeepSeek remains a listed engine. About still heads with the product name; DSHCode / DeepSeek Harness appear only in the MIT licenses line.
- `x-deepseek-harness-*` headers stay on `packages/llm/llm-deepseek` only (not edited this slice).

## Alternatives considered

- Showing the lamp whenever the catalog default is DeepSeek, even with a null selection. Rejected: “selected provider” is the `modelSelection` next/lastUsed id; unknown is not DeepSeek.
- A fake occupancy-style cost bar. Rejected: no USD table in token-meter; a painted bar without money would be theatre.
- Mounting usage on the overlay rail. Rejected: session tokens belong next to the composer, quietly.

## Consequences

- A brand-new session with no `modelSelection` yet hides the peak lamp until a route is selected or a request header lands.
- Usage appears only after real provider usage; empty sessions stay clean.

## Files

- `packages/client/ui-conversation/src/client/skeleton/{PeakChip,selected-provider,session-usage,UsageChip}.*`
- `packages/client/ui-conversation/src/client/{apply.ts,locales.ts,skeleton/InputBar.tsx}`
- `packages/client/ui-settings-models/src/client/locales.ts`
- `apps/desktop/src/about.ts` (unchanged copy; tests lock the identity rule)

## Verification

- PeakRail: DeepSeek shows the lamp; openai / null hide it; leaving DeepSeek releases the reservation.
- UsageChip: absent/zero usage renders nothing; 12.4K in · 3.1K out from real buckets; no `$`.
- First Light copy gate: does not lead with “Connect DeepSeek”.
- About: message is Saturn AI; fork names only in the licenses line.
