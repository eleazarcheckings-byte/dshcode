# Agent Note: One desktop release lane, duplicate retired

Status: implemented

English | [中文](2026-09-15-desktop-release-lane.zh.md)

## Problem

A fix-round build cell had added `.github/workflows/desktop-release.yml`, a second tag-triggered release workflow, on the belief that reusing `.github/workflows/desktop.yml`'s `desktop-v*` tag would make both workflows fire on the same push and race each other's `gh release create`. But `desktop.yml` already builds macOS (`macos-15` arm64, `macos-15-intel` x64) and Windows (`windows-2025` x64), runs the Windows directory-picker and Electron packaged-startup smoke tests, generates `SHA256SUMS.txt`, and creates the GitHub release on a `desktop-v*` tag — the exact same job the second lane duplicated under a different tag namespace (`desktop-release-v*`) with strictly less coverage (no smoke tests). One release lane must exist and be documented, not two doing the same thing.

## Decision

Retire the duplicate: `git rm .github/workflows/desktop-release.yml`. Keep `desktop.yml` as the single release path — it was never missing anything the second lane added except a different tag prefix. Rewrite `apps/desktop/RELEASE.md` to document `desktop.yml` directly: its exact runner labels (`macos-15`, `macos-15-intel`, `windows-2025`), its `package`/`release` job split, the `desktop-v*` tag trigger, where each artifact type lands (workflow artifacts vs. the GitHub Release), the unsigned-build user experience (Gatekeeper/SmartScreen warnings), the Apple Developer ($99/yr) and Windows code-signing ($70-400/yr) costs as Eleazar's spend Gates with exactly what secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, notarytool credentials) would need to be wired into `desktop.yml` later, and the local Mac handoff via `scripts/build-mac.sh` (repo root, one level above `dshcode/`) — left untouched since its build commands already match `desktop.yml`'s (`pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm --filter @dshcode/desktop run dist:mac:$arch`), only its header comment updated to stop naming the now-deleted workflow.

The free-CI-minutes claim rests on the 2026-09-15 Mars r3 review round's own check, which ran `gh repo view eleazarcheckings-byte/dshcode` (the `fork` remote) and got back `visibility: PUBLIC` — that check is cited here rather than repeated, since this note's own session did not re-run it.

## Alternatives considered

**Keep both lanes, reconcile later.** Rejected: the prior note already flagged this as an unresolved open question and logged it in `integration_needs`; on inspection there was nothing to reconcile — the second lane added no coverage `desktop.yml` lacked, so keeping it was pure duplication and doc-sprawl (two READMEs, two tag prefixes, two places to update if the build matrix changes).

**Port `desktop-release.yml`'s checksum step into `desktop.yml`, drop the rest.** Unnecessary: `desktop.yml`'s `release` job already runs `sha256sum * > SHA256SUMS.txt` before calling `gh release create` — the checksum step this alternative would "add" already exists.

**Sign and notarize now.** Rejected, as before: no Apple Developer account or code-signing certificate is provisioned, and provisioning either is a Gate (real money) — out of scope for this cell regardless of technical readiness.

## Consequences

One workflow, `desktop.yml`, is the entire desktop release path: push a `desktop-v*` tag to the public `fork` remote (`eleazarcheckings-byte/dshcode`) and it builds, smoke-tests, checksums, and publishes the GitHub release at zero infrastructure cost. `RELEASE.md` documents that path exactly as written in the workflow file, plus the local Mac build handoff and what turning on code signing will cost and require. There is no second lane left to reconcile.

## Addendum (2026-09-15, cell M5): opt-in signing wired in

This round wires the signing/notarization path `RELEASE.md` previously only described as a future step: `desktop.yml`'s macOS legs now carry a "Configure Apple signing (opt-in)" step that, when `MAC_CERT_P12`/`MAC_CERT_PASSWORD`/`APPLE_TEAM_ID`/`ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_P8` are all present as repo secrets, imports the certificate into a temporary keychain and exports the exact env vars electron-builder 26.15.3 reads for signing (`CSC_LINK`/`CSC_KEY_PASSWORD`) and for its built-in `@electron/notarize` integration (`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`, mapped from the ASC secrets) — variable names confirmed against the pinned package's own source (`node_modules/app-builder-lib/out/mac/MacTargetHelper.js`), not just its docs site (which 404'd on this session's fetch attempts). Absent any of the six, the step sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so the build stays unsigned exactly as before. The Windows leg gets the same opt-in shape on a `WIN_CERT_PFX`/`WIN_CERT_PASSWORD` pair. `scripts/build-mac.sh` (the local Mac handoff, one level above `dshcode/`) reads the same six mac-signing env var names for parity. Decision: keep this entirely env-var-driven with no `electron-builder.yml` change, since `getNotarizeOptions()` already runs unconditionally and no-ops to a warning log when the vars are absent — there was nothing to toggle in config. izzy's Apple Developer Program membership is already paid as of this session (relayed 2026-09-15 17:19), so entering the six secrets is the only remaining step; Windows code-signing remains an unpurchased Gate.
