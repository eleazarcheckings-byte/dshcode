# Agent Note: 与 deepseek-ai/deepseek-harness 的上游对齐评估

Status: proposed

[English](2026-09-15-upstream-reconciliation.md) | 中文

## 问题

`dshcode`（`origin` = `whitelonng/dshcode`，`HEAD` = `5dd99fb`）是 DeepSeek `deepseek-harness` 的一个 fork。其上叠加了 16 个 `@saturnai/*` 包及一次仓库级重新品牌（相对 `origin/master` 共 947 个文件变更，+40,148/-5,648 行）。该 fork 自 `dsh-v0.1.2-alpha.4`（2026-09-01）后再未合入任何上游发布。此后上游已发布九个版本，最新为 `dsh-v0.1.6-alpha.1`（2026-09-15）——合计 **8,570 个文件变更，+999,931/-111,317 行**，其中包括 MCP SDK v2 升级、子代理/Team 模式重写（`spawn_teammate` 取代 `subagent`/`subagent_fork`，队友上限由 8 增至 16）、DeepSeek 适配器协议切换（Messages 取代旧版 completions 默认值）以及 `PTC`/`workflow` 系列包重命名。在分叉进一步累积之前，决定是否以及如何吸收这些发布，需要一个真实的冲突评估，而非猜测。

## 方案

**在此仓库中，冲突测算并非一次标准的 `git merge-tree` 任务——这本身就是第一项发现。** `origin/master` 与 `upstream-dsh/master`（`https://github.com/deepseek-ai/deepseek-harness.git`，已作为远端 `upstream-dsh` 添加并抓取——17 个 tag，`master` 位于 `0d1f500`）**没有共同祖先**：`git merge-base origin/master upstream-dsh/master` 退出码为 1，`git merge-base --is-ancestor dsh-v0.1.2-alpha.4 HEAD` 同样退出码为 1——尽管 fork 自身的 `REBRAND.md`/侦察记录都认为它衍生自该版本。`whitelonng/dshcode` 是在某个时间点对上游做的**内容快照**，而非保留提交历史的真实 fork——因此 `git merge-tree --write-tree HEAD <上游 tag>` 直接失败（`fatal: refusing to merge unrelated histories`），而 `git merge-tree --write-tree --allow-unrelated-histories HEAD dsh-v0.1.6-alpha.1` 在 8 分钟预算内未能返回（约 10 分钟后被终止；在这个约 46 万对象的 monorepo 上，一次无关历史的三方合并尝试成本过高，不适合临时性地跑，需要单独、无人值守的一次专门运行）。相反，`git merge-tree HEAD origin/master`（真实存在祖先关系）能干净解析——证明工具与仓库在历史确实共享时工作正常。

**替代测算——文件级重叠，作为"是否会冲突"的可行代理指标：**

1. `git diff --name-only origin/master..HEAD` → **947 个文件**，是 Saturn 相对 fork 自身基线的全部改动面（包、重新品牌、文档、配置）。
2. 其中 **630 个文件**位于 16 个 Saturn 自有包目录之外（即 Saturn 自身工作改动过的共享/框架文件）。
3. `git diff --name-only dsh-v0.1.2-alpha.4..dsh-v0.1.6-alpha.1` → 上游自 fork 基线以来触碰过 **8,570 个文件**。
4. (2) 与 (3) 的交集——**Saturn 自身改动与上游四个发布跨度都触碰过**的文件——为 **431 个文件**，即冲突候选集。（依构造方式，没有任何 Saturn 自有包目录出现在此交集中：Saturn 的包都是上游没有对应物的新路径，本身不带合并风险；全部风险都在双方都改动过的共享底层里。）

431 个文件的分布：`packages/` 148（跨 42 个不同的共享包）、`snapshots/`（session/web/sdk 快照基准）184、`apps/` 61、`docs/` 21、`scripts/` 10、根目录/其他 7。

按与**本次 fan-out 自身建造任务**直接相交的程度排序这 42 个共享包（即真正做一次 vendor-bump 会重新引发本次哪些工作的冲突）：

