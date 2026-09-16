# Agent Note：浏览器控制能力对齐——ref、交互、读取、标签页、自动拉取

Status: implemented

[English](2026-09-16-browser-control.md) | 中文

## 问题

`@deepseek-ai/dsh-tool-browser` 能打开页面并读取其无障碍树，但不能对它采取动作：没有 click、type、fill、press、hover、scroll，没有确定性地定位单个元素的方式，没有控制台/网络可见性，没有第二个标签页，也没有截图字节。全新的 Saturn 安装也没有已缓存的 Chromium，因此在纯净 PC 上第一次导航只会带着安装指引失败，不会自行继续。Mars 差距审查（`mars-gap-plan.json`，第 2 条修正）还纠正了架构师原计划：`browser_snapshot` 已经返回 Playwright ARIA 无障碍树——正是 `read_page` 的等价物——所以正确做法是对它做加法式扩展、加上稳定 ref，而不是再造一个并行工具。

## 决策

把 `browser_snapshot` 扩展为用 Playwright 的 `ariaSnapshot({ mode: 'ai' })` 捕获 ARIA 树，该模式会嵌入可通过 Playwright 自带 `aria-ref=` 定位器选择器引擎解析的 `[ref=eN]` 句柄——已用一段探针脚本对真实 Chromium 做过实证：在页面不变的情况下两次快照调用结果完全相同，且即便之后又发生过快照调用，`page.locator('aria-ref=e3')` 仍能正确解析。这意味着不需要自建一套 shadow-DOM ref 追踪层：`session.ts` 中的 `resolveElementSelector({ ref, selector })` 把 `ref` 映射为 `aria-ref=<ref>`，把 `selector` 原样传递，每个交互工具都要求二者恰好给一个。

新增工具：`browser_click`、`browser_hover`、`browser_fill`、`browser_type`（带 `submit`）、`browser_press`（定向或页面级）、`browser_scroll`（元素滚入视野或按方向滚动视口）、`browser_page_text`、`browser_console`、`browser_network`、`browser_tabs`（list/new/select/close）、`browser_screenshot`。`BrowserSession`（`session.ts`）从单一 `tab` 字段重构为带 `activeId` 的 `ManagedTab[]` 列表，同时保留了原单标签页实现所依赖的精确启动/释放竞态契约（并发的 `dispose()` 必须让刚启动的进程恰好关闭一次，不能是零次或两次）——这要求不能把 `process.newTab()` 本身与调用方的 `AbortSignal` 竞速（只有启动本身和随后的导航才竞速），与原 `ensureTab` 的行为完全一致，否则一个既有的中止竞态测试就会从"关闭一次"变成"关闭零次"。

控制台与网络捕获在标签页创建时一次性挂上 `page.on('console'|'request'|'response', …)` 监听器，写入每个标签页各自的、按部署 `consoleLimit`/`networkLimit` 设限的环形缓冲（先逐出最旧的）；网络记录的 `status` 通过 `response` 事件异步补上，用 `WeakMap` 以 `Request` 对象（而非 URL）为键关联——因为 URL 可能在多个请求间重复。

**Chromium 自动拉取。** `downloader.ts` 调用 `playwright-core` 自带的 CLI（`playwright-core/cli.js install chromium`，路径通过 `dirname(require.resolve('playwright-core/package.json'))` 与 `cli.js` 拼接得到——该子路径是该包声明的 `bin` 目标，但不在 `exports` 列表中，因此要经由已解析的包目录而非包导出解析来访问），而不是自研一个 Chrome-for-Testing 下载器：它总是拉取该版本 `playwright-core` 所期望的确切构建，落到与 `pnpm exec playwright install chromium` 相同的 `ms-playwright` 缓存目录（因此之后的手动安装，或另一个包自己的 Playwright，会看到同一份缓存并跳过重新下载），且不需要新依赖。`playwright.ts` 通过匹配 Playwright 自身的 `Executable doesn't exist` 错误文案来判定"缺可执行文件"的启动失败，只在既未钉死 `executablePath` 也未钉死 `channel`、且 `autoDownload` 未被关闭时才尝试自动拉取，随后重试一次启动；下载失败的错误（在 `downloader.ts` 中铸造）本身已指名手动命令，因此 `launchPlaywright` 不会再次包装它。进度行会转发给调用方提供的 `onDownloadProgress` 回调；`index.ts` 把它接到 `process.stderr`，README 中记录了这是当前机制，原因是 `dsh-tools` 还没有专用的工具进度通道——这是一个真实的缺口，没有被掩饰。

