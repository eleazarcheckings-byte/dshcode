# Agent Note: Remote access to a running harness

Status: implemented

English | [中文](2026-09-15-saturn-remote-access.zh.md)

## Problem

The harness is a local host. The one thing a person away from their desk actually needs from it — an answer to "may I run this", a verdict, a fleet that has gone quiet — arrives while they are not at the desk. Every obvious remedy moves the product somewhere it should not go: a relay service, an account, a copy of the session in someone else's datacentre, or a second authentication system living beside the one the desktop window already uses.

## Decision

Add one listener beside the loopback web server, reachable only by a device that has been paired once, and proxy that device's traffic into the existing server **wearing the session the desktop window already holds**. `client-connection` keeps sole ownership of browser authentication: the edge runs its launch-token exchange once against `http://127.0.0.1:<loopback port>` and holds the resulting authority-bound cookie in memory only. Nothing about the harness's auth is reimplemented, and the device never sees that cookie — the upstream `Set-Cookie` is stripped from every proxied response.

The device's own credential is separate and narrow. A pairing token lives in memory for ten minutes, is spent once, and is dropped whenever the listener closes. Redeeming it returns a device token that is stored only as a SHA-256 digest, compared in constant time, and revocable from Settings or from another paired device. Because a WebView cannot attach an `Authorization` header to the subresource loads its document then makes, an authenticated request also leaves with the same credential planted as an `HttpOnly` cookie; the pair response names that cookie so the companion app knows what it is.

LAN mode mints its own certificate and publishes the SHA-256 in the pairing payload for the phone to pin. Tunnel mode spawns a `cloudflared` the person installed themselves and binds the edge to loopback so the tunnel is the only way in. Off by default; every state change journalled; no token, key, or certificate in the journal.

## Alternatives considered

**Bind the existing web server to `0.0.0.0` and add a password.** That is a second authentication system beside the one `client-connection` owns, on the same port that serves the app, with no way to revoke one device without locking out all of them.

**Share the desktop's launch-token URL with the phone.** It would work, and it would hand a permanent, unrevocable, unattributable credential to whatever else can read that QR.

**A relay or a hosted tunnel of our own.** Recurring cost and a third party in the path of the session. Tunnel mode exists, but as *the user's* cloudflared: the harness locates one on `PATH` and refuses with `tunnel-missing` when there is none, because downloading and executing a network binary on someone's machine is their decision.

**A QR library.** The pairing code must draw offline from the bundle already shipped. The encoder is ~300 lines against published tables; a dependency would be a network fetch at install time and an ecosystem risk forever.

**`node-forge` or `pkijs` for the certificate.** Both would have to enter the workspace for one function. Node already signs and parses X.509; only the *writer* is missing, so the DER is assembled by hand and then judged by `node:crypto`'s own parser and a real TLS handshake.

## Consequences

The Host rewrites `Host` on the loopback hop, which would blunt the two fences `client-connection` relies on (DNS rebinding, cross-site). The edge therefore applies them itself **first**: an explicit `sec-fetch-site: cross-site` marker is refused, and an `Origin` must name the authority the device dialled. Only then are `Host`, `Origin`, `Cookie`, and `Authorization` replaced. A rewrite can never launder a cross-site request into a same-origin one.

Approvals are observed, never answered: the service registers on the `approval/request` waterfall and delegates to `next()` on the way through, so remote access can be turned on mid-session without changing what the harness asks or who answers.

A paired device is a full window onto the harness, because it is proxied as the desktop session. Per-device scopes are deferred; revoke is today's only granularity, and it is immediate and durable.

Verification is end-to-end rather than unit-shaped where it matters. The composition suite boots the real Loader with credentials, the web server, `client-connection`, and the static front end, enables LAN mode, pairs a device with the real QR payload over a pinned TLS socket, fetches the app through the proxy, receives an approval frame on the event stream from a real `approval/request` waterfall, and revokes the device. The certificate suite parses every issued certificate with `X509Certificate` and completes a real handshake. The QR suite checks the standard's own capacity, format-information, and alignment tables and reads each finished matrix back with an independently written decoder.