- **直接、高置信度冲突**（已抽样并 diff，非推断）：`packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`——上游 0.1.3-alpha.1 为内联 `read_image` 渲染新增了 `image`/`renderSlot`/`loadImage` props，恰好是 C2 单元为动词开头工具行标题编辑的同一文件；`packages/client/ui-sidebar`（`SidebarRoot.tsx`/`.module.css`）——C3 的活跃行光环工作；`packages/client/ui-conversation`（`ConversationRoot.tsx/.module.css`、`locales.ts`、`InputBar.tsx`）——C2 的正文测量与轨道画布工作；`packages/client/ui-settings-models`（`ProviderEditor.tsx`、`locales.ts`、4 个测试文件）——C6 的模型路由 Settings 卡片工作，与上游自身的模型目录及 pi-ai 改动冲突；`packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml`——每个报告了 bundle 行集成需求的单元（C4、C6、C7、C8a）都要写入这些文件，而上游也在重构它们；`packages/preset/agent-presets/presets/cordis/agent.cordis.yml`——C6 的 IN 范围文件，上游直接改动过；`packages/mcp/mcp-client`（`connection.ts`、`index.ts` + 2 个测试）——上游的 MCP SDK v2 升级（协议协商、工具分页）恰好落在任何 Saturn MCP 相关工作依赖的那个包里；`packages/subagent/subagent-codex/src/wire.ts`——与 C5 的 `child-agent.ts` cwd 工作及 C6 的 Codex provider 挂载相邻。
- **中等**：`packages/client/ui-chat`、`packages/client/ui-theme`（`design-platform.css`，与 C2 的 `base.css` 动效令牌工作是同级文件）、`packages/core/system-prompt`、`packages/sandbox/sandbox-policy`（与 C5 的 bash 感知 claims 守卫相邻）、`packages/experimental/agent-team-profile`/`agent-team-web-profile`（Team 模式重写地带——`spawn_teammate`——与 C5 在 `packages/saturn/agent-team` 上的 worktree 隔离工作直接相关，尽管路径本身并不字面重叠）。
- **低/机械性**：README/i18n 三件套、`packages/skill/README*`、`packages/experimental/README*`——纯品牌文字，非逻辑。
- **184 个快照基准**（`snapshots/session/*`、`snapshots/web/*`、`snapshots/sdk/*`，含大量 `subagent-*` 夹具）是最大的单一分类，也是文件计数摘要中最不显眼的一类：一次真正的 vendor-bump 需要重新生成或手工核对其中大部分——SPEC §5 已经把这一点延后（"面向 Saturn 客户端包的新 web e2e 基准场景……属于后续工作"）；本 Note 把同样的谨慎延伸到 SPEC 未单独点名的 *session/sdk* 快照族。

**自 `dsh-v0.1.2-alpha.4` 以来的上游功能**（GitHub Releases API，`deepseek-ai/deepseek-harness`，取英文发布说明正文；日期为 `published_at`）：

| 发布 | 日期 | 对 Saturn 的意义 |
|---|---|---|
| `0.1.2-alpha.5` | 2026-09-02 | 仅问题修复（升级路径的会话标题回归）。 |
| `0.1.2-rc.1` | 2026-09-03 | 71 项变更的发布。子代理模型选择（按调用指定 provider/model/推理力度/最大输出，以及 Claude Code/Codex 模型配置）——**与 C6 的模型路由 mandate 直接重叠**；父子代理间用 `send_message` 取代单向 `report`——与 C5 的 agent-team 工作重叠；默认启用公开 `WebFetch` 并带 SSRF 防护；`Session.events` 被 `seq`/`eventAt()`/`snapshotEvents()` 取代；Remote gateway 取代旧版 APIProxy；Code Mode 更名为 PTC 模式。 |
| `0.1.3-alpha.1` | 2026-09-04 | Web 支持任意文件类型上传；**breaking**：Session 持久化改由生命周期绑定的 `SessionHandle` 拥有，`agentLoop.create()` 变为异步，每 session 单进程锁。Session 格式升级到 v2。上游自述本发布存在未解决的性能回归。 |
| `0.1.3-alpha.2` | 2026-09-07 | pi-ai 升级到 0.85.1（新模型）；可继续对话子代理支持消息排队/编辑/删除/单条或全部 Steer/停止。 |
| `0.1.5-alpha.1` | 2026-09-08 | 动态修改系统提示词且不破坏 KV cache；实验性右侧 Sidebar（多标签/分栏/全屏）；可选子代理 provider 插件内置 Codex 0.153.4 / Claude Code 2.1.263 运行时——**与 C6 的 `dsh-subagent-claude-code`/`dsh-subagent-codex` 挂载行直接相关**。 |
| `0.1.5-alpha.2` | 2026-09-09 | 侧边栏文档预览（Markdown/代码/HTML/PDF/图片）；模型可显式向侧边栏交付文件。 |
| `0.1.5-rc.1` | 2026-09-10 | 新会话默认模型改为 `DeepSeek-V41-Flash`。 |
| `0.1.5-rc.2` | 2026-09-10 | 仅体验优化（反馈弹窗、交付文件卡片排版）。 |
| `0.1.6-alpha.1` | 2026-09-15 | Web 侧边栏终端；已归档会话列表；**MCP 资源发现 + URI 模板 + 官方 SDK v2**（协议协商、工具分页）；Headless 支持标准输入任务 + `--session-id` 续接 + `--json` 事件流；SSH 远程工作区的文件/命令/PTC 工具；**实验性 Browser Use**（Playwright MCP / Chrome DevTools MCP / Stagehand）与**实验性 Computer Use**（Cua Driver MCP / 原生驱动）——两者都抢占了 SPEC §3 C7（`tool-media`）及任何未来 Saturn 浏览器自动化工作原本可能声称的新颖阵地；实验性 Auto-review 模式。**Breaking/杂项变更**：DeepSeek 适配器默认改用 Messages 协议（旧版 completions 根地址需移除或改指向 `/anthropic`）；Ralph 默认关闭；移除内置 E2B 后端；PTC 包/服务系列统一改名为 `ptc-runtime`（无旧名兼容）；workflow 执行器改名为 `workflow-ptc`（不支持 Python PTC）；`agent/session-start` 被异步的 `agent/created` 取代；**Team 模式：`spawn_teammate` 成为唯一路径，`subagent`/`subagent_fork` 被禁用，默认队友上限由 8 增至 16**——这正是本次 session 中 C5 正在改动的同一表面（`packages/saturn/agent-team`、`packages/saturn/tool-agent-team`），未来任何 vendor-bump 尝试前都应先读这一条，而非事后才发现。 |