**URL 策略。** `urls.ts` 拒绝 `169.254.0.0/16`（IPv4，包括十六进制/八进制/十进制整数写法，以及嵌入在 IPv4 映射 IPv6 字面量中的情形——WHATWG `URL` 解析器在这个检查运行之前就已经把前者规范化为点分十进制）与 IPv6 的 `fe80::/10`，同时保持回环地址与 RFC1918 私有网段可达，遵循任务书中"保留本地开发服务器核验能力"的明确指示。

**attachments 缝，刻意未接入。** `browser_screenshot` 只返回 `{ screenshotPath, mediaType, bytes }`，不通过 `read_image` 所用的 attachments 缝返回随内容一起的 `ImageBlock`。`@deepseek-ai/dsh-attachment` 不在本包的 `node_modules` 中（已确认：从本包 `require.resolve` 会失败，尽管该工作区包已经在 pnpm store 中构建好了），本包 `package.json` 也未声明它。仓库规则：一个需要但尚不可解析的依赖不能被静默加入并假定已安装——应报告并暂停该部分。已记录为一条已知限制与一项集成需求，而非用一个绕过未导入品牌类型的、鸭子类型/无类型的强制转换来敷衍过去。

## 曾考虑的替代方案

- **并行的 `read_page` 工具** — 原架构师计划的表述方式。依 Mars 的修正被否决：`browser_snapshot` 本身就已经是无障碍树读取；再加一个输出重叠的工具会打散模型侧接口，这正是 DSH 自身约定所警告的。
- **自建 ref 追踪层（通过注入脚本给 DOM 节点分配 ID）** — 一旦确认 Playwright 自带的 `mode: 'ai'` 快照与 `aria-ref=` 定位器引擎本身就做这件事，就没有必要了，而且这与 Playwright 自己的 MCP 服务器所用的机制相同。
- **一个直连 Chrome-for-Testing JSON 端点的下载器** — 任务书允许把它作为兜底方案，但 `playwright-core` 自带的安装器本身就是保证拿到确切期望构建、并复用标准缓存位置的机制；自己重做只会有偏离 `playwright-core` 自身版本锁定的风险。
- **把一个无类型的图像内容块强制转换进渲染输出，以满足"返回图像内容"这句字面要求** — 今天能让 `tsc` 通过，但会产出一个 `attachmentId` 并非合法带品牌 `AttachmentId` 的值，只是碰巧因为品牌在运行时被擦除才"正确"；否决，改为诚实地报告依赖缺口。

## 后果

`standard`/`cordis` preset 的浏览器能力从"导航加读取"变为真正的控制：模型可以只定位一次元素（通过 `browser_snapshot` 的 ref），只要页面不变，就能在 click/type/fill/press/hover/scroll 多次调用之间重复作用于它，无需每次都重新快照。`browser_tabs` 让一个 agent 能在原包既有的"每个 preset 共享标签页"模型内同时打开两个页面（例如对比前后状态）。没有已缓存 Chromium 时，全新安装不会再在第一次导航就走进死胡同——它会可见地下载一次，然后继续。`browser_screenshot` 的字节在后续为本包新增 `@deepseek-ai/dsh-attachment`（peer + dev 依赖，外加一条 `tsconfig.json` 引用）并执行 `pnpm install` 完成链接之前，会一直只以文件路径形式存在——这一点被明确点出，而非被默认忽略。
