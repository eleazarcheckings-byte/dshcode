# Desktop release

How to cut an unsigned Saturn AI desktop build, on CI or on a Mac, and what
signing/notarization costs when you're ready for that step.

## The release lane: `.github/workflows/desktop.yml`

Pushing a `desktop-v*` tag runs the existing `.github/workflows/desktop.yml`.
It is the one release lane for this repo — there is no separate/duplicate
workflow (an earlier `desktop-release.yml` draft was retired in favor of
this one; see "History" below).

The workflow has two jobs:

**`package`** — a three-way matrix:

| Runner | Target | Build command |
|---|---|---|
| `macos-15` | macOS Apple Silicon | `dist:mac:arm64` |
| `macos-15-intel` | macOS Intel | `dist:mac:x64` |
| `windows-2025` | Windows x64 | `dist:win:x64` |

Each leg runs `pnpm install --frozen-lockfile`, `pnpm run build`, the
Windows directory-picker vitest specs and the Electron directory-decoding
smoke test, `pnpm --filter @dshcode/desktop run <dist command>`, the
packaged Windows directory-picker smoke test (Windows leg only), and the
packaged desktop startup smoke test — then uploads `.dmg`/`.zip`/`.exe`
output from `.artifacts/desktop/release/` as a workflow artifact.

**`release`** — runs only `if: startsWith(github.ref, 'refs/tags/desktop-v')`,
after `package` succeeds: downloads all three artifact sets, runs
`sha256sum * > SHA256SUMS.txt` over them, and calls `gh release create` with
that release's notes stating the build is unsigned.

## Cutting a release

```bash
cd dshcode
git tag desktop-v1.2.0
git push fork desktop-v1.2.0   # Gate: pushing tags/publishing is an outward act — do this yourself
```

Push to the `fork` remote (`eleazarcheckings-byte/dshcode`) — verified
**PUBLIC** via `gh repo view eleazarcheckings-byte/dshcode` (`visibility:
PUBLIC`), so these GitHub Actions runner-minutes are free: public repos get
unlimited minutes on standard runners. `origin` here is the upstream
`whitelonng/dshcode`, a third party — this all applies to `fork` only.

Artifacts land as:
- `dshcode-macos-arm64`, `dshcode-macos-x64`, `dshcode-windows-x64` — workflow
  artifacts on the run itself (14-day retention), each holding the raw
  `.dmg`/`.zip`/`.exe`.
- A GitHub Release named `DSHCode <version>` (prerelease flag set
  automatically when the tag has a `-` suffix, e.g. `desktop-v1.2.0-beta`),
  with every packaged file plus `SHA256SUMS.txt` attached.

The workflow also supports `workflow_dispatch` (manual run from the Actions
tab) for testing the `package` job without cutting a tag — the `release` job
still only fires on a `desktop-v*` tag push.

## What ships today: unsigned

These builds are **unsigned**:
- No Apple Developer ID, no notarization — macOS Gatekeeper shows an
  "unidentified developer" warning on first launch (right-click → Open, or
  System Settings → Privacy & Security → "Open Anyway", clears it once).
- No Windows code-signing certificate — SmartScreen shows an "unrecognized
  app" warning ("More info" → "Run anyway" clears it once).
- No `UNUserNotificationCenter` permission prompt on macOS: per
  `apps/desktop/electron-builder.yml`, macOS silently drops notifications
  from an ad-hoc-signed app. Everything else in the app works.

`desktop.yml`'s release notes say this explicitly on every release.

## Building locally (any machine, any OS matching the target)

```bash
cd dshcode
corepack enable                        # reads "packageManager": "pnpm@11.7.0" from package.json
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @dshcode/desktop run dist:mac:arm64   # or dist:mac:x64 / dist:win:x64
```

Output lands in `.artifacts/desktop/release/`. On macOS, see
`scripts/build-mac.sh` at the repo root
(`C:/Users/izzy/Desktop/saturn-ai/scripts/build-mac.sh`) for the exact
handoff commands to run on a Mac — it mirrors the same build steps
(`pnpm install --frozen-lockfile`, `pnpm run build`,
`pnpm --filter @dshcode/desktop run dist:mac:$arch` with
`CSC_IDENTITY_AUTO_DISCOVERY=false`) so a local Mac build matches what CI
produces.

## When to turn on signing/notarization — and what it costs

Turn this on once the app is going to real users outside the household, or
once the Gatekeeper/SmartScreen warning becomes a support burden.

**macOS (Apple Developer Program + notarization)**
- Cost: **US$99/year** for an Apple Developer account (individual or org).
  Notarization itself is free once enrolled; it just requires `notarytool`
  credentials (an app-specific password or API key) generated from that account.
- What changes in the workflow: set `CSC_LINK` (base64 `.p12`) and
  `CSC_KEY_PASSWORD` as repo secrets on the `macos-15` / `macos-15-intel`
  matrix legs, add electron-builder's `afterSign` notarization hook
  (`@electron/notarize`) with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
  `APPLE_TEAM_ID` secrets. This also unblocks macOS notifications (see
  `electron-builder.yml`'s `mac.icon` comment) since Gatekeeper requires a
  valid signature for `UNUserNotificationCenter`.

**Windows (code-signing certificate)**
- Cost: roughly **US$70–400/year** depending on issuer and certificate type
  (OV vs. the pricier EV, which also skips SmartScreen's reputation delay).
- What changes: set `CSC_LINK` / `CSC_KEY_PASSWORD` (or a cloud HSM signing
  service's credentials) as repo secrets for the `windows-2025` matrix leg;
  nsis picks up the signature automatically once electron-builder sees those.

**These are Gates** — an actual purchase (Apple Developer membership, a
code-signing cert) is money spent and needs Eleazar's explicit go-ahead; do
not enroll or buy either as part of routine release work.

## History: the retired duplicate lane

An earlier fix-round session added a second workflow,
`.github/workflows/desktop-release.yml`, on the reasoning that reusing
`desktop.yml`'s `desktop-v*` tag would make both workflows fire on the same
push and race each other's `gh release create`. That workflow triggered on
a separate `desktop-release-v*` tag with a leaner build (no smoke tests, its
own checksum step) and was never pushed to a real tag.

On review, `desktop.yml` already covers the full release path — build,
smoke test, checksum-equivalent artifact upload, and `gh release create` —
so the second lane only duplicated it under a different name rather than
adding real coverage. It has been deleted; `desktop.yml` on the `desktop-v*`
tag is the one release lane. There is nothing left to reconcile.
