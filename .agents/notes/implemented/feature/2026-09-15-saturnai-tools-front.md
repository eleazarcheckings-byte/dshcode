# Agent Note: saturnai.tools front: one visual language, a live playground, real receipts

Status: implemented

English | [中文](2026-09-15-saturnai-tools-front.zh.md)

## Problem

`saturnai.tools` served three different visual languages across three clicks a
visitor is invited to take: `/`, `/design/`, and `/design/connect/` each looked
like a different product. Provenance, proved before anything was edited, is
why:

| deployed page | what generates it (before) | what generates it (now) |
|---|---|---|
| `/` | `izzyawake-deploy/design/home/index.html`, hand-edited; `middleware.js` `HOST_MAP["saturnai.tools"].root = "/design/home/"` | `E/site/home.html` → `E/dist/home/` → mirror |
| `/design/` | `E/dist/index.html` from `E/viewer.template.html` via `E/build.mjs` | unchanged source, reworked band |
| `/design/connect/` | `izzyawake-deploy/design/connect/index.html`, hand-edited | `E/site/connect.html` → `E/dist/connect/` → mirror |

Evidence: `curl https://saturnai.tools/` returns 13,419 bytes, byte-identical to
the mirror's `design/home/index.html`; `middleware.js:66-72` carries the
`HOST_MAP` root; `dist/index.html` and `design/index.html` were both 640,080
bytes at the same mtime. The Drive `dev-site/design` copy was stale (8,835 vs
13,419 bytes for home), confirming the deploy mirror — not Drive — held the
live truth, and that neither home nor connect had an engine source at all: two
of the three pages were hand-authored directly in the deploy mirror, with
nothing in the engine (`G:/My Drive/Projects/mac/active/izzy-design`)
generating them.

## Decision

The engine (`E` = `G:/My Drive/Projects/mac/active/izzy-design`) is now
canonical for all three surfaces; the deploy mirror is build output only. Built
in cell `C10a-site-tools`, scoped to the engine and the deploy-mirror output it
writes to:

- **`E/site/`** is new and is now the source of the product front: `saturn.css`
  (the one visual language), `home.html` + `home.js`, `connect.html` +
  `connect.js`, the two self-hosted faces, and `receipts.json`.
- **`E/site-build.mjs`** renders those into `dist/home`, `dist/connect`,
  `dist/assets`, then mirrors byte copies into the deploy tree. Offline and
  deterministic: two consecutive builds produce identical bytes.
- **`E/build-receipts.mjs`** is the one networked step. It renders the engine's
  own review fixtures in headless Chrome, runs `collect-evidence.js` v2 in them,
  POSTs the measurements to `https://saturnai.tools/api/design/call`
  `{"name":"review"}`, and writes the returned verdicts to `site/receipts.json`.
  The proof band renders those verdicts verbatim — a PASS and a REJECT, with
  their rubric rows and evidence lines.
- **`E/viewer.template.html`** adopts the shared tokens and faces, replaces the
  marketing band with the plate fact list, moves the stat strip and the category
  chip pile behind a closed disclosure below the search bar, and draws the ring
  at -18°.
- **`E/llms.txt`** is now the deployed 24,288-byte copy: the engine is canonical.

## The mechanism

The verdict card. A stamped `PASS`/`REVISE`/`REJECT` struck inside the -18°
signature ring, with its measured evidence line and the six-criterion rubric
under it. The ring draws itself (`pathLength` + `stroke-dashoffset`) and the word
lands 200 ms later — two motions, both asserting the same fact: this verdict was
earned. The same object appears on `/` (two real receipts) and
`/design/connect/` (the PASS, reprinted).

## Known limitations and deferred work

- Four premium-stack slots are **declared, not proven**, and the receipt says so:
  `framework` (no Astro — the engine emits plain HTML), `images` (no raster
  imagery ships; the only artwork is inline SVG), `a11y-gate` (no CI runs
  axe-core against this static mirror yet), `cwv-gate` (field vitals need real
  traffic) and `audit` (Lighthouse was not run this session — declared rather
  than attested, because attesting an audit nobody ran is the forgery the
  receipt exists to prevent).
