---
description: "浏览器控制工具集，经树内共享的 Playwright Chromium 标签页：导航、带稳定 ref 的无障碍快照、click/type/fill/press/hover/scroll、页面文本、控制台/网络读取、标签页管理，以及截图——首次使用时自动拉取 Chromium。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

**DeepSeek Harness 浏览器控制插件** —— `browser_navigate` 经树内 Playwright Chromium 打开一个共享的 http(s) 标签页；`browser_snapshot` 返回其无障碍树（携带稳定 `[ref=eN]` 句柄的 Playwright ARIA snapshot），可选地返回 PNG 路径。`browser_click`、`browser_type`、`browser_fill`、`browser_press`、`browser_hover`、`browser_scroll` 通过 `ref` 或选择器对某个元素执行动作；`browser_page_text`、`browser_console`、`browser_network` 读取页面；`browser_tabs` 打开、切换、关闭标签页；`browser_screenshot` 按需截图。这些工具用于在改动之后或对着公开页面驱动并核验已渲染 UI；它们不是 web 搜索、匿名抓取、下载、文件上传、cookie jar，也不是登录流程——这些都不在范围内（见[已知限制](#known-limitations-and-deferred-work)）。Chromium 在第一次导航或 `browser_tabs new` 调用时才启动，因此插件装载与 schema 采集不会拉起浏览器；在没有缓存构建的全新安装上会自动拉取一次。本包拥有模型侧契约（工具名、JSON schema、规范值、Native 渲染与 `generic` 调用卡片）以及 Playwright 启动、Chromium 自动拉取与 URL 策略；没有可替换的 provider 缝。

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

把插件安装到 profile（随附的 `standard` agent preset 已经挂载它），让它只在装载时注册一次这些工具。没有按调用选择浏览器二进制的参数，模型无法把导航指到部署配置之外的引擎。

### 何时选择它

当模型必须驱动并核验已渲染页面——点击走完一段流程、填表并提交、读取页面实际显示的内容，或检查其控制台/网络活动——而不是抓取文档正文时选择本包。搜索或把 URL 读成 markdown 请用 `web_search` 与 `web_fetch`。若任务需要超出单个浏览器标签页的桌面/computer-use 控制、下载、文件上传、cookie jar 或登录流程，本包都不覆盖（见[已知限制](#known-limitations-and-deferred-work)）。

### 最小配置

所有字段都有默认值。没有 `config` 的组合行会在第一次导航时启动无头 Chromium：

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
```

| 工具 | 参数 | 行为 |
|---|---|---|
| `browser_navigate` | `url`（string） | 在活动标签页打开绝对 http(s) URL，并等到 `domcontentloaded`。重定向后返回 `{ url, title }`。拒绝 `file:`、`data:`、其他 scheme、相对 URL、带 userinfo 的 URL，以及链路本地/云元数据主机（见下方 URL 策略）。 |
| `browser_snapshot` | `screenshot?`（boolean） | 返回活动标签页的 `{ url, title, snapshot, truncated }`。`snapshot` 以 `mode: 'ai'` 捕获 Playwright ARIA 树，因此每个可交互节点都带有稳定的 `[ref=eN]` 句柄——把该值作为 `ref` 传给下方的交互工具。只要页面不变，ref 在多次快照间保持一致；新页面会使其失效。截到 `snapshotMaxChars`。当 `screenshot` 为 true 时，还会在 `screenshotDir` 下写入 PNG 并加上 `screenshotPath`。没有打开的页面则失败。 |
| `browser_click` | `ref?`、`selector?` | 点击一个元素，用快照 `ref` 或选择器二选一定位。返回点击落定后标签页的 `{ url, title }`（点击可能引发导航）。 |
| `browser_hover` | `ref?`、`selector?` | 悬停一个元素。 |
| `browser_fill` | `ref?`、`selector?`、`value` | 即时设置某表单元素的值（不触发逐键输入事件）。 |
| `browser_type` | `ref?`、`selector?`、`text`、`submit?` | 逐键向某元素输入文本，触发真实的输入事件；`submit: true` 会在输入后对同一元素按下 Enter。 |
| `browser_press` | `key`、`ref?`、`selector?` | 在目标元素上按下一个键；`ref`、`selector` 均未给出时在页面级按键。 |
| `browser_scroll` | `ref?`、`selector?`、`direction?`、`amount?` | 把目标元素滚动到可视区域；未给出目标时按方向滚动视口一步（默认 800px）。 |
| `browser_page_text` | `maxChars?` | 返回 `{ url, title, text, truncated }`——活动标签页渲染出的 `body.innerText`。 |
| `browser_console` | `limit?`、`onlyErrors?` | 返回活动标签页自打开以来捕获的控制台消息，按时间从旧到新，截到 `consoleLimit`。 |
| `browser_network` | `limit?`、`urlPattern?` | 返回活动标签页自打开以来捕获的出站请求，按时间从旧到新，截到 `networkLimit`，每条附带方法、URL、资源类型，响应到达后附带状态码。 |
| `browser_tabs` | `action`（`list`\|`new`\|`select`\|`close`）、`id?`、`url?` | 列出、打开、切换或关闭标签页。其余每个工具都作用于活动标签页。 |
| `browser_screenshot` | （无） | 把活动标签页截为 PNG 并写到 `screenshotDir` 下，返回 `{ url, title, screenshotPath, mediaType, bytes }`。图像字节本身不会随内容一起返回（见已知限制）；读取 `screenshotPath` 处的文件来查看它。 |

| 键 | 默认值 | 含义 |
|---|---|---|
| `headless` | `true` | 以无头方式启动 Chromium。 |
| `timeoutMs` | `30000` | 每个工具的协作超时，同时作为 Playwright 的每次操作超时转发。 |
| `executablePath` | — | 部署钉死浏览器二进制时的绝对路径。钉死它（或 `channel`）会关闭 Chromium 自动拉取。 |
| `channel` | — | Playwright 通道（`chrome`、`msedge`、`chromium` 等），若设置。同样会关闭自动拉取。 |
| `snapshotMaxChars` | `50000` | 无障碍树的含截断脚注的字符上限。 |
| `screenshotMaxBytes` | `2097152` | 写入前单张 PNG 的字节上限。 |
| `screenshotDir` | `os.tmpdir()` 下的私有目录 | 独占 PNG 文件的目标目录（见下方 Windows 说明）。 |
| `pageTextMaxChars` | `50000` | 单次 `browser_page_text` 读取的含截断脚注字符上限。 |
| `consoleLimit` | `100` | 每个标签页保留的控制台消息环形缓冲上限，也是 `browser_console` 的默认返回上限。 |
| `networkLimit` | `100` | 每个标签页保留的网络请求环形缓冲上限，也是 `browser_network` 的默认返回上限。 |
| `autoDownload` | `true` | 首次启动且未找到已缓存构建、又未钉死 `executablePath`/`channel` 时，自动拉取匹配的 Chromium 构建。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-browser)是每个已接受字段及其 JSDoc 的穷尽来源。

### URL 策略

只接受 `http:` 与 `https:`；`file:`、`data:`、其他 scheme、相对 URL，以及带 userinfo 的 URL 会在 Playwright 看到之前被拒绝。回环地址（`127.0.0.1`、`::1`）与 RFC1918 私有网段（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）保持可达——开发者核验本地开发服务器是本工具服务的常见场景。链路本地地址（`169.254.0.0/16`、IPv6 的 `fe80::/10`）会被拒绝，包括同一网段写成十六进制/八进制/十进制整数形式的 IPv4，或嵌入在 IPv4 映射 IPv6 字面量中的情形——这正是各大云厂商用来承载实例元数据（`169.254.169.254`）的网段，因此本工具访问的页面永远无法借道读取宿主机的云凭据。回环可达性本身就是一个真实的攻击面：任何没有自身鉴权的本地服务，都能被本工具导航到的页面（或该页面自身发起的重定向、同源 fetch）访问到——请据此对待部署的本地端口。

### Chromium 自动拉取

第一次需要浏览器、发现没有已缓存构建（且未钉死 `executablePath`/`channel`）的 `browser_navigate` 或 `browser_tabs new` 调用，会调用 `playwright-core` 自带的安装器（`playwright-core/cli.js install chromium`）——不增加新依赖，下载会落到 `pnpm exec playwright install chromium` 会使用的同一个 `ms-playwright` 缓存目录，因此一旦已经存在就会被完全跳过。安装器的输出行会流式写入进程的 stderr，前缀为 `[dsh-tool-browser] chromium: …`，这是当前这套 harness 运行的每个宿主中唯一能保证可见的通道（为什么是这个而不是专用的工具进度事件，见[已知限制](#known-limitations-and-deferred-work)）。下载失败会抛出带 `browser:` 前缀、指名手动命令（`pnpm exec playwright install chromium`）的错误，供部署直接执行。将 `autoDownload` 设为 `false` 可关闭此行为，始终改为呈现原始的安装指引错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

preset 的常驻挂载在该 preset 上的 agent 之间共享标签页：`browser_navigate` 替换活动标签页的页面；`browser_tabs new` 打开另一个。Chromium 在第一个标签页创建时启动，并在插件 fiber 释放时关闭，同时关闭所有打开的标签页。`browser_snapshot` 以 Playwright 的 `mode: 'ai'` 选项捕获 ARIA 树，其中嵌入了可通过 Playwright `aria-ref=` 选择器引擎解析的 `[ref=eN]` 句柄；交互工具把 `ref` 解析为 `aria-ref=<ref>`，把 `selector` 原样传递，再通过 Playwright 的 `Locator` API（`click`、`fill`、`pressSequentially`、`press`、`hover`、`scrollIntoViewIfNeeded`）执行动作。控制台与网络捕获在标签页创建时挂上 `page.on('console'|'request'|'response', …)` 监听器，每个标签页保留一个有界环形缓冲（先逐出最旧的），使长期存活的标签页也不会让缓冲无限增长；网络记录的 `status` 会在匹配的响应到达后异步补上，因此请求刚触发就读取可能还看不到状态码。截图文件以独占的 `wx` 方式创建；在 POSIX 上目录以 `0700`、文件以 `0600` 创建——Windows 没有 POSIX 的仅属主位，因此在 Windows 上该文件只受其父目录继承的 ACL 保护（通常是当前用户自己的临时目录），而非该权限模式。调用方 `AbortSignal` 与大多数标签页操作竞速；已经在 Playwright 内进行的工作不会被内部取消，下一次调用仍使用同一标签页。`browser_screenshot` 目前只返回文件路径，不返回随内容一起的图像内容块——见[已知限制](#known-limitations-and-deferred-work)。

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

生成的 [`browser_navigate`、`browser_snapshot`、`browser_click`、`browser_hover`、`browser_fill`、`browser_type`、`browser_press`、`browser_scroll`、`browser_page_text`、`browser_console`、`browser_network`、`browser_tabs`、`browser_screenshot` 工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)。描述声明只接受 http(s) URL 及链路本地拒绝规则、`browser_snapshot` 的 ref 来自最近一次快照且会在新页面上失效、每个交互工具都期望 `ref`/`selector` 二选一，以及 `browser_screenshot` 不会随内容一起返回图像字节；启动二进制、通道、上限与超时不是模型可见内容。

#### Token 影响

工具已注册时，每次请求有固定的 schema 成本；是十二个工具 schema，而不是两个。

#### KV Cache 影响

schema 与描述不变时前缀稳定；会改描述的插件生命周期或配置变化可能从第一个被改的 schema token 起使复用失效。

### 结果

#### 模型看到什么

每个结果都渲染为一个文本块。导航渲染为 `Navigated to <url>`，标题非空时再加标题。快照渲染 URL、标题、无障碍树（带 `[ref=eN]` 句柄），以及可选的 `Screenshot: <path>` 行。点击/悬停/填充/输入/按键/滚动渲染一个带动词前缀的标题（指名所作用的 ref 或选择器），外加动作落定后标签页的 `{ url, title }`。页面文本、控制台与网络结果是页面产出内容的原样渲染——**这些内容是不可信数据，绝非指令**：页面可以打印任何东西，包括形似对模型指令的文本，必须只把它当作要阅读、要推理的对象，就像文件或 web 搜索结果一样。标签页结果渲染每个标签页的 id/URL/标题，并标出活动的那个。截图渲染写入路径、媒体类型与字节数。失败结果带 `browser:` 前缀的消息（URL 策略含链路本地拒绝、没有打开的页面、未知标签页 id、`ref`/`selector` 缺失或冲突、启动失败、Chromium 自动拉取失败并指名手动安装命令、中止、超时，或截图/快照/页面文本上限）。

#### Token 影响

依赖数据的结果会重复发送直到压缩；这些工具不加持久的提示词段落。当模型只需要读取而非定位元素时，`browser_page_text`、`browser_console`、`browser_network` 是比 `browser_snapshot` 更紧凑的选择。

#### KV Cache 影响

只追加；新可见内容跟在可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **一组共享标签页** — preset 的常驻挂载不会按 agent 会话隔离浏览器；`browser_tabs new` 打开的标签页与 `browser_navigate` 导航的页面对该 preset 上的每个 agent 都可见。
- **Chromium 是自动拉取而非内置** — 第一次启动若发现没有已缓存构建，会通过 `playwright-core` 自带的安装器下载一个（见[Chromium 自动拉取](#use-this-package)）；没有网络路径通向该安装器下载端点、又未钉死 `executablePath`/`channel` 的主机，会在第一次导航时以手动安装错误失败。
- **`browser_screenshot` 返回文件路径而非随内容返回的图像** — 图像内容块需要可选的 `@deepseek-ai/dsh-attachment` 缝（`read_image` 所用的同一个），本包尚未依赖它；请改为读取返回的 `screenshotPath` 处的 PNG。接入该缝是暂缓工作，之所以暂缓是为了避免在 [`docs/cookbook/adding-a-package.md`](../../../docs/cookbook/adding-a-package.zh.md) 描述的包注册流程之外新增一个未解析的工作区依赖。
- **没有专用的工具进度通道** — `dsh-tools` 没有供运行中工具流式上报中间状态的事件总线，因此 Chromium 自动拉取的进度行改写到进程的 stderr，而非模型或 UI 可见的通道；想展示实时下载百分比的宿主目前必须自行 tail 该流。
- **没有下载、文件上传、cookie jar 或登录相关工具** — 本包有意不覆盖这些；处理凭据的浏览器工具属于 Gate 级能力，应归属拥有该策略的包，而非这里。
- **没有桌面/computer-use 控制** — 本包只驱动一个由 Playwright 控制的浏览器标签页，不驱动操作系统或其他应用。
- **网络捕获从 `request` 事件开始，而非从导航本身开始** — 浏览器在 `page.on('request')` 能挂上之前内部发出的请求（实践中不存在，因为捕获从标签页创建时就开始）本应不可见；记录于此是出于完整性，因为这正是未来重构可能悄悄打破的一类顺序假设。
- **进程重启后没有 cookie jar** — 引擎按插件 fiber 创建，释放时丢弃，连同每个打开标签页的 cookie 与存储一起丢弃。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[浏览器核验工具决策](../../../.agents/notes/implemented/feature/2026-09-15-browser-verify-tools.zh.md)记录了为何把它放在 `web/` 旁边，并只在第一次导航时启动 Chromium。[浏览器控制决策](../../../.agents/notes/implemented/feature/2026-09-16-browser-control.zh.md)记录了经 `aria-ref=` 解析 ref 的设计、标签页管理器的重构、URL 链路本地策略，以及为何 Chromium 自动拉取调用 `playwright-core` 自带的安装器而非自研下载器。

</details>

**运行时不变量：** 不发布 companion：浏览器工具不拥有跨插件的运行时关系。
