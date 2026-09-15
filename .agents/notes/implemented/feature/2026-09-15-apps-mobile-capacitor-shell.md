# Agent Note: apps/mobile — the Capacitor companion shell for iOS and Android

Status: implemented

English | [中文](2026-09-15-apps-mobile-capacitor-shell.zh.md)

## Problem

SPEC.md §8 (2026-09-15 fan-out) asks for "matching" iOS and Android apps alongside the Electron desktop target: a native shell that pairs with a user's running Saturn AI host, renders the same web UI, and turns a phone into an approval and verdict surface for SaturnBot and the agent fleet. Nothing like it existed; `apps/` held only `cli`, `desktop`, and `web`.

## Decision

`apps/mobile` is a new Capacitor project with its own `package.json`, installed and built with plain `npm` — not a pnpm workspace package, per the mandate. It implements the M1↔M3 pairing contract end to end on the client side:

- `src/lib/pairing.ts` — parses and validates the QR payload (`{v, name, url, token, fingerprint?, expires}`); requires https, a well-formed `expires`, and a 64-hex `fingerprint` on every LAN payload (a `*.trycloudflare.com` url may omit it, since cloudflared supplies its own TLS).
- `src/lib/tokenStore.ts` — persists the paired device session behind an injectable `KeyValueStorage`, so the logic is unit-testable without the Capacitor runtime; `src/lib/capacitorStorage.ts` is the thin `@capacitor/preferences` adapter used on-device.
- `src/lib/eventsMapper.ts` — maps a `GET /saturn/remote/events` payload to a local-notification descriptor, keeping the host's own verdict-card language ("Verdict PASS", "Approval needed", "SaturnBot needs you").
- `src/lib/certPin.ts` — the pure SHA-256 fingerprint comparator behind pinned-cert HTTPS; `android/app/src/main/java/ai/saturnai/mobile/PinningWebViewClient.java` is the real enforcement point, overriding `BridgeWebViewClient.onReceivedSslError` to proceed only when the presented cert matches the fingerprint pairing wrote to `@capacitor/preferences`'s `CapacitorStorage` group. The iOS equivalent (a `WKNavigationDelegate` challenge handler) is documented, not built — see the README's Mac steps.
- `src/screens/*.ts` + `src/index.html` + `src/styles.css` — the pairing, lock, offline, and notifications screens in SPEC.md §2's language: the -18° ring mark (self-drawn via `pathLength`), Instrument Sans + Commit Mono self-hosted from their official sources, the bg/surface/ink/accent tokens, the named motion system.

Two mandate-adjacent substitutions, both documented in `apps/mobile/README.md`:

- **QR scanning uses `@capacitor/camera` + `jsqr`, not a barcode-scanner plugin.** The one plugin in the `@capacitor-community` scope for this (`@capacitor-community/barcode-scanner`) peer-depends on `@capacitor/core@^5` and is incompatible with the `@capacitor/core@^8` stack. The mandate's "camera (or barcode scanner)" phrasing permits this.
- **Biometric auth uses `@aparajita/capacitor-biometric-auth`, not an `@capacitor`/`@capacitor-community` package.** Neither scope currently publishes a biometric plugin; this is the most actively maintained alternative (Capacitor 7+, updated within the month).

`npx cap add android` and `npx cap add ios` generated both native projects (iOS via Swift Package Manager — no `Podfile`, `pod install` is not needed). The Android debug APK was built on this machine: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (JDK 21 at `C:/Java/jdk-21.0.11+10`, Android SDK at `C:/Android`, `gradlew.bat assembleDebug`, BUILD SUCCESSFUL in 4m41s). iOS signing and TestFlight are documented for the Mac, per the Apple Developer Program Gate.

## A repo-config hazard this surfaced

Root `pnpm-workspace.yaml` and root `package.json`'s npm `workspaces` array both already glob `apps/*`, so `apps/mobile` became an implicit pnpm workspace member the instant it was created — no edit to either file was needed or made. This session repeatedly observed `apps/mobile/node_modules` losing specific packages' contents (`@capacitor/android`, `@aparajita/capacitor-biometric-auth`) between build steps, and separately found that `cap add android` generated `android/capacitor.settings.gradle` pointing at `../../../node_modules/.pnpm/@capacitor+*/...` (the monorepo's shared pnpm store) rather than `apps/mobile`'s own `node_modules` — both consistent with a root-level `pnpm install`, running concurrently in a sibling cell, discovering this new workspace member through the existing glob and reconciling it against a lockfile that has no entry for it. The Android build happened to succeed because the versions pnpm placed in its shared store matched what npm had installed locally, which is a coincidence, not a guarantee. See `integration_needs` in this cell's report for the fix (excluding `apps/mobile` from both globs).

## Alternatives considered

**Adding `@capacitor-community/barcode-scanner` anyway, downgrading the Capacitor stack to v5 to match its peer range.** Rejected: it would mean shipping year-old Capacitor against a mandate asking for the frontier stack, to satisfy a scope preference the mandate itself relaxes with "(or barcode scanner)".

**Bundling with `tsc` alone (emit `.js`, load with bare `<script type="module">` tags).** Rejected once the resulting bundle tried to `import` bare specifiers like `@capacitor/app` — browsers can't resolve those without a bundler. `vite` (already present transitively via `vitest`) does this correctly with no new dependency and no restructuring of the hand-authored `index.html`/`styles.css`.

## Consequences

The web build (`npm run build`) is fully reproducible and typechecked; the 38-test suite covers every pure-logic module the mandate names (pairing parser, token storage, event mapper) plus the cert-pin comparator. The Android debug APK is a real, installable artifact. iOS is unverified beyond "the project structure is well-formed" until it's opened in Xcode on a Mac. The pnpm-glob hazard above is a standing risk for this directory until the root config is adjusted — anyone rebuilding locally should treat `apps/mobile/node_modules` as suspect after any root-level `pnpm install` and reinstall with plain `npm` first.

## Verification

`cd apps/mobile && npm test` — 38 tests, 4 files, all green (pairing parser: 13 cases including expiry and fingerprint validation; token store: 5 cases including corrupt/invalid stored JSON; events mapper: 12 cases covering all four event types and the PASS/REVISE/REJECT title derivation; cert-pin comparator: 5 cases). `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`vite build` → `www/`) both clean. `cd android && JAVA_HOME=... ANDROID_HOME=... ./gradlew.bat assembleDebug` — BUILD SUCCESSFUL, APK at the path above.
