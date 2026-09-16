# Agent Note: 基于树内 Playwright 的浏览器核验工具

Status: implemented

[English](2026-09-15-browser-verify-tools.md) | 中文

## 问题

随附的 coding agent 可以通过 `web_search` / `web_fetch` 搜索并抓取文档，但不能在真实浏览器中打开页面并读取已渲染的无障碍树。UI 工作于是停在 HTML 源码或营销向的 MCP 封装上。harness 的 Web e2e 已经依赖 Playwright，再引入第二套浏览器栈会重复那套引擎。

## 决策

在 `packages/browser/tool-browser` 发布 `@deepseek-ai/dsh-tool-browser`，并且只挂到 `standard` agent preset。面向模型的工具是 `browser_navigate` 与 `browser_snapshot`。Chromium 通过 `playwright-core` 在第一次导航时启动，并随插件 fiber 关闭。快照是 Playwright 的 ARIA 树；可选的 PNG 写到仅属主的临时路径，而不是以字节返回。URL 只接受 http(s)。`web-app` 或 `dsh-base` 补丁里没有 host 平面行；解析靠运行时闭包的 workspace 依赖，使 preset 的 specifier 能够装载。

## 曾考虑的替代方案

- **封装浏览器 MCP 或 chrome-devtools 覆盖层** — 会增加第二套引擎和营销向的工具目录。`apps/web` 使用的树内 Playwright 已经能启动 Chromium。
- **把工具放进 `packages/web/`** — 该组拥有搜索与匿名抓取，并声明它不浏览。`browser/` 组保持这一划分。
- **手写 CDP** — 会重做 Playwright 已经提供的启动、ARIA 快照与拆除。
- **按 agent 隔离浏览器** — preset 的常驻挂载共享一个标签页。按会话隔离浏览器会增加进程，而当前没有需要并发页面的消费者。

## 后果

`standard` preset 可以在不登录站点的情况下，对着公开 URL 或本地 fixture 核验已渲染 UI。没有 Chromium 的主机在第一次导航时带着安装指引失败，而不是在插件装载时失败，因此 schema 采集与无密钥单元测试保持绿色。click 与 type 留在本包之外；要加它们应是后续工具，而不是对 snapshot 的静默扩张。
