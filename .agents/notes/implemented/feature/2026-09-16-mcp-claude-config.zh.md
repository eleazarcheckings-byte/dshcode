# Agent Note: Claude Code 的 mcpServers 映射以 $0 成本变成 harness 工具

Status: implemented

[English](2026-09-16-mcp-claude-config.md) | 中文

## 问题

izzy 已经为 Claude Code 运行的每一台 MCP 服务器——一个本地记忆库、一个带密钥库的浏览器驱动、一个 shop-ops 后端、一个聊天中继、一个媒体生成器、一个设计大脑——都只存在于 `.claude.json` 的 `mcpServers` 映射里。harness 自身的 `dsh-mcp-client` 每次只为一条手写的 `cordis.yml` 行挂载一台服务器,因此要在 harness 内部接入同样这十一台服务器,就意味着要重新敲出十一行配置,并在 Claude Code 一侧的命令、URL 或请求头发生变化时手动同步。已经存在的那份配置从未被读取过。

## 决策

`@deepseek-ai/dsh-mcp-config-claude` 在插件激活时一次性读取 Claude Code 形态配置文件的 `mcpServers` 映射,并通过 `ctx.plugin(mcpClient, ...)` 为每一行挂载一个 `@deepseek-ai/dsh-mcp-client` 子实例——这正是 `packages/saturn/design-brain` 已经用于自身单个托管连接的组合方式,只是把它推广到任意映射上。映射键成为已挂载子实例的 `serverName`,因此一行名为 `awake` 会把工具注册为 `mcp__awake__<tool>`,与 Claude Code 自身展示的完全一致。

本包是既有能力之上的一个纯决策层,而不是一项新能力:它自己从不讲 MCP 协议。`src/config.ts` 把全部契约放进两个纯函数——`readServerMap`(唯一的一次文件读取)与 `planMounts`/`planOneRow`(按 `include`/`exclude` 过滤、防御性形态校验,因为该文件是不可信的部署方 JSON、以及转译为 `dsh-mcp-client` 的 `Config`)——因此规划逻辑无需 Cordis 上下文、无需真实服务器即可做单元测试。`src/index.ts` 负责挂载计划:`stdio` 与 `http` 行直接转译;`sse` 行总是以具名原因被跳过,因为 `dsh-mcp-client` 只实现了 `stdio` 与 `streamable-http`。`env` 或请求头字符串值中的 `${VAR_NAME}` 引用会在挂载时从进程环境展开——未设置的变量展开为空字符串,绝不展开为字面占位符——展开后的值绝不会被本包写入任何日志行。

挂载被有意地与连接解耦。除非插件自身的 `failOnStartupError` 配置另有说明,否则每个子实例都以 `failOnStartupError: false` 挂载,因此一个不可达的 `stdio` 命令或一个失效的 `http` 端点会由 `dsh-mcp-client` 自身报告为不可用——被记录、按其自身的退避策略重试——绝不会中止挂载计划的其余部分。`getStatus(ctx)` 为调用方的注册作用域发布 `{ configPath, mounted, skipped, failed }`,让消费方无需重新推导即可看到该计划。

## 考虑过的替代方案

**先给 `dsh-mcp-client` 加上 OAuth 与 `sse` 传输,让每一行 Claude Code 配置都能挂载。** 已拒绝:本包针对的真实配置中,没有任何一行需要这两者(两条 `sse` 行是 Cloudflare 的远程 MCP 服务器,会以具名原因被跳过;`github` 与 `sentry` 是普通的 `http`)。在没有当前消费方的情况下构建未经验证的能力,正是本仓库自身包约定所警惕的“为公开选择要求证据”式坏味道。

**让本包自身成为一个拥有实时逐服务器状态的 `Service`(类似 `awake` 那种带 `connect()`/`disconnect()` 的托管连接)。** 已拒绝:这里的每一台服务器都意在配置后始终在线,而不像 `design-brain` 的单个 SaturnAI 连接那样由设置界面按会话切换。在插件激活时一次性挂载的函数插件,更贴合实际用法,也让本包保持在任务书划定的两文件形态(`config.ts` + `index.ts`)内。

**跳过 `include`/`exclude` 空数组这一细节,只检查 `!== undefined`。** 这是最初的实现,并且是带着 bug 上线的:Schemastery 会把省略的 `z.array(...)` 配置字段解析为 `[]` 而不是 `undefined`,因此在组合测试发现之前,每一行都被静默地当作已排除处理(`mcp__awake__add` 从未注册过)。修复方式是把“存在但为空”的 `include` 当作“未配置”,符合从未碰过该字段的操作者的预期——并记录在 README 的设计哲学一节中,以免下一位读者再次引入这个问题。

## 后果

想让 izzy 自己的 MCP 服务器可从 harness 内部访问的部署,只需添加一条指向其 `.claude.json` 路径的 `cordis.yml` 行,而不是十一条会与真源脱节的手工挂载 `dsh-mcp-client` 行。每台已挂载服务器都仅凭“可达”这一点就获得了 Gate 相关的能力——密钥库、发送、支出——本包对此不做任何策略决策;README 的 Gate 姿态一节明确说明,它必须只与挂载在它之前的 Gate 级策略插件组合使用,且这一顺序由部署的集成者强制执行,而不是由本包强制执行。按本任务书范围栏,以下阻塞项均已上报给集成者处理:`full-access-gated` 权限预设行、`mcp-config-claude` 打包行(默认关闭,为 izzy 自己的配置文件打开)、以及 `tsconfig.base.json`/`tsconfig.host.json` 的注册。

## 验证

`node_modules/.bin/vitest run packages/mcp/mcp-config-claude` 全绿(35 个测试):`planOneRow`/`planMounts` 的单元覆盖(stdio/http/sse 转译、`${VAR}` 展开含未设置变量、形态错误的行、include/exclude/名称模式过滤、跳过原因中不含任何密钥值)与 `readServerMap`(真实临时文件、缺失 `mcpServers`、非法 JSON、非对象的 `mcpServers`、缺失文件);一套真实组合测试启动一个带有真实工具注册表的 Cordis `Context`,只读复用 `dsh-mcp-client` 自身的 stdio 固件服务器,证明一个工具确实以 `mcp__awake__add` 的名字注册并通过真实 stdio 执行,一个不可达的命令仍能让旁边一条真实行成功挂载,一条 `sse` 行以包含 “sse” 的原因被跳过,`exclude` 使被排除的一行保持未挂载,一条 `streamable-http` 行即便其端点不可达也能挂载,任何被捕获的日志行都不包含从 `${VAR}` 展开出的密钥值,以及 `failOnStartupError: true` 会在某行无法连接时拒绝本插件自身的激活。`node_modules/.bin/tsc -p packages/mcp/mcp-config-claude/tsconfig.json --noEmit` 结果干净。
