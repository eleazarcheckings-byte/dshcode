# Agent Note: Desktop profile runtime dependency closure

Status: implemented

English | [中文](2026-09-15-desktop-profile-runtime-closure.zh.md)

## Problem

The desktop runtime reaches profile bundles through the CLI application package. A dependency check that discovers only `packages/` and `vendor/` stops at that application edge and can accept a desktop manifest while omitting required peers of the profile's plugins. Such omissions appear only after a production-only deployment removes development dependencies.

## Decision

The [runtime-closure verifier](../../../../scripts/verify-runtime-closure.ts) includes `apps/*/package.json` alongside package and vendor manifests. Its dependency traversal reaches the CLI's base and web bundles, then checks each reachable workspace package's required peers against the selected runtime manifest. Diagnostics name that manifest. The [desktop manifest](../../../../apps/desktop/package.json) declares the complete required peer set directly, including Team, session API, model, authorization, and native utility providers.

The packaging script executes this verifier before staging. The regression fixture models a desktop-to-CLI-to-bundle-to-plugin chain and confirms that a missing peer rejects the release, while declaring it makes the same graph pass.

## Alternatives considered

**Add only the newly observed package to the desktop manifest.** This leaves the application traversal gap in place and allows future profile changes to evade the same check.

**Rely on the development installation.** Workspace development dependencies can make missing production peers appear present. The verifier must reason from the selected runtime manifest before production staging.

## Consequences

The desktop check covers the production profile graph rather than only packages directly named by the shell. It does not replace packaged startup or interaction checks, which still verify executable resources and live plugin activation. The package version advances independently from the upstream CLI family for local desktop releases.
