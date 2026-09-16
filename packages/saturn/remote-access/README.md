---
description: "Opt-in remote access to a running harness: a pinned-certificate LAN listener or a bring-your-own cloudflared tunnel, device-token pairing, and a notification stream."
kind: "package-reference"
---

# @saturnai/dsh-remote-access

English | [中文](README.zh.md)

## Summary

Make a running harness reachable from a phone without moving any of it off the machine it runs on. The Host keeps serving loopback exactly as before; this package adds one listener beside it that only a paired device may speak to, proxies that device's traffic into the existing web server under the same browser session the desktop window uses, and streams approvals, verdicts, fleet changes, and SaturnBot notices to the device over Server-Sent Events. It is off by default, every state change is journalled, and it downloads nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside `webServer` and `client-connection`. It provides `ctx.remoteAccess` and the generated Remote namespace the Settings → Remote page calls.

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `DSH_HOME`, then `~/.dsh` | Harness home; state lives under `<home>/remote/` |
| `bindHost` | `0.0.0.0` | Interface the LAN listener binds; `127.0.0.1` keeps it to this machine |
| `port` | `0` | LAN listener port; zero asks the operating system |
| `hostName` | the machine's hostname | Display name shown on the phone before it commits to pairing |
| `pairingTtlMs` | `600000` | Pairing-token lifetime |
| `certificateValidityDays` | `397` | Lifetime of the generated listener certificate |
| `tunnelTimeoutMs` | `30000` | How long to wait for cloudflared to publish an address |

Service operations, all exported as Remote methods: `status()`, `enable(mode)`, `disable()`, `pairingCode()`, and `revokeDevice(id)`. `publish(event)` is deliberately **not** a Remote method: other Saturn packages reach it duck-typed (`ctx.get('remoteAccess')?.publish({ type: 'verdict', title, body })`) so a composition without remote access costs them nothing.

The pairing contract, which the mobile companion implements verbatim:

```json
{
  "v": 1,
  "name": "<host name>",
  "url": "https://<lan-ip>:<port>",
  "token": "<opaque 32-byte base64url pairing token>",
  "fingerprint": "<sha256 of the self-signed certificate, hex, LAN mode only>",
  "expires": "<ISO time, ten minutes out>"
}
```

The device posts `{ token, device: { name, platform } }` to `POST <url>/saturn/remote/pair` once and receives `{ deviceToken, sessionCookieName, device }`. Every later request carries `Authorization: Bearer <deviceToken>`; because a WebView cannot attach that header to the subresource loads its document then makes, an authenticated request also leaves with the same credential planted as an HttpOnly cookie under `sessionCookieName`. `GET <url>/saturn/remote/events` is the notification stream, `GET <url>/saturn/remote/devices` lists paired devices, and `DELETE <url>/saturn/remote/devices/<id>` revokes one. Everything else is proxied to the loopback web server.

`GET <url>/saturn/remote/events/replay?after=<id>&limit=<1..200>` is the same notifications read rather than pushed, for a device an operating system would not keep a socket open for. It answers a cursor:

```json
{ "events": [], "newest": "12", "truncated": false }
```

`events` carries the frames whose ids are strictly greater than `after`, oldest first and byte-identical to what the stream would have delivered; `after` defaults to `0` and `limit` to `100`. `newest` is the newest id the host still holds, or `after` itself when there is nothing newer. `truncated` says more than `limit` were available, so the device asks again from the last id it read. When the ring had already evicted frames the cursor asked for, the window starts at the oldest frame still held and the answer adds `"gap": true` — the one fact a cursor cannot infer for itself. The response is `application/json` with a `Content-Length`, it carries no heartbeat, and it ends. Authentication is the stream's: a bearer device token or the device session cookie, 401 without one. An `after` that is not a whole number from zero up, or a `limit` outside 1–200, is a 400 rather than a guess.

Tunnel mode spawns `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<proxy port>` when a `cloudflared` is already on `PATH`. It is never fetched: when none is installed the status reports `tunnel-missing` and the Settings page says where to get one.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

