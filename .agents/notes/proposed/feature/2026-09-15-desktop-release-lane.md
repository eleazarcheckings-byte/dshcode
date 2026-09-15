# Agent Note: Desktop release lane builds unsigned, tag-triggered

Status: proposed

English | [中文](2026-09-15-desktop-release-lane.zh.md)

## Problem

`apps/desktop` has electron-builder configured (`electron-builder.yml`) and a
`dist:mac:*` / `dist:win:x64` script per target, but nothing wires a
`desktop-v*` tag to an actual GitHub release: there was no repeatable way to
hand someone a macOS or Windows build of Saturn AI without a maintainer
manually running the packaging scripts and uploading files by hand, and no
written guidance on what code-signing costs or when to turn it on.

## Decision

Add `.github/workflows/desktop-release.yml`: on push of a `desktop-v*` tag, a
three-way matrix (`macos-14` arm64, `macos-13` x64, `windows-latest`) runs
`corepack enable` (reading the root `packageManager: pnpm@11.7.0` pin),
`pnpm install --frozen-lockfile`, `pnpm run build`, then the matching
`pnpm --filter @dshcode/desktop run dist:*` script, uploads the resulting
`.dmg`/`.zip`/`.exe` as workflow artifacts, and a follow-up job downloads all
three, generates `SHA256SUMS.txt`, and attaches everything to a GitHub
release via `gh release create`. `CSC_IDENTITY_AUTO_DISCOVERY=false` is set
at the workflow level so no runner's incidental keychain state can produce a
differently-signed build; the release is unsigned by design. `apps/desktop/RELEASE.md`
documents the exact commands, the unsigned-build user experience (Gatekeeper
and SmartScreen warnings), and what Apple Developer Program membership
(~US$99/yr) and a Windows code-signing certificate (~US$70-400/yr) cost when
that becomes the next step — both flagged as spend Gates, not something this
lane enables on its own. `scripts/build-mac.sh` (repo root, one level above
`dshcode/`) mirrors the same steps for a manual local build on an actual Mac.

Repo visibility was checked before assuming free CI minutes:
`gh repo view eleazarcheckings-byte/dshcode` reports `visibility: PUBLIC`, so
these runner-minutes cost nothing.

## Alternatives considered

**Extend the existing `.github/workflows/desktop.yml`** instead of adding a
new file. Rejected for this change: `desktop.yml` already builds on
`macos-15` / `macos-15-intel` / `windows-2025` via `pnpm/action-setup`, plus
Electron-specific smoke and directory-picker tests this mandate did not ask
for and should not silently drop or duplicate logic for. The brief calls for
a new, separately named workflow; reconciling the two (retiring one, or
merging conventions) is an integration decision for a maintainer, not a
build-cell default — flagged in this session's `integration_needs`, not
resolved unilaterally here.

**Sign and notarize now.** Rejected: no Apple Developer or code-signing
certificate is provisioned, and provisioning one is a Gate (real money) —
out of scope for this cell regardless of technical readiness.

## Consequences

A maintainer can cut a desktop release by pushing one tag; the artifacts and
checksums land as a GitHub release automatically, at zero infrastructure
cost on the public repo. Anyone who opens the release sees an unsigned build
and, per RELEASE.md, knows the Gatekeeper/SmartScreen warning is expected and
not a sign of a broken build. The parallel `desktop.yml` workflow still
exists with a different runner matrix and additional smoke tests; the two
are not yet reconciled, so a future change to one lane's matrix or script
names needs to be checked against the other by hand until someone merges or
formally deprecates one.
