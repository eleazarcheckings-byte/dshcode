# Agent Note: Desktop release lane builds unsigned, tag-triggered

Status: implemented

English | [中文](2026-09-15-desktop-release-lane.zh.md)

## Problem

`apps/desktop` has electron-builder configured (`electron-builder.yml`) and a
`dist:mac:*` / `dist:win:x64` script per target. `.github/workflows/desktop.yml`
already wires a `desktop-v*` tag to a GitHub release with a full smoke-test
suite, but it is the only such lane and there was no written guidance on
what code-signing costs or when to turn it on. This change adds a second,
leaner release lane (checksummed artifacts, no smoke tests, its own tag
namespace) and the missing cost/signing documentation — not because nothing
wired a tag to a release before, but because the fix-round review (Mars,
2026-09-15) found that sharing `desktop.yml`'s `desktop-v*` tag would make
both workflows fire on the same push and race each other's `gh release
create`, so this lane needed its own trigger to coexist safely.

## Decision

Add `.github/workflows/desktop-release.yml`: on push of a
`desktop-release-v*` tag (a namespace distinct from `desktop.yml`'s
`desktop-v*`, so the two workflows never both fire on one tag), a three-way
matrix (`macos-15` arm64, `macos-15-intel` x64, `windows-latest`) runs
`pnpm/action-setup@v4` (reading the root `packageManager: pnpm@11.7.0` pin,
matching `desktop.yml`'s proven setup rather than a bare `corepack enable`),
`pnpm install --frozen-lockfile`, `pnpm run build`, then the matching
`pnpm --filter @dshcode/desktop run dist:*` script, uploads the resulting
`.dmg`/`.zip`/`.exe` as workflow artifacts, and a follow-up job downloads all
three, generates `SHA256SUMS.txt`, and attaches everything to a GitHub
release via `gh release create`. `CSC_IDENTITY_AUTO_DISCOVERY=false` is set
at the workflow level so no runner's incidental keychain state can produce a
differently-signed build; the release is unsigned by design.
`apps/desktop/RELEASE.md` documents the exact commands (pushing to the
`fork` remote, `eleazarcheckings-byte/dshcode` — not `origin`, a third-party
remote), the unsigned-build user experience (Gatekeeper and SmartScreen
warnings), why the tag is namespaced apart from `desktop.yml`, and what
Apple Developer Program membership (~US$99/yr) and a Windows code-signing
certificate (~US$70-400/yr) cost when that becomes the next step — both
flagged as spend Gates, not something this lane enables on its own.
`scripts/build-mac.sh` (repo root, one level above `dshcode/`) mirrors the
same steps for a manual local build on an actual Mac.

Repo visibility was checked before assuming free CI minutes:
`gh repo view eleazarcheckings-byte/dshcode` (the `fork` remote) reports
`visibility: PUBLIC`, so these runner-minutes cost nothing on that remote.

## Alternatives considered

**Reuse `desktop.yml`'s `desktop-v*` tag.** Rejected after the fix-round
review demonstrated the collision: both workflows would trigger on the same
push, both run `gh release create` against the same tag, and the second to
finish fails outright (or the release title/notes become a race). A distinct
`desktop-release-v*` prefix removes the collision entirely without touching
`desktop.yml`, which sits outside this change's scope.

**Retire or merge into `desktop.yml` directly.** Not done here: `desktop.yml`
is a pre-existing workflow outside this build cell's file scope, shared with
other concurrent work on the repo. Reconciling the two lanes (retiring one,
or porting its directory-picker/startup smoke tests into the other) is a
maintainer decision, documented as an open question in `RELEASE.md` and in
this session's `integration_needs`, not resolved unilaterally here.

**Sign and notarize now.** Rejected: no Apple Developer or code-signing
certificate is provisioned, and provisioning one is a Gate (real money) —
out of scope for this cell regardless of technical readiness.

## Consequences

A maintainer can cut a checksummed desktop release by pushing one
`desktop-release-v*` tag; the artifacts and `SHA256SUMS.txt` land as a GitHub
release automatically, at zero infrastructure cost on the public `fork`
remote, without disturbing the pre-existing `desktop.yml` lane or its smoke
tests. Anyone who opens the release sees an unsigned build and, per
RELEASE.md, knows the Gatekeeper/SmartScreen warning is expected. The two
release lanes (`desktop.yml` and `desktop-release.yml`) still overlap in
purpose and are not yet reconciled — RELEASE.md's "Open question" section
tracks that until a maintainer retires or merges one into the other.
