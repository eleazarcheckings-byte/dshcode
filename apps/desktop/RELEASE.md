# Desktop release

How to cut a Saturn AI desktop build, on CI or on a Mac. Unsigned by
default; signing and notarization are wired in as an opt-in path that
turns on the moment the right repo secrets exist — nothing else to change.

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
smoke test, a **"Configure Apple signing (opt-in)"** step (macOS legs) or
**"Configure Windows signing (opt-in)"** step (Windows leg — see "Turning on
signing/notarization" below), `pnpm --filter @dshcode/desktop run <dist
command>`, the packaged Windows directory-picker smoke test (Windows leg
only), and the packaged desktop startup smoke test — then uploads
`.dmg`/`.zip`/`.exe` output from `.artifacts/desktop/release/` as a workflow
artifact.

**`release`** — runs only `if: startsWith(github.ref, 'refs/tags/desktop-v')`,
after `package` succeeds: downloads all three artifact sets, runs
`sha256sum * > SHA256SUMS.txt` over them, and calls `gh release create` with
release notes that state plainly that these packages are unsigned when the
signing secrets weren't configured for that run.

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
- A GitHub Release named `Saturn AI Desktop <version>` (prerelease flag set
  automatically when the tag has a `-` suffix, e.g. `desktop-v1.2.0-beta`),
  with every packaged file plus `SHA256SUMS.txt` attached.

The workflow also supports `workflow_dispatch` (manual run from the Actions
tab) for testing the `package` job without cutting a tag — the `release` job
still only fires on a `desktop-v*` tag push.

## What ships today: unsigned by default, signed when the secrets exist

With none of the signing secrets below set in the repo, these builds are
**unsigned**:
- No Apple Developer ID, no notarization — macOS Gatekeeper shows an
  "unidentified developer" warning on first launch (right-click → Open, or
  System Settings → Privacy & Security → "Open Anyway", clears it once).
- No Windows code-signing certificate — SmartScreen shows an "unrecognized
  app" warning ("More info" → "Run anyway" clears it once).
- No `UNUserNotificationCenter` permission prompt on macOS: per
  `apps/desktop/electron-builder.yml`, macOS silently drops notifications
  from an ad-hoc-signed app. Everything else in the app works.

`desktop.yml`'s release notes say this explicitly on every release that
doesn't have the secrets configured. Set the secrets described in "Turning
on signing/notarization" below and the very next run signs, and — on macOS —
notarizes, automatically. No workflow edit needed.

## Building locally (any machine, any OS matching the target)

```bash
cd dshcode
corepack enable                        # reads "packageManager": "pnpm@11.7.0" from package.json
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @dshcode/desktop run dist:mac:arm64   # or dist:mac:x64 / dist:win:x64
```

Output lands in `.artifacts/desktop/release/`. On macOS, see
`scripts/build-mac.sh` in the outer saturn-ai repo, one level above
`dshcode/` (`C:/Users/izzy/Desktop/saturn-ai/scripts/build-mac.sh`), for the
exact handoff commands to run on a Mac — it mirrors the same build steps
(`pnpm install --frozen-lockfile`, `pnpm run build`,
`pnpm --filter @dshcode/desktop run dist:mac:$arch`) so a local Mac build
matches what CI produces, unsigned by default and signed+notarized when the
same six env vars from "Turning on signing/notarization" below are exported
into that shell first.

## Turning on signing/notarization

izzy's Apple Developer Program membership ($99/yr) is **already paid** as of
2026-09-15 — signing and notarizing costs nothing new on the Apple side.
`desktop.yml` (and `scripts/build-mac.sh` for a local Mac build) already
contain the opt-in logic; the only remaining step is entering the secrets
below. Nothing needs to change in the workflow file itself.

### Where izzy enters the secrets

GitHub → the `eleazarcheckings-byte/dshcode` repo (the `fork` remote) →
**Settings → Secrets and variables → Actions → New repository secret**. Each
name below must match exactly (case-sensitive); values are pasted once and
GitHub never displays them again.

**macOS signing + notarization** — set all six together (the workflow checks
all six are present before attempting anything; if even one is missing it
falls back to an unsigned build with `CSC_IDENTITY_AUTO_DISCOVERY=false`):

| Secret | What it holds |
|---|---|
| `MAC_CERT_P12` | base64 of your Developer ID Application `.p12` export (`base64 -i Certificate.p12 \| pbcopy` on a Mac, then paste) |
| `MAC_CERT_PASSWORD` | that `.p12`'s export password |
| `APPLE_TEAM_ID` | your Apple Developer Team ID (Membership page in the developer portal, or `xcrun altool --list-providers` output) |
| `ASC_KEY_ID` | the Key ID of an App Store Connect API key (Users and Access → Integrations → App Store Connect API in App Store Connect) |
| `ASC_ISSUER_ID` | that key's Issuer ID, shown on the same page |
| `ASC_KEY_P8` | the full contents of the downloaded `AuthKey_<ASC_KEY_ID>.p8` file (paste as-is, including the `BEGIN/END PRIVATE KEY` lines) |

What it unlocks: `desktop.yml`'s macOS legs import `MAC_CERT_P12` into a
temporary keychain, sign with it, then notarize automatically through
electron-builder's built-in `@electron/notarize` integration using the App
Store Connect API key (`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`,
which the workflow sets from `ASC_KEY_P8`/`ASC_KEY_ID`/`ASC_ISSUER_ID` —
confirmed against the pinned `electron-builder@26.15.3`'s own source,
`app-builder-lib/out/mac/MacTargetHelper.js`'s `getNotarizeOptions`). This
also unblocks macOS notifications (see `electron-builder.yml`'s `mac.icon`
comment) since Gatekeeper requires a valid signature for
`UNUserNotificationCenter`. The same six secrets, exported into a Mac shell
under the same names, drive `scripts/build-mac.sh`'s opt-in local path.

The App Store Connect API key (`ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_P8`) is
shared with the iOS TestFlight lane — see `apps/mobile/README.md`'s
TestFlight section — so entering it once unlocks both.

**Windows signing** — set both together:

| Secret | What it holds |
|---|---|
| `WIN_CERT_PFX` | base64 of your code-signing `.pfx` export |
| `WIN_CERT_PASSWORD` | that `.pfx`'s export password |

What it unlocks: `desktop.yml`'s Windows leg writes the decoded `.pfx` to a
per-run temp file and exports `CSC_LINK`/`CSC_KEY_PASSWORD`, which
electron-builder's `nsis` target picks up automatically — no other change.
Cost: roughly **US$70–400/year** for a code-signing certificate (OV vs. the
pricier EV, which also skips SmartScreen's reputation delay) — a Gate, izzy's
call, separate from the already-paid Apple membership.

**Nothing here is a Gate to re-litigate for Apple** — the membership is
already bought; entering these six secrets is data entry, not a purchase.
Windows code-signing is still an unpurchased Gate: buying that certificate
needs izzy's go-ahead first.

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