- Evidence coverage is 89%: the `surfaces` group is empty because the design uses
  no border-radius and no shadow anywhere. That is the design, not an omission.
- `grade-page.mjs` run against the full local library blocks any site-surface
  PASS on a corpus bug (see the report's `integration_needs`); the hosted
  reviewer, which is what the acceptance names, returns PASS.

## Fix round — the redistributed Commit Mono license (2026-09-15)

The first build shipped Commit Mono under a bare SIL OFL 1.1 template: no
copyright notice, no attribution, no mention of the MIT `LICENSE` the upstream
repository carries. Two upstream statements exist and they genuinely disagree,
so both were verified and both now ship:

- the binaries assert OFL 1.1 in their own OpenType `name` table — name ID 13
  and 14, read straight out of `commit-mono-400/500.woff2` (`Version 1.143`);
- `github.com/eigilnikolajsen/commit-mono` carries a 1,073-byte `LICENSE` the
  GitHub license API reports as SPDX `MIT` (blob `c288df41…`).

`assets/fonts/LICENSE-commit-mono.txt` (8,188 bytes) now opens with the
copyright notice OFL clause 1 requires, names the exact binaries and version it
governs, cites where and when each claim was read, and reproduces both texts
verbatim. The filename asserts nothing, because no single license name would be
true. `test/site-fonts-license.test.mjs` parses the shipped woff2 on every run
and fails if a swapped binary ever disagrees with the text beside it.

## Dev note

`node build-receipts.mjs` needs the network and system Chrome; `node build.mjs`
needs neither. Never hand-edit `design/home`, `design/connect` or
`design/assets/saturn.css` in the deploy mirror — they are build output and the
next build overwrites them.

## Alternatives considered

**Keep hand-editing the deploy mirror instead of generating from the engine.**
This is what `/` and `/design/connect/` already did, and it is the problem, not
a fix: two hand-authored pages with no shared source drifted into their own
visual language apiece, and nothing caught the drift because nothing in the
engine generated them. It lost because the deploy mirror is exactly the layer
that must stop being hand-written for the three surfaces to converge on one
visual language.

**Adopt Astro to satisfy the `framework` premium-stack slot.** SPEC §3 C10a
authorizes declaring this slot rather than proving it, and the engine's
plain-HTML, zero-client-framework build stays offline and deterministic (two
consecutive builds produce identical bytes). Bringing in a framework to turn
one declared slot into a proven one would add a build dependency and a runtime
this static front does not otherwise need, for a slot the receipt can instead
state honestly as not attempted.

**Name the redistributed Commit Mono license file `-MIT` or `-OFL`.** Rejected:
the shipped binaries assert OFL 1.1 in their own OpenType `name` table while the
upstream repository's `LICENSE` file is MIT — two upstream statements that
genuinely disagree. Either name would assert a claim the evidence does not
fully support, so the file stays neutrally named (`LICENSE-commit-mono.txt`)
and its body reproduces both texts verbatim with each claim's provenance
instead.

## Consequences

A maintainer changes the product front by editing `E/site/*` and running `node
build.mjs`; hand-editing `design/home`, `design/connect`, or
`design/assets/saturn.css` in the deploy mirror no longer does anything durable
— those paths are build output, and the next build overwrites any manual
change. The receipts rendered into `/` and `/design/connect/` regenerate only
when `node build-receipts.mjs` runs with network access and a system Chrome;
`node build.mjs` itself stays offline, so `site/receipts.json` keeps whatever
verdicts it last recorded until that networked step is run again. The deploy
mirror (`design/**` under the mirror root) is now purely generated output, and
the four declared premium-stack slots (`framework`, `images`, `a11y-gate`,
`cwv-gate`, `audit`) stay declared rather than proven until, respectively, a
framework migration, shipped raster art, a CI axe-core run, real field CWV
traffic, or a run Lighthouse audit exists.
