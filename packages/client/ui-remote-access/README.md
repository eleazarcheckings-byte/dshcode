---
description: "Settings → Remote: turn remote access on, read the address and certificate a device dials, show the pairing QR, and revoke paired devices."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-remote-access

English | [中文](README.zh.md)

## Summary

One Settings page that answers three questions in order: is remote access open, what address and certificate does a phone dial, and which devices already hold a key. The pairing code is drawn in the browser from the payload the Host mints — no network request, no image service — and it is never on screen until someone asks for it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The browser entry mounts the generated `@saturnai/dsh-remote-access` Remote namespace and then registers one `settings.section` seat: id `remote`, order 45, label from the `settings.remote` dictionary. The Host loader entry is inert.

The page reads the Host on mount and after every mutation, so a failed call clears the view rather than leaving a stale green light on a listener that is no longer open. Turning access on, minting a pairing code, and revoking a device are the three writes it performs; all three go through the Remote namespace and none of them is retried silently.

`encodeQr(text)` and `qrPathData(matrix)` are exported from `./client` for any surface that has to draw the same symbol: byte mode, versions 1 through 40, error-correction levels L and M, returning a module grid and a single SVG path.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

**The QR is encoded here.** The pairing code must be drawable from the bundle the app already ships, offline, so the encoder is part of this package rather than a dependency: capacity and block tables from ISO/IEC 18004, Reed–Solomon over GF(256), the eight mask patterns with the standard's penalty scoring, and format/version information under their BCH generators. Symbol selection takes the smallest version that fits, then upgrades to level M when that costs at most one extra version — a pairing code is scanned once, at arm's length, so size matters more than redundancy up to that bound. The suite asserts the tables against the standard's own published capacity, format-information, and alignment-centre values, and reads every finished matrix back out with a decoder written independently of the encoder.

**The code is drawn light-on-dark nowhere.** A scanner needs contrast, so the symbol keeps a light ground and dark modules in both themes instead of inverting with the surface. The card around it carries the product palette; the symbol carries the data.

**The device token never becomes text.** The pairing payload is passed to the encoder and to nothing else — the caption shows the title, the hint, and the expiry. A test asserts the rendered container's text content does not contain the token.

**One unwrap at the boundary.** The generated Remote reports transport success separately from the value (`{ ok, value }`); a face supplied directly hands the value back on its own. `contracts.ts` normalizes both shapes once so every caller above it speaks in domain values.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Remote access host](../../saturn/remote-access/README.md) — the listener, the pairing contract, and the device ledger.
- [Settings shell](../ui-settings/README.md) — the slot contract this page occupies.
- [Primitives](../ui-primitives/README.md) — the button atom used for every action here.

<a id="model-experience"></a>
## Model Experience

None, as this package only renders browser-side settings; it registers no tool, prompt section, or model-visible text.

#### KV Cache effect

None. The page constructs no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The QR encoder covers byte mode at levels L and M only.** Numeric, alphanumeric, and kanji modes and levels Q and H are unimplemented because the pairing payload is a JSON string and nothing else needs them.
- **The page polls nothing.** It reflects the state of the last Host answer, so a listener that fails after the page was opened is only visible on the next action or reopen.
- **The event stream is not rendered here.** The journal shows state changes; live approvals and verdicts go to the paired device, not back into this card.
- **Revoking the device you are reading this on is not distinguished.** The Host records it, but the page shows the same confirmation either way.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-15-saturn-remote-access.md) covers the pairing contract and why the QR encoder is vendored into this package.

</details>
