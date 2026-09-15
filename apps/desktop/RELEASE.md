# Desktop release

How to cut an unsigned Saturn AI desktop build, on CI or on a Mac, and what
signing/notarization costs when you're ready for that step.

## What ships today: unsigned

Pushing a `desktop-v*` tag runs `.github/workflows/desktop-release.yml`:
it builds macOS (arm64 + x64, `.dmg`/`.zip`) and Windows x64 (`.exe`, nsis)
with electron-builder, uploads them as workflow artifacts, then attaches
them (plus a `SHA256SUMS.txt`) to a GitHub release for that tag.

These builds are **unsigned**:
- No Apple Developer ID, no notarization — macOS Gatekeeper shows an
  "unidentified developer" warning on first launch (right-click → Open, or
  System Settings → Privacy & Security → "Open Anyway", clears it once).
- No Windows code-signing certificate — SmartScreen shows an "unrecognized
  app" warning ("More info" → "Run anyway" clears it once).
- No `UNUserNotificationCenter` permission prompt on macOS: per
  `apps/desktop/electron-builder.yml`, macOS silently drops notifications
  from an ad-hoc-signed app. Everything else in the app works.

The `eleazarcheckings-byte/dshcode` GitHub repo is **public**
(verified: `gh repo view eleazarcheckings-byte/dshcode` → `visibility: PUBLIC`),
so these GitHub Actions runner-minutes are **free** — public repos get
unlimited minutes on standard runners. There is no cost to running or
re-running this workflow as-is.

## Cutting a release

```bash
cd dshcode
git tag desktop-v1.1.5
git push origin desktop-v1.1.5   # Gate: pushing tags/publishing is an outward act — do this yourself
```

That push is the only trigger. The workflow does not run on `workflow_dispatch`
or on ordinary branch pushes.

## Building locally (any machine, any OS matching the target)

```bash
cd dshcode
corepack enable                        # reads "packageManager": "pnpm@11.7.0" from package.json
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @dshcode/desktop run dist:mac:arm64   # or dist:mac:x64 / dist:win:x64
```

Output lands in `.artifacts/desktop/release/`. On macOS, see
`scripts/build-mac.sh` at the repo root (`C:/Users/izzy/Desktop/saturn-ai/scripts/build-mac.sh`)
for the exact handoff commands to run on a Mac.

## When to turn on signing/notarization — and what it costs

Turn this on once the app is going to real users outside the household, or
once the Gatekeeper/SmartScreen warning becomes a support burden.

**macOS (Apple Developer Program + notarization)**
- Cost: **US$99/year** for an Apple Developer account (individual or org).
  Notarization itself is free once enrolled; it just requires `notarytool`
  credentials (an app-specific password or API key) generated from that account.
- What changes in the workflow: set `CSC_LINK` (base64 `.p12`) and
  `CSC_KEY_PASSWORD` as repo secrets, drop the
  `CSC_IDENTITY_AUTO_DISCOVERY=false` env line (or set it `true`), and add
  electron-builder's `afterSign` notarization hook (`@electron/notarize`)
  with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` secrets.
  This also unblocks macOS notifications (see `electron-builder.yml`'s `mac.icon`
  comment) since Gatekeeper requires a valid signature for `UNUserNotificationCenter`.

**Windows (code-signing certificate)**
- Cost: roughly **US$70–400/year** depending on issuer and certificate type
  (OV vs. the pricier EV, which also skips SmartScreen's reputation delay).
- What changes: set `CSC_LINK` / `CSC_KEY_PASSWORD` (or a cloud HSM signing
  service's credentials) as repo secrets for the Windows matrix leg; nsis
  picks up the signature automatically once electron-builder sees those.

**These are Gates** — an actual purchase (Apple Developer membership, a code-signing
cert) is money spent and needs Eleazar's explicit go-ahead; do not enroll or buy
either as part of routine release work.

## Dry-checking the workflow without pushing

```bash
cd dshcode
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/desktop-release.yml','utf8'))"
bash -n ../scripts/build-mac.sh
```

(`gh workflow view` only works after the workflow file is pushed to GitHub —
don't push to check this; the YAML parse above is the pre-push equivalent.)