## 备选方案

- **不计时长跑完 `git merge-tree --allow-unrelated-histories`。** 本次拒绝：在这个规模且无共享历史的 monorepo 上它未能在 8 分钟内完成，mandate 对单条命令有 8 分钟上限，一个跑到一半的后台任务证明不了任何可执行结论。若 izzy 希望在决策前拿到精确冲突数，正确做法是单独安排一次专门的、无人值守的长跑（自己的预算，过夜跑）。
- **把"相对 origin/master 有 947 个文件分叉"本身当作冲突数。** 拒绝：该计数包含 Saturn 自己的新包及无上游对应物的纯品牌文字，严重高估风险；431 个文件的交集才隔离出真实的共享底层。
- **跳过发布说明阅读，只从提交主题推断功能。** 拒绝：DeepSeek 的发布说明是这里唯一准确的"功能对应日期"映射（提交图在此处是无关历史噪声），且有几项（Team 模式重写、MCP SDK v2、Browser/Computer Use）正是 SPEC 意图书要求 C11 回答的"我们是否已经有这个"问题。
- **建议立即执行 vendor-bump。** 拒绝：底层历史无关联，上游在 Saturn 16 个包所依据的同一时间跨度内提交了百万行级的 diff，且带有多处明确的破坏性变更（Session 持久化、PTC 重命名、Team 模式），其中一个上游发布（`0.1.3-alpha.1`）本身就自述存在未解决的性能回归。现在尝试 vendor-bump 将是一次完整的手工核对，而非一次合并。

## 验收标准

- `R` 中 `git remote -v` 列出 `upstream-dsh` → `https://github.com/deepseek-ai/deepseek-harness.git`（本次 session 添加并抓取；留存无害，不拉取 LFS 或凭据）。
- `git merge-tree --write-tree HEAD origin/master`（对照组，存在共同祖先）干净解析——记录于上文作为工具健全性检查。
- 上文 431 个文件、42 个包的交集列表及九个发布的功能表，均可通过本 Note 中列出的两条 `git diff --name-only` 命令与一次 GitHub Releases API 调用复现。
- `R` 中未发生任何 merge、rebase 或 reset；`HEAD` 仍为 `5dd99fb` 不变。

## 风险

- **431 文件的代理指标低估真实风险。** 文件级重叠只说明双方都改过同一文件，不代表其 hunk 会冲突；431 个文件中一部分（如纯 README）会平凡合并，而 `packages/mcp/mcp-client/src/connection.ts` 里哪怕一行改动，也可能破坏所有依赖旧版 MCP client 契约的 Saturn 功能。请把本 Note 的计数视为**工作量下限**，而非精确冲突清单。
- **十四天内九个发布，目标移动很快。** 任何依据本 Note 制定的 vendor-bump 计划都会很快过时；实际尝试 bump 前应重新跑那两条 `git diff --name-only` 命令和 Releases API 调用。
- **未跑完的 `--allow-unrelated-histories` merge-tree 任务。** 若 izzy 需要精确的上游三方合并冲突数（而非文件重叠代理指标），该命令需要在本次 session 单条命令上限之外单独安排数小时级预算——此处标注而非在不确定结果下继续跑。
- **决策权按 SPEC §3 C11 保留给 izzy**：本 Note 的作用是呈现冲突列表与功能表供其决策，而非单方面在 vendor-bump 与刻意分叉之间做选择。