**Authentication is borrowed, not forked.** `client-connection` owns browser authentication: a process launch token exchanged at the root URL for an authority-bound signed cookie. The edge runs that same exchange once against `http://127.0.0.1:<loopback port>` and holds the resulting cookie in memory only. A proxied request therefore arrives upstream wearing the desktop window's own session, and the device never sees it — the upstream `Set-Cookie` is stripped from every proxied response.

**The browser fences survive the Host rewrite.** `client-connection` refuses `/api` requests whose `Host` is not loopback or declared, and refuses an `Origin` that does not match it. The edge must rewrite `Host` to reach loopback, which would blunt both fences, so it applies them itself *first*: an explicit `sec-fetch-site: cross-site` marker is refused, and an `Origin` must name the authority the device actually dialled. Only then are `Host`, `Origin`, `Cookie`, and `Authorization` replaced for the loopback hop. A rewrite can never launder a cross-site request into a same-origin one.

**Secrets are held the shortest way that still works.** Pairing tokens live in memory for ten minutes, are spent once, and are dropped whenever the listener closes or a fresh code is minted — a token that does not survive a restart cannot be found later on disk. Device tokens are returned once and stored only as SHA-256 digests in `<home>/remote/devices.json` (mode 0600, replaced atomically), compared in constant time. The journal records actions and short non-secret details; it never records a token, a key, or a certificate.

**The certificate is minted here.** Node exposes X.509 parsing and signing but no certificate writer, so `certificate.ts` assembles the DER TBSCertificate by hand over a P-256 key pair: v3, a random 16-byte serial, `basicConstraints` (CA false, critical), `keyUsage` (digitalSignature, critical), `extKeyUsage` (serverAuth), and a `subjectAltName` carrying every non-loopback IPv4 this host answers on plus `127.0.0.1` and `localhost`. It is a leaf, not an authority: the phone pins the SHA-256 from the pairing payload rather than building a chain. The suite parses every issued certificate with `node:crypto`'s own `X509Certificate` and completes a real TLS handshake against it, which no malformed byte string survives.

**Approvals are observed, never answered.** The service registers on the `approval/request` waterfall and immediately delegates to `next()`, publishing a frame on the way through. Remote access can be switched on mid-session without changing what the harness asks or who answers it.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Web server](../../host/webserver/README.md) — the loopback carrier this edge fronts.
- [Client connection](../../client/connection/README.md) — the browser session the edge borrows.
- [Remote settings page](../../client/ui-remote-access/README.md) — the card that drives it.
- [User approval](../../interaction/user-approval/README.md) — the waterfall the notification stream observes.

<a id="model-experience"></a>
## Model Experience

None, as this package carries transport and device state only; it registers no tool, prompt section, or model-visible text.

#### KV Cache effect

None. Remote access constructs no model request and changes no assembled prompt, so an already-reusable prefix stays reusable whether it is on or off.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A paired device is a full window onto the harness, not a reduced one.** The device token authorizes everything the desktop window can do, because it is proxied as that session. Per-device scopes are deferred; revoke is the only granularity today.
- **The device cookie carries the device token itself.** It is the same secret the device already holds, sent over the same transport, and marked `HttpOnly`; a separate server-side session id would add indirection without reducing exposure, and is deferred.
- **Only IPv4 addresses reach the certificate.** An IPv6-only network cannot be advertised, and the published address is loopback with `issue: 'no-lan-address'`.
- **A lapsed upstream session answers 503, not 401.** The edge re-runs the exchange for the next request rather than replaying the current one, because replay would require buffering request bodies that may be hundreds of megabytes.
- **Replay reaches 64 frames back and no further.** The ring is in memory and bounded, so a device that was away long enough is told `"gap": true` and starts from the oldest frame still held rather than being handed a false complete history. A durable notification log is deferred.
- **Tunnel mode publishes a quick tunnel.** Its hostname changes on every start, so a paired device pinned to the previous address must be re-pointed; named tunnels are deferred.
- **cloudflared is never installed for the user.** Downloading and executing a network binary on someone's machine is their decision; the status reports `tunnel-missing` and stops.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-saturn-remote-access.md) explains the borrowed-session design, the fence ordering, and why the certificate is written by hand.

</details>
