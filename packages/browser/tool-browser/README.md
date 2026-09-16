---
description: "The browser_navigate and browser_snapshot tools: open one shared http(s) tab through in-tree Playwright Chromium and return an accessibility tree or a PNG path so the model can verify rendered UI."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

**DeepSeek Harness browser-verify plugin** — `browser_navigate` and `browser_snapshot` open one shared http(s) tab through in-tree Playwright Chromium and return an accessibility tree (Playwright ARIA snapshot), with an optional PNG written to disk. The tools are for checking rendered UI after a change or against a public page; they are not web search, anonymous fetch, or a marketing browser MCP. Chromium starts on the first navigation so plugin load and schema harvest do not launch a browser. This package owns the model-facing contract (tool names, JSON schemas, canonical values, Native rendering, and `generic` call cards) plus Playwright launch and URL policy; there is no replaceable provider seam.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the plugin into a profile (the shipped `standard` agent preset already mounts it) and let it register the two tools once at load. There is no per-call browser-binary argument; the model cannot point navigation at a different engine than the deployment configured.

### When to choose it

Choose this package when the model must verify a rendered page — layout, labels, and the accessibility tree — rather than fetch document text. Skip it for search or for reading a URL as markdown; those are `web_search` and `web_fetch`. Skip it when no Chromium binary is available and the deployment cannot set `executablePath` or `channel`.

### Minimal configuration

All fields have defaults. A composition row with no `config` launches headless Chromium on first navigate:

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

| Tool | Args | Behavior |
|---|---|---|
| `browser_navigate` | `url` (string) | Opens an absolute http(s) URL in the shared tab and waits until `domcontentloaded`. Returns `{ url, title }` after redirects. Rejects `file:`, `data:`, other schemes, relative URLs, and URLs with userinfo. |
| `browser_snapshot` | `screenshot?` (boolean) | Returns `{ url, title, snapshot, truncated }` for the current tab. `snapshot` is the Playwright ARIA tree, cut to `snapshotMaxChars`. When `screenshot` is true, also writes a PNG under `screenshotDir` and adds `screenshotPath`. Fails if no page is open. |

| Key | Default | Meaning |
|---|---|---|
| `headless` | `true` | Launch Chromium headless. |
| `timeoutMs` | `30000` | Cooperative timeout for both tools, also forwarded as Playwright's navigation timeout. |
| `executablePath` | — | Absolute browser binary, when the deployment pins one. |
| `channel` | — | Playwright channel (`chrome`, `msedge`, `chromium`, …), when set. |
| `snapshotMaxChars` | `50000` | Inclusive cap on the accessibility tree, including the truncation footer. |
| `screenshotMaxBytes` | `2097152` | Byte cap on one PNG before it is written. |
| `screenshotDir` | a private directory under `os.tmpdir()` | Destination for exclusive owner-only PNG files. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-browser) is the exhaustive source for every accepted field and its JSDoc.

The first `browser_navigate` fails with install guidance when playwright-core cannot find Chromium. Install a browser with `pnpm exec playwright install chromium`, or set `executablePath` / `channel`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The standing preset mount shares one tab across agents on that preset: each `browser_navigate` replaces the page. Chromium is created on the first navigation and closed when the plugin fiber disposes. Screenshot files use directory mode `0700` and exclusive `wx` creates at `0600`. Caller `AbortSignal` races tab operations; Playwright work already in flight is not internally cancelled, and the next call still uses the same tab.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md)
- [Adding a package with a tool](../../../docs/cookbook/adding-a-package.md)
- [Tool authoring](../../../docs/cookbook/adding-a-tool.md)

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`browser_navigate` / `browser_snapshot` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser). The descriptions state http(s)-only URLs, the shared tab, and that screenshot bytes are not returned; launch binaries, channels, and timeouts are not model-facing.

#### Token effect

Fixed schema cost per request while the tools are registered.

#### KV Cache effect

Prefix-stable while the schemas and descriptions are unchanged; plugin lifecycle or config changes that alter a description may invalidate reuse from the first changed schema token.

### Result

#### What the model sees

Navigate results render as `Navigated to <url>` plus the document title when it is non-empty. Snapshot results render the URL, title, accessibility tree, and an optional `Screenshot: <path>` line. Failure results carry a `browser:`-prefixed message (URL policy, no open page, launch failure, abort, timeout, or screenshot bound).

#### Token effect

Data-dependent results are resent until compaction; the tools add no persistent prompt sections.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One shared tab** — the standing preset mount does not isolate a browser per agent session; a later navigate replaces the page for every agent on that preset.
- **Chromium must be present** — `playwright-core` does not download a browser at install time; a host without Chromium, `executablePath`, or `channel` fails at first navigate.
- **No click or type** — this package verifies by navigate plus snapshot; pointer and keyboard interaction are out of scope.
- **No cookie jar across process restarts** — the engine is created per plugin fiber and discarded on dispose.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [browser verify tools decision](../../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.md) records why this sits beside `web/` and launches Chromium only on first navigate.

</details>

**Runtime invariant:** No companion is published: the browser tools own no cross-plugin runtime relation.
