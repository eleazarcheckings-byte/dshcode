# Agent Note: Desktop updater and izzy.la account

Status: implemented

English | [中文](2026-09-15-desktop-updater-and-account.zh.md)

## Problem

The packaged shell still named `whitelonng/dshcode` as its repository, so any future electron-updater feed would have followed a third-party owner. There was no check-for-updates surface, and Settings had no product account — only other RPs (SaturnDesign) hold izzy.la clients.

## Decision

Pin the update channel to `eleazarcheckings-byte/dshcode` in `apps/desktop/app-update.yml`, `electron-builder.yml` `publish`, and `package.json` `repository.url`. The checker speaks electron-updater's GitHub `latest.yml` protocol. Checking is a button (Settings → Account, and the Windows window menu). Nothing downloads, nothing installs on quit, and a missing feed is reported as empty. A newer GitHub tag without YAML is reported as a newer installer with no auto-update feed.

Account is a new Settings page (`@saturnai/dsh-client-ui-settings-account`) plus a durable session at `$DSH_HOME/account/session.json`. The live authorize URL is `https://izzy.la/api/auth/oauth2/authorize`. SaturnDesign's client id is ignored. Without `SATURN_AI_OAUTH_CLIENT_ID`, sign-in stays on the empty not-connected state. A `connected: true` record without `sub` collapses to disconnected.

## Alternatives considered

**electron-updater as a new workspace dependency.** Packaging cannot take a lockfile change in this slice. The feed URLs, YAML parse, and `app-update.yml` are the same contract; adding the package later does not retarget the channel.

**Reuse SaturnDesign's OAuth client.** That is a different relying party with different redirects. Mixing it would paint a SaturnDesign identity as a Saturn AI desktop user.

**Silent check on launch.** The mandate is user-initiated. A 404 feed would have looked like a failure every morning.

## Consequences

The web-app bundle mounts `@saturnai/dsh-client-ui-settings-account` after `ui-settings-general` and depends on the package. The desktop check (window menu + IPC) works without that row. Registering a Saturn AI OAuth client on izzy.la (new `client_id` + loopback redirect) is a Gate.
