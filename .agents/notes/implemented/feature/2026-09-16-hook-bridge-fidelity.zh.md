# Agent Note：Claude Code 的 hooks.json 现在匹配 DSH 工具名称，而不仅是 Claude Code 自己的名称

Status: implemented

[English](2026-09-16-hook-bridge-fidelity.md) | 中文

## 问题

`dsh-hooks-claude-code` 在形态上忠实地运行未经修改的 Claude Code `hooks.json`——matcher 解析、命令替换、决策映射——但默默地针对了错误的词汇表。Claude Code 自身的钩子（izzy 的 `gate-guard.js`，其 matcher 接线为 `Bash|PowerShell`，以及按工具名匹配的 MCP 配套脚本）都是针对 Claude Code 的工具名称编写的。本 harness 自身的工具清单（记录于 `INV-harness-tools.json`）为相同能力使用了不同命名：`bash`、`pwsh`、`edit`、`write`、`str_replace_editor`、`read`、`read_image`、`glob`、`grep`、`web_fetch`、`web_search`。`PreToolUse` matcher 组直接针对 `exec.name` 求值其模式（`matchesMatcher(group.matcher, exec.name, 'claude-code')`），因此 `Bash|PowerShell` 永远选不中 `bash` 或 `pwsh` 调用，`Edit|Write|MultiEdit` 也永远选不中 `edit`、`str_replace_editor` 或 `write`。一个正是为此目的接线的钩子——Gate 级命令检测——从未触发过。合成的 `PreToolUse`／`PostToolUse` payload 又加重了这个问题：`tool_name` 原样等于 `exec.name`，因此即便桥接开发者用 DSH 原生模式匹配了钩子，钩子读到的也是 `tool_name: "bash"`，而参考工具始终报告 `"Bash"`。

另外，配置解析只遍历自身的 `CLAUDE_EVENTS` 白名单（`for (const event of CLAUDE_EVENTS)`），因此白名单之外的配置 key——`ConfigChange`、`PreCompact`、`SessionEnd`，或 Claude Code 其他任何未实现事件——从未被真正查看过。这本身是正确的隔离（不支持的事件不应注册或使任何内容失效），但同时也是无声的：维护者接线一个 `ConfigChange` 钩子、并按文档预期"不支持的事件会被忽略"，却在加载时得不到任何被跳过的信号。

## 决策

`config.ts` 新增 `toolAliases: Record<string, string[]>` 表（`DEFAULT_TOOL_ALIASES`），把每个 Claude Code 工具名称映射到其所代指的 DSH 工具名称；当多个 Claude 名称覆盖同一个 DSH 工具时（`str_replace_editor` 同时出现在 `Edit`、`MultiEdit`、`NotebookEdit` 之下——按表顺序 `Edit` 优先），按表内 key 顺序确定优先级。`reverseToolAliases` 在插件加载时一次性构建 DSH 名称 → Claude 名称的反向索引；`toolMatchCandidates(dshName, reverse)` 返回原始 DSH 名称加上所有代指它的 Claude 名称（`['bash', 'Bash']`），桥接的 `PreToolUse`／`PostToolUse` 监听器现在针对这些候选值中的任意一个匹配某个组（`matchCandidates.some(candidate => matchesMatcher(...))`），而不再只用原始名称——因此不论 matcher 写作 `Bash|PowerShell` 还是 `bash|pwsh` 都能触发。`claudeToolName(dshName, reverse)` 为合成 payload 的 `tool_name` 挑选按表顺序排在最前的 Claude 名称，对没有任何名称代指的工具（`terminal_open`、某个 `mcp__*__*` 工具）则回退为原始 DSH 名称。`tool_input` 内部无需任何字段改名：DSH 的 `bash`／`pwsh` 工具本身就把参数命名为 `command`，`write`／`edit` 本身就使用 `file_path`／`content`／`old_string`／`new_string`——与 Claude Code 自身工具 schema 相同的名称——因为这些 DSH 包本来就是照着参考工具契约建模的。`toolAliases` 是一个插件配置字段；已配置条目会替换同一 Claude 名称的默认值（因此用户覆盖 `Bash` 不会丢失 `PowerShell`、`Edit` 等），`validateToolAliases` 会在加载时拒绝格式错误的值（非对象，或某个 key 的值不是非空字符串数组），并指名出错的 key。

`parseClaudeCodeConfig` 现在遍历配置自身的 key（`Object.keys(hooksMap)`），而不是受支持事件白名单；`CLAUDE_EVENTS` 之外的 key 会被推入 `skipped`，形如 `{ event, type: 'event', reason: 'unsupported event' }`，而不是在循环触及它之前就被默默丢弃。桥接既有的跳过警告循环（此前已用于非 command 类型的 hook）现在依据 `reason` 分支，记录一条指名该事件的独立消息。这是"带信号的隔离"，而非行为变化：该事件仍然不能注册或使任何内容失效，不支持事件内部组里的无效 matcher 仍然从不会被求值（本变更未回归的既有 `config.spec.ts` 用例——已直接验证）。

