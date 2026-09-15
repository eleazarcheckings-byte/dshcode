# Agent Note: 与 deepseek-ai/deepseek-harness 的上游对齐评估

Status: proposed

[English](2026-09-15-upstream-reconciliation.md) | 中文

## 问题

`dshcode`（`origin` = `whitelonng/dshcode`）是 DeepSeek `deepseek-harness` 的一个 fork。其上叠加了 20 个 `@saturnai/*` 包及一次仓库级重新品牌。本次 session 的其他单元正在并发提交到同一仓库，`HEAD` 因此逐轮移动——本 Note 中每一个计数都因此锚定在一个明确写出的提交上，而非浮动的 `HEAD`。该 fork 自 `dsh-v0.1.2-alpha.4`（`4e84901e6471b79ec0338099867ebb4606d12bb5`，2026-09-01）后再未合入任何上游发布。此后上游已发布九个版本，最新为 `dsh-v0.1.6-alpha.1`（`0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`，2026-09-15）——其中包括 MCP SDK v2 升级、子代理/Team 模式重写（`spawn_teammate` 取代 `subagent`/`subagent_fork`，队友上限由 8 增至 16）、DeepSeek 适配器协议切换（Messages 取代旧版 completions 默认值）以及 `PTC`/`workflow` 系列包重命名。在分叉进一步累积之前，决定是否以及如何吸收这些发布，需要一个真实的冲突评估，而非猜测。

## 方案

**第三轮修正：tag 一侧的冲突数其实可以拿到，现在是主测算。** `origin/master` 与 `upstream-dsh/master`（`https://github.com/deepseek-ai/deepseek-harness.git`，远端 `upstream-dsh`，已抓取——17 个 tag，`master` 位于 `0d1f500`）没有共同祖先：`git merge-base origin/master upstream-dsh/master` 退出码为 1，`git merge-base --is-ancestor dsh-v0.1.2-alpha.4 HEAD` 同样退出码为 1——尽管 fork 自身的 `REBRAND.md`/侦察记录都认为它衍生自该版本；`whitelonng/dshcode` 是在某个时间点对上游做的内容快照，而非保留提交历史的真实 fork。因此 `git merge-tree --write-tree HEAD <上游 tag>` 直接失败（`fatal: refusing to merge unrelated histories`），`--allow-unrelated-histories` 在本次 session 8 分钟命令上限内、这个约 46 万对象的 monorepo 上也无法返回。但**旧版三参数形式 `git merge-tree <base> <ours> <theirs>` 接受一个显式 base，不需要共享历史**——它不要求 `origin/master` 与 `upstream-dsh/master` 有直接关联，只需要指定一个 base 提交。这条命令才是本 Note 此前缺失的真实冲突测算；下方的文件重叠代理指标降级为下限。

### 主测算——真实三方 merge-tree 冲突

`git merge-tree dsh-v0.1.2-alpha.4 <SHA> dsh-v0.1.6-alpha.1`，以本单元自己的提交 `e92f2e7c725a62078de5c73138bf5c02be6ccb98`（2026-09-15T16:21:22-04:00）作为 `<SHA>` 运行——退出码 0，**45 秒**，输出 1,368,118 行：

| merge-tree 分类 | 数量 |
|---|---|
| `changed in both`（双方都改过的文件） | **734** |
| `merged`（干净自动合并，无冲突标记） | 2,854 |
| `added in both` | 20 |
| `added in remote`（仅上游新增文件） | 4,096 |
| `removed in one`（41 个 removed-in-local + 1,731 个 removed-in-remote） | **1,772** |
| **带有真实 `<<<<<<<` 冲突标记的文件数**（`grep -c '<<<<<<<'` = 902 次标记出现，去重到不同文件） | **338** |

按顶层路径分布的 338 个冲突标记文件（git 版本 2.53.0.windows.2）：

`packages/` 165（**82** 个不同的包目录，而非 42 个）、`snapshots/` 69、`apps/` 54、`docs/` 18、根目录/其他 12、`scripts/` 11、`.agents/notes/` 9——合计 338。

734 个 `changed in both` 文件（双方都改动过的全部文件，无论是否带冲突标记）——下文用作外部上界：

`packages/` 453（**204** 个不同的包目录）、`snapshots/` 98、`apps/` 78、`docs/` 51、根目录/其他 22、`scripts/` 19、`.agents/notes/` 13——合计 734。

### 下限代理指标——文件级同名重叠（保留，降级）

上一轮的文件重叠测算作为更便宜的下限交叉核对保留下来，不再是头条数字：

