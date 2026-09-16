---
description: "browser_navigate 与 browser_snapshot 工具：经树内 Playwright Chromium 打开一个共享的 http(s) 标签页，并返回无障碍树或 PNG 路径，供模型核验已渲染 UI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

**DeepSeek Harness 浏览器核验插件** —— `browser_navigate` 与 `browser_snapshot` 经树内 Playwright Chromium 打开一个共享的 http(s) 标签页，并返回无障碍树（Playwright ARIA snapshot），可选地将 PNG 写到磁盘。这些工具用于在改动之后或对着公开页面检查已渲染 UI；它们不是 web 搜索、匿名抓取，也不是营销向的浏览器 MCP。Chromium 在第一次导航时才启动，因此插件装载与 schema 采集不会拉起浏览器。本包拥有模型侧契约（工具名、JSON schema、规范值、Native 渲染与 `generic` 调用卡片）以及 Playwright 启动与 URL 策略；没有可替换的 provider 缝。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把插件安装到 profile（随附的 `standard` agent preset 已经挂载它），让它只在装载时注册一次这两个工具。没有按调用选择浏览器二进制的参数，模型无法把导航指到部署配置之外的引擎。

### 何时选择它

当模型必须核验已渲染页面——布局、标签与无障碍树——而不是抓取文档正文时选择本包。搜索或把 URL 读成 markdown 请用 `web_search` 与 `web_fetch`。若没有可用的 Chromium 二进制、部署又不能设置 `executablePath` 或 `channel`，则不必使用本包。

### 最小配置

所有字段都有默认值。没有 `config` 的组合行会在第一次导航时启动无头 Chromium：

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

| 工具 | 参数 | 行为 |
|---|---|---|
| `browser_navigate` | `url`（string） | 在共享标签页打开绝对 http(s) URL，并等到 `domcontentloaded`。重定向后返回 `{ url, title }`。拒绝 `file:`、`data:`、其他 scheme、相对 URL，以及带 userinfo 的 URL。 |
| `browser_snapshot` | `screenshot?`（boolean） | 返回当前标签页的 `{ url, title, snapshot, truncated }`。`snapshot` 是 Playwright ARIA 树，截到 `snapshotMaxChars`。当 `screenshot` 为 true 时，还会在 `screenshotDir` 下写入 PNG 并加上 `screenshotPath`。没有打开的页面则失败。 |

| 键 | 默认值 | 含义 |
|---|---|---|
| `headless` | `true` | 以无头方式启动 Chromium。 |
| `timeoutMs` | `30000` | 两个工具的协作超时，同时作为 Playwright 的导航超时转发。 |
| `executablePath` | — | 部署钉死浏览器二进制时的绝对路径。 |
| `channel` | — | Playwright 通道（`chrome`、`msedge`、`chromium` 等），若设置。 |
| `snapshotMaxChars` | `50000` | 无障碍树的含截断脚注的字符上限。 |
| `screenshotMaxBytes` | `2097152` | 写入前单张 PNG 的字节上限。 |
| `screenshotDir` | `os.tmpdir()` 下的私有目录 | 独占、仅属主 PNG 文件的目标目录。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-browser)是每个已接受字段及其 JSDoc 的穷尽来源。

当 playwright-core 找不到 Chromium 时，第一次 `browser_navigate` 会带着安装指引失败。用 `pnpm exec playwright install chromium` 安装浏览器，或设置 `executablePath` / `channel`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

preset 的常驻挂载在该 preset 上的 agent 之间共享一个标签页：每次 `browser_navigate` 都会替换页面。Chromium 在第一次导航时创建，并在插件 fiber 释放时关闭。截图文件使用目录模式 `0700` 以及 `0600` 的独占 `wx` 创建。调用方 `AbortSignal` 与标签页操作竞速；已经在 Playwright 内进行的工作不会被内部取消，下一次调用仍使用同一标签页。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具目录](../../../docs/tool-catalog.zh.md)
- [添加带工具的包](../../../docs/cookbook/adding-a-package.zh.md)
- [工具编写](../../../docs/cookbook/adding-a-tool.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [`browser_navigate` / `browser_snapshot` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)。描述声明只接受 http(s) URL、共享标签页，以及不返回截图字节；启动二进制、通道与超时不是模型可见内容。

#### Token 影响

工具已注册时，每次请求有固定的 schema 成本。

#### KV Cache 影响

schema 与描述不变时前缀稳定；会改描述的插件生命周期或配置变化可能从第一个被改的 schema token 起使复用失效。

### 结果

#### 模型看到什么

导航结果渲染为 `Navigated to <url>`，标题非空时再加文档标题。快照结果渲染 URL、标题、无障碍树，以及可选的 `Screenshot: <path>` 行。失败结果带 `browser:` 前缀的消息（URL 策略、没有打开的页面、启动失败、中止、超时或截图上限）。

#### Token 影响

依赖数据的结果会重复发送直到压缩；这些工具不加持久的提示词段落。

#### KV Cache 影响

只追加；新可见内容跟在可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **一个共享标签页** — preset 的常驻挂载不会按 agent 会话隔离浏览器；之后的导航会替换该 preset 上每个 agent 的页面。
- **必须有 Chromium** — `playwright-core` 不会在安装时下载浏览器；没有 Chromium、`executablePath` 或 `channel` 的主机在第一次导航时失败。
- **没有 click 或 type** — 本包通过导航加快照核验；指针与键盘交互不在范围内。
- **进程重启后没有 cookie jar** — 引擎按插件 fiber 创建，释放时丢弃。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[浏览器核验工具决策](../../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.zh.md)记录了为何把它放在 `web/` 旁边，并只在第一次导航时启动 Chromium。

</details>

**运行时不变量：** 不发布 companion：浏览器工具不拥有跨插件的运行时关系。
