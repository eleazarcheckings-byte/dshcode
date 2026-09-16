---
description: "browser 组地图：无头 Playwright Chromium 工具，打开 http(s) 页面并采集无障碍树或 PNG 截图。"
kind: "package-group"
---

# browser/ — 浏览器核验工具

[English](README.md) | 中文

## 概述

browser 组让模型核验已渲染 UI：经树内 Playwright Chromium 打开一个共享的 http(s) 标签页，采集无障碍树，并可选择写入 PNG 路径。它是一个产品包，注册 `browser_navigate` 与 `browser_snapshot`；Chromium 在第一次导航时才启动，因此装载与 schema 采集不会拉起浏览器。本组只拥有页面核验：web 搜索与匿名抓取仍在 [`web/`](../web/README.zh.md)。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tool-browser/`](tool-browser/README.zh.md) | 打开一个共享的 http(s) 标签页，并返回无障碍快照或 PNG 路径 | （注册于 `ctx.tools`） |

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser) — 模型收到的 `browser_navigate` 与 `browser_snapshot` schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-tool-browser) — 每个已接受的配置字段。
- [浏览器核验工具 Agent Note](../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.zh.md) — 为何放在 `web/` 旁边，并使用树内 Playwright。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