1. `git diff --name-only origin/master..e92f2e7c725a62078de5c73138bf5c02be6ccb98`（`origin/master` = `058e9f949ca15bcd973164d4d4e9218923f4eb26`）→ **1,160 个文件**——本 SHA 处 Saturn 的全部改动面（本数字每次有单元向这个共享仓库提交都会变；本 Note 首次起草时为 947，Mars r2 测量时为 974）。
2. 其中 **827 个文件**位于（已修正——见"发现"）**20** 个 `@saturnai/*` 包目录之外，通过 `git ls-tree -r --name-only e92f2e7c725a62078de5c73138bf5c02be6ccb98 | grep package.json$` 并逐个 blob grep `"name": "@saturnai/` 得出，而非按目录名猜测。
3. `git diff --name-only dsh-v0.1.2-alpha.4..dsh-v0.1.6-alpha.1` → **8,570 个文件**（tag 到 tag，与我们的 HEAD 无关）。
4. (1) 与 (3) 的交集 → **457 个文件**（此前 HEAD 处为 436），跨 **46** 个不同的共享包（此前为 42）：`packages/` 168、`snapshots/` 184、`apps/` 61、`docs/` 21、`scripts/` 10、根目录/其他 8、`.agents/notes/` 5（与此前相同的 5 个路径：agent-teams Agent Note 三件套加两个 workspace-alias/agent-teams-web `.i18n.yaml` 文件）。

这一代理指标现已证实是**下限，不是可用估算**：其冲突标记集（338）与之相比，原始计数接近但两个集合对"哪些文件真正带风险"的判断并不一致——代理指标只按路径同名判断，包含许多实际上干净合并的文件，同时漏掉了一些三方合并会标记冲突的文件；其不同包计数（46）也只有主测算（82）的一半略多。

**自 `dsh-v0.1.2-alpha.4` 以来的上游功能**（GitHub Releases API，`deepseek-ai/deepseek-harness`，取英文发布说明正文；日期为 `published_at`）——沿用上一轮，本轮未重新核实，因为没有任何一条修复点名它：

| 发布 | 日期 | 对 Saturn 的意义 |
|---|---|---|
| `0.1.2-alpha.5` | 2026-09-02 | 仅问题修复（升级路径的会话标题回归）。 |
| `0.1.2-rc.1` | 2026-09-03 | 71 项变更的发布。子代理模型选择（按调用指定 provider/model/推理力度/最大输出，以及 Claude Code/Codex 模型配置）——与 C6 的模型路由 mandate 直接重叠；父子代理间用 `send_message` 取代单向 `report`——与 C5 的 agent-team 工作重叠；默认启用公开 `WebFetch` 并带 SSRF 防护；`Session.events` 被 `seq`/`eventAt()`/`snapshotEvents()` 取代；Remote gateway 取代旧版 APIProxy；Code Mode 更名为 PTC 模式。 |
| `0.1.3-alpha.1` | 2026-09-04 | Web 支持任意文件类型上传；**breaking**：Session 持久化改由生命周期绑定的 `SessionHandle` 拥有，`agentLoop.create()` 变为异步，每 session 单进程锁。Session 格式升级到 v2。上游自述本发布存在未解决的性能回归。 |
| `0.1.3-alpha.2` | 2026-09-07 | pi-ai 升级到 0.85.1（新模型）；可继续对话子代理支持消息排队/编辑/删除/单条或全部 Steer/停止。 |
| `0.1.5-alpha.1` | 2026-09-08 | 动态修改系统提示词且不破坏 KV cache；实验性右侧 Sidebar（多标签/分栏/全屏）；可选子代理 provider 插件内置 Codex 0.153.4 / Claude Code 2.1.263 运行时——与 C6 的 `dsh-subagent-claude-code`/`dsh-subagent-codex` 挂载行直接相关。 |
| `0.1.5-alpha.2` | 2026-09-09 | 侧边栏文档预览（Markdown/代码/HTML/PDF/图片）；模型可显式向侧边栏交付文件。 |
| `0.1.5-rc.1` | 2026-09-10 | 新会话默认模型改为 `DeepSeek-V41-Flash`。 |
| `0.1.5-rc.2` | 2026-09-10 | 仅体验优化（反馈弹窗、交付文件卡片排版）。 |
| `0.1.6-alpha.1` | 2026-09-15 | Web 侧边栏终端；已归档会话列表；MCP 资源发现 + URI 模板 + 官方 SDK v2（协议协商、工具分页）；Headless 支持标准输入任务 + `--session-id` 续接 + `--json` 事件流；SSH 远程工作区的文件/命令/PTC 工具；实验性 Browser Use（Playwright MCP / Chrome DevTools MCP / Stagehand）与实验性 Computer Use（Cua Driver MCP / 原生驱动）——两者都抢占了 SPEC §3 C7（`tool-media`）及任何未来 Saturn 浏览器自动化工作原本可能声称的新颖阵地；实验性 Auto-review 模式。**Breaking/杂项变更**：DeepSeek 适配器默认改用 Messages 协议（旧版 completions 根地址需移除或改指向 `/anthropic`）；Ralph 默认关闭；移除内置 E2B 后端；PTC 包/服务系列统一改名为 `ptc-runtime`（无旧名兼容）；workflow 执行器改名为 `workflow-ptc`（不支持 Python PTC）；`agent/session-start` 被异步的 `agent/created` 取代；**Team 模式：`spawn_teammate` 成为唯一路径，`subagent`/`subagent_fork` 被禁用，默认队友上限由 8 增至 16**——这正是本次 session 中 C5 正在改动的同一表面（`packages/saturn/agent-team`、`packages/saturn/tool-agent-team`），未来任何 vendor-bump 尝试前都应先读这一条，而非事后才发现。 |

