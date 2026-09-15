# Agent Note: SaturnBot first-run wizard, generated connect forms, and status strip

Status: implemented

English | [中文](2026-09-15-saturnbot-first-run-wizard.zh.md)

## Problem

`ui-saturnbot`'s only path to a first run was the raw `Configuration` form: one flat page of every field at once, with integrations entered as hand-typed JSON (`{endpoint, credentialEnv, resource}` per connection) and no statement of what still blocked a run. The recon audit (`saturnbot-audit.md`) found this the single largest first-run friction point in an otherwise real, tested engine: "no per-provider connect form, no OAuth flow, no secret-manager field, no 'paste your token here' UI anywhere in `ui-saturnbot`."

## Decision

Three additions, all in `packages/client/ui-saturnbot/src/client/`:

- `StatusStrip.tsx` — a pure `computeSetupGaps(snapshot, t)` reads the four facts that gate a run (workspace, goal, provider, model) plus any unresolved credential the Host reports, and a `StatusStrip` component renders either the concrete list or a plain "ready" statement. Never a guess about health or connectivity — only fields SaturnBot itself already tracks.
- `ConnectForms.tsx` — `IntegrationConnectForms` generates one form per `snapshot.integrationCatalog` entry. A non-secret field (`resource`, `endpoint`) is an ordinary text input; a secret field (`credentialEnv`) never carries an editable value — it shows the exact required environment variable name with a copy action and an `.env` path hint, because the runtime resolves credentials from environment variables, never from a value typed into this UI. `safeParseIntegrations` reads the existing JSON draft for display without ever throwing on a malformed intermediate edit.
- `Wizard.tsx` — `FirstRunWizard` walks five steps (objective, workspace, model, connections, schedule) resumed from `snapshot.firstRun` (via `resumeWizardStep`) or from an explicit `initialStep`. Each Continue persists only that step's fields through the existing `configure` command, so closing mid-setup keeps progress; Skip and the per-step tabs never lose an unsaved draft.

`Configuration.tsx`'s integrations textarea becomes `IntegrationConnectForms` with the same JSON text state as its single source of truth, plus a nested "Advanced JSON" disclosure that keeps the raw editor reachable. `Dashboard.tsx` shows the wizard automatically while `snapshot.status === 'needs-setup'`, with a manual override either direction (`wizard.restart` / `wizard.skip`), and status-strip gaps route straight to the step that resolves them.

## Local type, ahead of C8a

SPEC §3 C8a (a sibling, concurrently-built cell) adds `firstRun: { goal, workspace, provider, credentials: [{ name, env, present }] }` and `integrationCatalog: [{ name, label, fields: [{ key, label, secret, env }], docsUrl }]` to the SaturnBot snapshot. This package was built against that documented shape before C8a's package necessarily lands it: `contracts.ts` defines a local `SaturnBotSnapshot = BotSnapshot & { firstRun?; integrationCatalog? }`, both members optional. Every reader in this package (the wizard's `resumeWizardStep`, the status strip's credential check, the connect forms) degrades to its pre-wizard behavior when a field is absent — so the two packages compose correctly regardless of merge order, and the orchestrator reconciles any field-shape drift at integration rather than this package guessing at an unshipped contract.

## Deviations from the SPEC text (declared, not silent)

