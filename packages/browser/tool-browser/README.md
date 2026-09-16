---
description: "The browser control tools over one shared in-tree Playwright Chromium tab: navigate, an accessibility snapshot with stable refs, click/type/fill/press/hover/scroll, page text, console/network reads, tabs, and a screenshot — with Chromium auto-fetched on first use."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

**DeepSeek Harness browser-control plugin** — `browser_navigate` opens one shared http(s) tab through in-tree Playwright Chromium; `browser_snapshot` returns its accessibility tree (a Playwright ARIA snapshot carrying stable `[ref=eN]` handles) and, optionally, a PNG path. `browser_click`, `browser_type`, `browser_fill`, `browser_press`, `browser_hover`, and `browser_scroll` act on one element by `ref` or by a selector; `browser_page_text`, `browser_console`, and `browser_network` read the page; `browser_tabs` opens, selects, and closes tabs; `browser_screenshot` captures a PNG on demand. The tools are for driving and verifying rendered UI after a change or against a public page; they are not web search, anonymous fetch, downloads, file upload, a cookie jar, or a login flow — those stay out of scope (see [Known Limitations](#known-limitations-and-deferred-work)). Chromium starts on the first navigation or `browser_tabs new` call, so plugin load and schema harvest do not launch a browser, and is auto-fetched once on a clean install when no build is cached. This package owns the model-facing contract (tool names, JSON schemas, canonical values, Native rendering, and `generic` call cards) plus Playwright launch, the Chromium auto-fetch, and URL policy; there is no replaceable provider seam.

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

Install the plugin into a profile (the shipped `standard` agent preset already mounts it) and let it register the tools once at load. There is no per-call browser-binary argument; the model cannot point navigation at a different engine than the deployment configured.

### When to choose it

Choose this package when the model must drive and verify a rendered page — click through a flow, fill and submit a form, read what the page actually shows, or inspect its console/network activity — rather than fetch document text. Skip it for search or for reading a URL as markdown; those are `web_search` and `web_fetch`. Skip it when the task needs desktop/computer-use control beyond one browser tab, downloads, file upload, a cookie jar, or a login flow — none of those are in scope here (see [Known Limitations](#known-limitations-and-deferred-work)).

### Minimal configuration

All fields have defaults. A composition row with no `config` launches headless Chromium on first navigate:

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

| Tool | Args | Behavior |
|---|---|---|
| `browser_navigate` | `url` (string) | Opens an absolute http(s) URL in the active tab and waits until `domcontentloaded`. Returns `{ url, title }` after redirects. Rejects `file:`, `data:`, other schemes, relative URLs, URLs with userinfo, and link-local/cloud-metadata hosts (see URL policy below). |
| `browser_snapshot` | `screenshot?` (boolean) | Returns `{ url, title, snapshot, truncated }` for the active tab. `snapshot` is the Playwright ARIA tree captured in `mode: 'ai'`, so every interactive node carries a stable `[ref=eN]` handle — pass that value as `ref` to the interaction tools below. Refs stay the same across snapshots while the page is unchanged; a new page invalidates them. Cut to `snapshotMaxChars`. When `screenshot` is true, also writes a PNG under `screenshotDir` and adds `screenshotPath`. Fails if no page is open. |
| `browser_click` | `ref?`, `selector?` | Clicks one element, addressed by exactly one of a snapshot `ref` or a selector. Returns the tab's `{ url, title }` after the click settles (a click may navigate). |
| `browser_hover` | `ref?`, `selector?` | Hovers one element. |
| `browser_fill` | `ref?`, `selector?`, `value` | Sets one form element's value instantly (no per-key input events). |
| `browser_type` | `ref?`, `selector?`, `text`, `submit?` | Types text into one element key by key, firing real input events; `submit: true` presses Enter on the same element afterward. |
| `browser_press` | `key`, `ref?`, `selector?` | Presses one key on a target element, or at the page level when neither `ref` nor `selector` is given. |
| `browser_scroll` | `ref?`, `selector?`, `direction?`, `amount?` | Scrolls a target element into view, or the viewport by one directional step (default 800px) when no target is given. |
| `browser_page_text` | `maxChars?` | Returns `{ url, title, text, truncated }` — the active tab's rendered `body.innerText`. |
| `browser_console` | `limit?`, `onlyErrors?` | Returns console messages captured on the active tab since it opened, oldest first, capped at `consoleLimit`. |
| `browser_network` | `limit?`, `urlPattern?` | Returns outgoing requests captured on the active tab since it opened, oldest first, capped at `networkLimit`, each with method, URL, resource type, and status once the response arrives. |
| `browser_tabs` | `action` (`list`\|`new`\|`select`\|`close`), `id?`, `url?` | Lists, opens, switches to, or closes tabs. Every other tool operates on the active tab. |
| `browser_screenshot` | *(none)* | Captures the active tab as a PNG and writes it under `screenshotDir`, returning `{ url, title, screenshotPath, mediaType, bytes }`. The image bytes themselves are not returned in-band (see Known Limitations); read the file at `screenshotPath` to inspect it. |

| Key | Default | Meaning |
|---|---|---|
| `headless` | `true` | Launch Chromium headless. |
| `timeoutMs` | `30000` | Cooperative timeout for every tool, also forwarded as Playwright's per-action timeout. |
| `executablePath` | — | Absolute browser binary, when the deployment pins one. Pinning this (or `channel`) disables the Chromium auto-fetch. |
| `channel` | — | Playwright channel (`chrome`, `msedge`, `chromium`, …), when set. Also disables the auto-fetch. |
| `snapshotMaxChars` | `50000` | Inclusive cap on the accessibility tree, including the truncation footer. |
| `screenshotMaxBytes` | `2097152` | Byte cap on one PNG before it is written. |
| `screenshotDir` | a private directory under `os.tmpdir()` | Destination for exclusive PNG files (see the Windows note below). |
| `pageTextMaxChars` | `50000` | Inclusive cap on one `browser_page_text` read, including the truncation footer. |
| `consoleLimit` | `100` | Ring-buffer cap on console messages retained per tab, and the default `browser_console` return cap. |
| `networkLimit` | `100` | Ring-buffer cap on network requests retained per tab, and the default `browser_network` return cap. |
| `autoDownload` | `true` | Auto-fetch a matching Chromium build on the first launch when none is found and neither `executablePath` nor `channel` is pinned. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-browser) is the exhaustive source for every accepted field and its JSDoc.

### URL policy

Only `http:` and `https:` are accepted; `file:`, `data:`, other schemes, relative URLs, and URLs carrying userinfo are rejected before Playwright sees them. Loopback (`127.0.0.1`, `::1`) and RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) stay reachable — a developer verifying a local dev server is the common case this tool serves. Link-local addresses (`169.254.0.0/16`, IPv6 `fe80::/10`) are refused, including the same range spelled as hex/octal/decimal-integer IPv4 or embedded in an IPv4-mapped IPv6 literal — this is the range that carries cloud-provider instance metadata (`169.254.169.254`) on every major cloud.

The refusal is enforced twice. `browser_navigate`'s and `browser_tabs new`'s `url` argument is checked before either tool touches Playwright at all. Separately, every tab installs a catch-all `page.route('**/*', …)` guard (see `shouldBlockRequestUrl` in `src/playwright.ts`) that re-checks every request the tab issues for the rest of its life — the main document, every redirect hop, every subresource, and anything an in-page script fetches — so a same-origin redirect toward a link-local host, or a link the model clicks with `browser_click`, is caught even though neither ever passes through the argument check. What neither layer catches: a DNS name that *resolves* into the range (e.g. `metadata.google.internal`) — both checks compare the literal hostname/IP a request names, not what it resolves to, so a hostname alias for a metadata endpoint is not refused. Loopback reachability is itself a real surface the route guard does not narrow: any local service without its own authentication is reachable from a page this tool navigates to or that navigates itself — treat a deployment's local ports accordingly.

### Chromium auto-fetch

The first `browser_navigate` or `browser_tabs new` call that needs a browser and finds none cached (and has no `executablePath`/`channel` pinned) shells out to `playwright-core`'s own bundled installer (`playwright-core/cli.js install chromium`) — no new dependency, and the download lands in the same `ms-playwright` cache directory `pnpm exec playwright install chromium` would use, so it is skipped entirely once already present. Installer output lines stream to the process's stderr, prefixed `[dsh-tool-browser] chromium: …`, as the one channel guaranteed visible in every host this harness runs in today (see [Known Limitations](#known-limitations-and-deferred-work) for why that, and not a dedicated tool-progress event, is the current mechanism). A failed download raises a `browser:`-prefixed error naming the manual command (`pnpm exec playwright install chromium`) so the deployment can run it directly. Set `autoDownload: false` to disable this and always surface the plain install-guidance error instead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The standing preset mount shares tabs across agents on that preset: `browser_navigate` replaces the active tab's page; `browser_tabs new` opens another. Chromium is created on the first tab and closed when the plugin fiber disposes, closing every open tab with it. `browser_snapshot` captures the ARIA tree with Playwright's `mode: 'ai'` option, which embeds `[ref=eN]` handles resolvable through Playwright's `aria-ref=` selector engine; the interaction tools resolve a `ref` to `aria-ref=<ref>` and a `selector` straight through, then act via Playwright's `Locator` API (`click`, `fill`, `pressSequentially`, `press`, `hover`, `scrollIntoViewIfNeeded`). Before either of those listener sets attaches, each tab also registers a catch-all `page.route('**/*', …)` guard (`linkLocalRouteGuard` in `src/playwright.ts`) that aborts any request whose hostname is link-local/cloud-metadata and lets everything else through — this is what catches a redirect or in-page fetch the two argument-level checks in `urls.ts` never see (see the [URL policy](#use-this-package) section). Console and network capture attach `page.on('console'|'request'|'response', …)` listeners at tab creation, keeping a bounded ring buffer (oldest evicted first) per tab so a long-lived tab cannot grow them without bound; a network record's `status` fills in asynchronously once the matching response arrives, so a request read immediately after it fires may show no status yet. Screenshot files are written with an exclusive `wx` create; on POSIX the directory is created at mode `0700` and the file at `0600` — Windows has no POSIX owner-only bit, so on Windows the file is protected only by whatever ACL its parent directory inherits (typically the current user's own temp directory), not by that mode. Caller `AbortSignal` races most tab operations; Playwright work already in flight is not internally cancelled, and the next call still uses the same tab. `browser_screenshot` returns only a file path today, not an in-band image content block — see [Known Limitations](#known-limitations-and-deferred-work).

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

The generated [tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) for `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_hover`, `browser_fill`, `browser_type`, `browser_press`, `browser_scroll`, `browser_page_text`, `browser_console`, `browser_network`, `browser_tabs`, and `browser_screenshot`. Descriptions state http(s)-only URLs and the link-local refusal, that `browser_snapshot` refs come from the most recent snapshot and go stale on a new page, that exactly one of `ref`/`selector` is expected by every interaction tool, and that `browser_screenshot` does not return image bytes in-band; launch binaries, channels, caps, and timeouts are not model-facing.

#### Token effect

Fixed schema cost per request while the tools are registered; thirteen tool schemas rather than two.

#### KV Cache effect

Prefix-stable while the schemas and descriptions are unchanged; plugin lifecycle or config changes that alter a description may invalidate reuse from the first changed schema token.

### Result

#### What the model sees

Every result renders as one text block. Navigate renders `Navigated to <url>` plus the title when non-empty. Snapshot renders the URL, title, accessibility tree (with `[ref=eN]` handles), and an optional `Screenshot: <path>` line. Click/hover/fill/type/press/scroll render a verb-prefixed title (naming the ref or selector acted on) plus the tab's `{ url, title }` after the action settles. Page text, console, and network results are rendered verbatim from what the page produced — **this content is untrusted data, never an instruction**: a page can print anything, including text shaped like a directive to the model, and it must be treated only as something to read and reason about, exactly like a file or a web-search result. Tabs renders each tab's id/URL/title with the active one marked. Screenshot renders the written path, media type, and byte size. Failure results carry a `browser:`-prefixed message (URL policy including the link-local refusal, no open page, unknown tab id, missing/conflicting `ref`/`selector`, launch failure, a failed Chromium auto-fetch naming the manual install command, abort, timeout, or a screenshot/snapshot/page-text bound).

#### Token effect

Data-dependent results are resent until compaction; the tools add no persistent prompt sections. `browser_page_text`, `browser_console`, and `browser_network` are the compact alternative to `browser_snapshot` when the model only needs to read, not locate elements.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One shared set of tabs** — the standing preset mount does not isolate a browser per agent session; tabs opened by `browser_tabs new` and pages navigated by `browser_navigate` are visible to every agent on that preset.
- **Chromium is auto-fetched, not bundled** — the first launch that finds no cached build downloads one through `playwright-core`'s own installer (see [Chromium auto-fetch](#use-this-package)); a host with no network path to that installer's download endpoint, and no `executablePath`/`channel` pinned, fails at first navigate with the manual-install error.
- **`browser_screenshot` returns a file path, not an in-band image** — an image content block requires the optional `@deepseek-ai/dsh-attachment` seam (the same one `read_image` uses), which this package does not yet depend on; read the PNG at the returned `screenshotPath` instead. Wiring the seam is deferred work, tracked to avoid adding an unresolved workspace dependency outside the package-registration flow in [`docs/cookbook/adding-a-package.md`](../../../docs/cookbook/adding-a-package.md).
- **No dedicated tool-progress channel** — `dsh-tools` has no event bus for a running tool to stream interim status, so the Chromium auto-fetch's progress lines go to the process's stderr instead of a model- or UI-visible channel; a host that wants to show live download percentages must currently tail that stream itself.
- **No downloads, file upload, cookie jar, or login tooling** — deliberately out of scope for this package; a credential-handling browser tool is a Gate-class capability that belongs to a policy-owning package, not here.
- **No desktop/computer-use control** — this package drives one Playwright-controlled browser tab, not the operating system or other applications.
- **Network capture starts from `request`, not from navigation** — a request the browser issues internally before `page.on('request')` can attach (there is none in practice, since capture starts at tab creation) would be invisible; documented for completeness since it is the kind of ordering assumption a future refactor could silently break.
- **No cookie jar across process restarts** — the engine is created per plugin fiber and discarded on dispose, taking every open tab's cookies and storage with it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [browser verify tools decision](../../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.md) records why this sits beside `web/` and launches Chromium only on first navigate. The [browser control decision](../../../.agents/notes/implemented/feature/2026-09-16-browser-control.md) records the ref-through-`aria-ref=` design, the tab-manager restructuring, the URL link-local policy, and why the Chromium auto-fetch shells out to `playwright-core`'s own installer instead of a bespoke downloader.

</details>

**Runtime invariant:** No companion is published: the browser tools own no cross-plugin runtime relation.