## 建议

**不变：刻意分叉，选择性 cherry-pick 上游具体提交——而非 vendor-bump。** 两边历史没有共同祖先；上文的真实三方 `merge-tree` 直接证明了这一点，而非靠推断——338 个文件带有真实的文本冲突标记，不只是路径重叠。主测算的结果没有指向相反方向；如果说有什么变化，真实冲突面更大（82 个包，而非 42 个）反而让一次性 vendor-bump 尝试比上一轮估算显得**更不可取**，而非更可取。逐个挑选真正重要的上游提交（MCP SDK v2、子代理模型选择），逐个评估、逐个落地，仍然比一次性吸收全部九个发布风险小得多，也仍然让每一次挑选都能各自走一遍 writer≠reviewer。

**基于冲突标记集重新推算的工作量估算（按包分诊，沿用此前约 0.5–1 工程师日/包的经验法则），并以 `changed in both` 集作为外部上界：**

| 分类 | 主测算（338 个冲突标记文件，82 个包） | 外部上界（734 个 changed-in-both 文件，204 个包） |
|---|---|---|
| `packages/`（风险核心，每包约 0.5–1 天） | 82 包 × 0.5–1 天 → **41–82 天** | 204 包 × 0.5–1 天 → **102–204 天** |
| `snapshots/`（批量重新生成，非逐文件） | 69 个文件 → **1–3 天** | 98 个文件 → **2–4 天** |
| `apps/` + `docs/` + `scripts/` + 根目录/其他 + `.agents/notes/`（一次性核对） | 104 个文件 → **2–4 天** | 183 个文件 → **3–6 天** |
| **总计** | **约 44–89 个工程师日** | **约 107–214 个工程师日** |

此估算取代上一轮基于 436/42 包代理指标得出的 30–40 个工程师日——该数字现已证明只是下限，而非可用工作量；真实区间（主测算）**高出约 1.2–2.2 倍**，外部上界**高出约 2.7–5.3 倍**。建议本身不变：仍是刻意分叉、选择性 cherry-pick，而非 vendor-bump；真实工作量更大反而更加强化了这一建议——既然一次性吸收全部内容现已证明比此前所说的更庞大而非更小，就更应该只挑选价值最高的提交（MCP SDK v2、子代理模型选择）。

**会让此建议翻转为主动尝试 vendor-bump 的触发条件：** 与上一轮相同——MCP SDK v2 升级或 Team 模式的 `spawn_teammate` 重写中的任意一个变得对 Saturn 是承重的（某个 Saturn 包开始依赖只有新版上游代码才提供的协议或能力面）。到那时，不核对的成本将超过核对的成本，本 Note 的测算也应基于彼时的上游状态重新跑一遍，而非现在这份。

**决策权仍归 izzy**——这是一条他可以否决的建议，而非已经付诸行动的计划。

## 备选方案