- **`envPath`** — the SPEC's documented `firstRun` shape does not name a field for the exact `.env` path a resolved credential's value should be pasted into, but "shows the env name and the `.env` path to paste into" is the literal acceptance wording. Added `firstRun.envPath?: string` to the local type; the connect form falls back to generic copy (`connect.envPathFallback`) when a snapshot omits it. Flagged in `integration_needs` for C8a/the orchestrator to either adopt the field name or supply a different source for the path.
- **Provider/model picker** — "provider/model from the harness model directory" could not be wired live: the harness's only existing model-selection service (`ui-model-selection`'s `ModelDirectory`) is chat-session-scoped, and reaching it (or C6's `model-router`, built concurrently and out of this cell's IN scope) would mean a feature plugin importing another feature plugin's values, which the Client stack forbids outside slots/injected services. The model step instead keeps the existing freeform provider/model text inputs, augmented with a static, keyless `<datalist>` of common provider identifiers (the same list named in SPEC §3 C6's own default profile set) as quick picks — never a live query, and never a value that blocks an unlisted provider.
- **Workspace picker** — "workspace via the host directory picker" is served by the existing `workspaces` prop (the harness's own workspace list, already fed to `Configuration` before this change); no separate native file-system dialog was added.
- **Integration field keys stay fixed** — the generated forms only ever write `endpoint` / `credentialEnv` / `resource`, matching `BotConfig['integrations']`'s existing fixed record and the already-tested `parseAdvanced` validation in `Configuration.tsx` (which throws on any other key). Widening that record to admit arbitrary per-adapter field names (for C8a's new telegram/shopify adapters) is left to C8a; the local `SaturnBotIntegrationFieldKey` type documents the assumption explicitly.

## Alternatives considered

**Gate the wizard behind a one-time "first run" flag instead of `snapshot.status`.** Rejected: `needs-setup` is already the Host's own authoritative statement that required configuration is missing, and re-deriving a parallel client-only flag would drift from it. A manual override (`wizard.restart`/`wizard.skip`) covers the case where an operator wants either surface regardless of status.

**Fully parse the raw JSON textarea live into the generated form's fields on every keystroke.** Rejected as unnecessary complexity: the JSON text is already the single source of truth (existing pattern in `Configuration.tsx`), and `safeParseIntegrations` reading it for display keeps the generated fields and the Advanced JSON disclosure in sync without a second piece of state to reconcile.

## Testing

New: `tests/status-strip.client.spec.tsx`, `tests/connect-forms.client.spec.tsx`, `tests/wizard.client.spec.tsx` (46 tests total in the package, up from the 28-test baseline). Confirmed RED before implementation existed (`Failed to resolve import "../src/client/{Wizard,ConnectForms,StatusStrip}.tsx"`), then green after. `tsc -p packages/client/ui-saturnbot --noEmit` clean. `verify-client-ui-i18n`, `verify-translation-pairing`, `verify-package-readme-limitations`, `verify-package-readme-model-experience`, `verify-md-wrap`, `verify-md-links`, and `doc-standard.spec.ts` all clean for this package's files (the whole-repo `doc-quick` run surfaces unrelated failures in sibling cells' in-flight packages, listed in the report, not fixed here).

## Known follow-up

A live model-router-backed provider/model picker and a real host `.env` path surfaced through `firstRun` are both one small step past what this cell could reach inside its own IN scope; see Deviations above.

## Consequences

`Configuration.tsx`'s raw JSON textarea is no longer the primary integrations UI: it now lives under a nested "Advanced JSON" disclosure, and `IntegrationConnectForms` is what an operator sees first. Connect forms are generated from `snapshot.integrationCatalog` rather than hand-built per provider, so a new adapter shows up as a working form with no UI change in this package — the catalog entry is the only thing that has to exist. A secret field never echoes a value back into the UI; it shows only the required environment variable's name, a copy action, and a `.env` path hint, so the runtime's own env-var resolution stays the one place a credential's value is ever read from.

`packages/saturn/saturnbot/src/wizard.ts` — the runtime contract this package widens locally in `contracts.ts` (`SaturnBotSnapshot`'s `firstRun` and `integrationCatalog`) — is now load-bearing: the wizard's resume behavior, the status strip's gap detection, and every generated connect form all read `snapshot.firstRun`, so a future change to that runtime contract's shape must keep this package's readers degrading gracefully (as they already do when a field is absent) or update them in the same change. The local widened type is a bridge, not a permanent fork: once C8a's `BotSnapshot` carries `firstRun` and `integrationCatalog` natively, the two shapes need reconciling rather than left to drift apart.
