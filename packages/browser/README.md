---
description: "The browser group map: headless Playwright Chromium tools that open an http(s) page and capture its accessibility tree or a PNG screenshot."
kind: "package-group"
---

# browser/ — browser verify tools

English | [中文](README.zh.md)

## Summary

The browser group lets the model verify rendered UI: open one shared http(s) tab through in-tree Playwright Chromium and capture an accessibility tree, optionally writing a PNG path. It is one product package that registers `browser_navigate` and `browser_snapshot`; Chromium starts on the first navigation so load and schema harvest do not launch a browser. The group owns page verify only: web search and anonymous fetch stay in [`web/`](../web/README.md).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-browser/`](tool-browser/README.md) | Opens one shared http(s) tab and returns an accessibility snapshot or PNG path | (registers on `ctx.tools`) |

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-browser) — the `browser_navigate` and `browser_snapshot` schemas the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-tool-browser) — every accepted config field.
- [Browser verify tools Agent Note](../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.md) — why this sits beside `web/` and uses in-tree Playwright.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