- **不计时长跑完 `git merge-tree --allow-unrelated-histories`。** 本次拒绝：在这个规模且 `origin/master` 与 `upstream-dsh/master` 之间无共享历史的 monorepo 上它未能在 8 分钟内完成，mandate 对单条命令有 8 分钟上限，一个跑到一半的后台任务证明不了任何可执行结论。上文的旧版三参数形式已用 45 秒解决了同一问题，靠指定显式 base 而非依赖共享历史——因此这一备选方案已不再是拿到精确冲突数的必要途径；如果 izzy 希望拿到 `origin/master` 与 `upstream-dsh/master` 之间真正合并（而非本 Note 使用的锚定 tag 方式）的图，它才会提供额外价值。
- **把"相对 origin/master 有 1,160 个文件分叉"本身当作冲突数。** 拒绝：该计数包含 Saturn 自己的新包及无上游对应物的纯品牌文字，严重高估风险。
- **把文件同名代理指标（457/46）当作头条数字。** 本轮拒绝：它是真实的下限，计算成本低，值得作为交叉核对保留，但主测算 `merge-tree` 现已能以可接受的成本（45 秒）取得，才是真正应据以制定核对计划的冲突信号。
- **跳过发布说明阅读，只从提交主题推断功能。** 拒绝：DeepSeek 的发布说明是这里唯一准确的"功能对应日期"映射（提交图在此处是无关历史噪声），且有几项（Team 模式重写、MCP SDK v2、Browser/Computer Use）正是 SPEC 意图书要求 C11 回答的"我们是否已经有这个"问题。
- **建议立即执行 vendor-bump。** 比上一轮更坚决地拒绝：底层历史无关联，上游在 Saturn 20 个包所依据的同一时间跨度内提交了百万行级的 diff，带有多处明确的破坏性变更，其中一个上游发布（`0.1.3-alpha.1`）本身就自述存在未解决的性能回归，而真实冲突标记计数（338 个文件、82 个包）现已证明比代理指标暗示的更大。

## 验收标准

- `R` 中 `git remote -v` 列出 `upstream-dsh` → `https://github.com/deepseek-ai/deepseek-harness.git`（本次 session 添加并抓取；留存无害，不拉取 LFS 或凭据）。
- `git merge-tree --write-tree HEAD origin/master`（对照组，存在共同祖先）干净解析——记录于上文作为工具健全性检查。
- **本 Note 中的每一个计数都可在所写明的 SHA 处复现**（HEAD 锚定的数字用 `e92f2e7c725a62078de5c73138bf5c02be6ccb98`，tag 锚定的数字用文中所写的两个 tag，`origin/master` 用 `058e9f949ca15bcd973164d4d4e9218923f4eb26`），复现方式为：`git merge-tree dsh-v0.1.2-alpha.4 <SHA> dsh-v0.1.6-alpha.1`（主冲突测算）、两条 `git diff --name-only` 命令（下限代理指标）、`git diff --stat dsh-v0.1.2-alpha.4 origin/master`（基线漂移）以及一次 GitHub Releases API 调用。由于本仓库有其他单元并发提交，对着**不同**的 SHA 重跑不会得到相同数字——这是预期行为，不是方法上的缺陷。
- `R` 中未发生任何 merge、rebase 或 reset；本单元添加的唯一提交就是这份 Note（单一父提交，非合并提交）。

## 风险

- **即使 338 个冲突标记文件也可能低估语义风险。** 文本冲突标记说明双方改动了重叠的行；一个干净合并的文件（属于 2,854 个 `merged` 文件之一，或 396 个无标记的 `changed in both` 文件之一）仍可能在事后出错——例如一方改名了另一方调用的函数,而双方改动的行并不重叠。请把 338/82 视为**比 457/46 代理指标更好的下限，仍非上限**。
- **未披露的基线误差,现已测算。** `git diff --stat dsh-v0.1.2-alpha.4 origin/master` → **1,027 个文件变更，+51,922/-2,473 行**。本 Note 把 `dsh-v0.1.2-alpha.4..dsh-v0.1.6-alpha.1` 当作"fork 基线以来上游改动了什么"，但 fork 自身的 `origin/master` 早已与该 tag 相差逾千个文件——这本身就是一份独立的核对工作（whitelonng 的重新品牌/快照流程与它声称衍生自的 tag 之间的漂移），**未计入上文任何一个工作量分类**。任何基于本 Note 制定的 vendor-bump 或 cherry-pick 计划都应为核对这份既有漂移单独留出预算,而非假定 `dsh-v0.1.2-alpha.4` 可以精确替代 `origin/master`。
- **十四天内九个发布，目标移动很快。** 任何依据本 Note 制定的计划都会很快过时；实际尝试 bump 或 cherry-pick 前应在当时的 SHA 上重新跑主 `merge-tree` 命令、两条 `git diff --name-only` 命令和 Releases API 调用。
- **本次 session 自身的 HEAD 会随并发提交移动。** 本 Note 中每一个 HEAD 锚定的数字都写明了测算所用的确切 SHA；对着更晚的 HEAD 重跑,代理指标测算部分理应显示不同（很可能更大）的总数,这是结构性结果，不是计数错误的证据。
- **决策权按 SPEC §3 C11 保留给 izzy**：上文"建议"一节给出了一条带有界工作量估算与重议触发条件的路径，但尚未付诸任何行动——接受、调整或否决都由他决定。
