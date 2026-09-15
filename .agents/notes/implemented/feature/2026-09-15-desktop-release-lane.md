# Agent Note: One desktop release lane, duplicate retired

Status: implemented

English | [中文](2026-09-15-desktop-release-lane.zh.md)

## Problem

A fix-round build cell had added `.github/workflows/desktop-release.yml`, a
second tag-triggered release workflow, on the belief that reusing
`.github/workflows/desktop.yml`'s `desktop-v*` tag would make both
workflows fire on the same push and race each other's `gh release create`.
But `desktop.yml` already builds macOS (`macos-15` arm64, `macos-15-intel`
x64) and Windows (`windows-2025` x64), runs the Windows directory-picker and
Electron packaged-startup smoke tests, generates `SHA256SUMS.txt`, and
creates the GitHub release on a `desktop-v*` tag — the exact same job the
second lane duplicated under a different tag namespace (`desktop-release-v*`)
with strictly less coverage (no smoke tests). One release lane must exist
and be documented, not two doing the same thing.

## Decision

Retire the duplicate: `git rm .github/workflows/desktop-release.yml`. Keep
`desktop.yml` as the single release path — it was never missing anything
the second lane added except a different tag prefix. Rewrite
`apps/desktop/RELEASE.md` to document `desktop.yml` directly: its exact
runner labels (`macos-15`, `macos-15-intel`, `windows-2025`), its
`package`/`release` job split, the `desktop-v*` tag trigger, where each
artifact type lands (workflow artifacts vs. the GitHub Release), the
unsigned-build user experience (Gatekeeper/SmartScreen warnings), the
Apple Developer ($99/yr) and Windows code-signing ($70-400/yr) costs as
Eleazar's spend Gates with exactly what secrets (`CSC_LINK`,
`CSC_KEY_PASSWORD`, notarytool credentials) would need to be wired into
`desktop.yml` later, and the local Mac handoff via
`scripts/build-mac.sh` (repo root, one level above `dshcode/`) — left
untouched since its build commands already match `desktop.yml`'s
(`pnpm install --frozen-lockfile`, `pnpm run build`,
`pnpm --filter @dshcode/desktop run dist:mac:$arch`), only its header
comment updated to stop naming the now-deleted workflow.

Repo visibility was reconfirmed before restating the free-CI-minutes claim:
`gh repo view eleazarcheckings-byte/dshcode` (the `fork` remote) reports
`visibility: PUBLIC`.

## Alternatives considered

**Keep both lanes, reconcile later.** Rejected: the prior note already
flagged this as an unresolved open question and logged it in
`integration_needs`; on inspection there was nothing to reconcile — the
second lane added no coverage `desktop.yml` lacked, so keeping it was pure
duplication and doc-sprawl (two READMEs, two tag prefixes, two places to
update if the build matrix changes).

**Port `desktop-release.yml`'s checksum step into `desktop.yml`, drop the
rest.** Unnecessary: `desktop.yml`'s `release` job already runs
`sha256sum * > SHA256SUMS.txt` before calling `gh release create` — the
checksum step this alternative would "add" already exists.

**Sign and notarize now.** Rejected, as before: no Apple Developer account
or code-signing certificate is provisioned, and provisioning either is a
Gate (real money) — out of scope for this cell regardless of technical
readiness.

## Consequences

One workflow, `desktop.yml`, is the entire desktop release path: push a
`desktop-v*` tag to the public `fork` remote
(`eleazarcheckings-byte/dshcode`) and it builds, smoke-tests, checksums, and
publishes the GitHub release at zero infrastructure cost. `RELEASE.md`
documents that path exactly as written in the workflow file, plus the local
Mac build handoff and what turning on code signing will cost and require.
There is no second lane left to reconcile.
