---
description: "Settings → Account: izzy.la identity for this machine, and a user-initiated check against the Saturn AI desktop update feed."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-settings-account

English | [中文](README.zh.md)

## Summary

One Settings page that answers two questions in order: is this machine signed in with izzy.la, and is a newer Saturn AI installer published. A missing OAuth client, a missing desktop bridge, and an unpublished electron-updater feed are empty states. The page never invents a logged-in user and never downloads an update.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The browser entry registers one `settings.section` seat: id `account`, order 8, label from the `settings.account` dictionary. The Host loader entry is inert.

On mount the page reads identity through the desktop preload bridge (`window.dshDesktop`). When the bridge is absent — a plain browser — the face returns not-connected with reason `oauth-unavailable`. Sign in, sign out, and check-for-updates are the three writes; none of them is retried silently, and none of them installs an update.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

**Identity is a product session, not the IdP cookie.** izzy.la Accounts is the issuer (`https://izzy.la/api/auth/oauth2/authorize`). This machine stores `{ connected, sub, email?, name? }` under `$DSH_HOME/account/session.json`. A `connected: true` record without `sub` collapses to disconnected, so a planted file cannot paint a fake user.

**OAuth cannot complete without a Saturn AI client.** SaturnDesign's registered client is a different relying party and is ignored. Until `SATURN_AI_OAUTH_CLIENT_ID` names a client registered for this product, Sign in stays on the empty not-connected state.

**The update check speaks electron-updater's GitHub feed.** The channel is pinned to `eleazarcheckings-byte/dshcode`. `whitelonng/dshcode` is refused. Checking is a button. A 404 `latest.yml` is reported as an empty feed; a newer GitHub tag without that YAML is reported as a newer installer with no auto-update feed. Nothing downloads.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Desktop shell](../../../apps/desktop/README.md) — preload bridge, `app-update.yml`, and the session file.
- [Settings shell](../ui-settings/README.md) — the slot contract this page occupies.
- [izzy.la Accounts](https://izzy.la/account/) — the identity provider.

<a id="model-experience"></a>
## Model Experience

### Browser settings section

#### What the model sees

Nothing from the `account` section. The page performs no model requests, holds no conversation context, and registers no model-facing content.

#### Token effect

Zero in the current process.

#### KV Cache effect

None in the current process; the section contributes nothing to any provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The code exchange is unfinished until a Saturn AI OAuth client is registered on izzy.la** with a loopback redirect for this install. Sign in is honest about that and does not pretend to be logged in.
- **The GitHub channel has no `latest.yml` today.** Check-for-updates reports the empty feed (or a newer installer without a feed) instead of auto-downloading.
- **The page is a desktop face.** In a plain browser it stays not-connected because there is no preload bridge to `$DSH_HOME`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-desktop-updater-and-account.md) covers why the feed is pinned to the product fork and why a missing OAuth client is an empty state.

</details>