## 考虑过的替代方案

**把已配置的 `toolAliases` 值与默认值按 DSH 名称而非 Claude 名称做深度合并。** 已拒绝：配置本身的形状是按 Claude 名称建 key 的（贴合维护者在 `hooks.json` 旁阅读与编写它的方式），而按 Claude 名称浅层替换与本桥接其他所有对象形态配置字段的语义一致（`Config` 本身没有任何深合并字段）。某个 DSH 名称获得或失去别名，通过覆盖拥有它的那个 Claude 名称来表达。

**通过 schemastery 的 `Config` schema（`z.dict(z.array(z.string()))`）校验 `toolAliases`，而非手写 `validateToolAliases`。** 目前拒绝：覆盖率测试套件会行使一条"跳过 schema"的直接 `apply()` 调用路径（postmortem 0001 的命名空间插件形态守卫依赖直接调用 `apply`），因此无论插件是通过 `ctx.plugin` 挂载还是直接调用，拒绝路径都必须行为一致——而 schemastery 自身的 schema 应用只在 `ctx.plugin` 路径上运行。`apply()` 出于同样原因早已手工校验 `stderrSummaryMaxChars`；`toolAliases` 沿用这一既有形态，而非引入第二条失败模式不同的校验路径。

**把不支持事件的警告进一步推进，例如把所有被跳过的事件汇总成一行。** 已拒绝：桥接已经对每个被跳过的 hook 逐条警告（每个非 command hook 一行），维护者在日志中查找某个具体缺失事件时，逐事件独立命名的一行比需要自行解析的单条汇总更有帮助。

## 影响

未经修改的 Claude Code `hooks.json`——包括 izzy 的 `gate-guard.js`（matcher `Bash|PowerShell`）与 `gate-guard-mcp.js`（在 MCP 面按 `tool_name` 匹配）——现在无需改写 matcher 或钩子脚本，就能针对本 harness 的工具调用触发。读取 `tool_input.command`（`gate-guard.js` 恰好读取的字段）的钩子脚本继续原样工作，因为该字段本就名称兼容；只有 `tool_name` 需要别名层。`SessionEnd` 与 `PreCompact` 仍未实现——本 cell 的 mandate 把它们排除在范围之外——但接线其中任意一个的配置现在会在加载时得到警告而非沉默，因此这一缺口是可见的，而不是一个陷阱。`toolAliases` 是增量式且向后兼容的：不设置该值的部署会得到上表这套精确默认值；已经使用 DSH 原生 matcher（`bash|pwsh`）的部署继续工作，因为原始 DSH 名称始终是与其别名并列的匹配候选之一。

## 验证

两个新 spec 文件直接覆盖该层：`tool-aliases.spec.ts` 针对精确的默认表对 `reverseToolAliases`／`claudeToolName`／`toolMatchCandidates`／`validateToolAliases` 以及 `parseClaudeCodeConfig` 的不支持事件跳过做单元测试（全部为纯函数、不涉及子进程——在任意平台都 100% 通过）；`tool-alias-bridge.spec.ts` 驱动真实 agent 循环 + 真实 bash 执行器 + 真实钩子 shell 脚本（既有套件"优先使用真实实现"的规则），证明 `Bash|PowerShell` matcher 会拒绝 `bash` 与 `pwsh` 这两个 DSH 工具调用、但不拒绝 `read`；`Edit|Write|MultiEdit` matcher 会拒绝 `edit`／`write`／`str_replace_editor`、但不拒绝 `grep`；捕获到的 `bash` 调用 `PreToolUse` payload 携带 `tool_name: "Bash"` 且 `tool_input.command` 等于命令文本；捕获到的 `PostToolUse` payload 携带 `tool_name: "Edit"` 且 `tool_response` 为工具的结果文本；已配置的 `toolAliases` 覆盖不影响其余默认值继续生效；格式错误的 `toolAliases` 值在加载时被拒绝（`ctx.plugin(...).rejects.toThrow`）；`ConfigChange`／`PreCompact` 都会产生一条指名警告。`tsc -p packages/hooks/hooks-claude-code` 干净通过。本次会话中运行并通过了这两个新文件以及既有的 `config.spec.ts`（纯解析、不涉及子进程）；既有的子进程驱动套件（`bridge.spec.ts`／`coverage-*.spec.ts`）在本次会话中无法取得可信信号——`vitest.config.ts` 正是出于这个原因在 win32 上排除了 `packages/hooks/*`，本次会话也证实了原因所在：本机上 `bash -c "<command>"` 会在命令行参数本身中打乱 Windows 反斜杠路径（与本次改动无关——针对改动前的源码同样可复现），这正是本 cell 新增的桥接 spec 用正斜杠构建其钩子 `command` 字符串的原因。TypeScript 与纯逻辑套件是本会话中已验证的证据；子进程驱动套件以 Linux CI 通道为准。
