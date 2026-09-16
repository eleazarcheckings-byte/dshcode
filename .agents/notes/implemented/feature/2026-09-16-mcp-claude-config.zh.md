# Agent Note: Claude Code 的 mcpServers 映射以 $0 成本变成 harness 工具

Status: implemented

[English](2026-09-16-mcp-claude-config.md) | 中文

## 问题

izzy 已经为 Claude Code 运行的每一台 MCP 服务器——一个本地记忆库、一个带密钥库的浏览器驱动、一个 shop-ops 后端、一个聊天中继、一个媒体生成器、一个设计大脑——都只存在于 `.claude.json` 的 `mcpServers` 映射里。harness 自身的 `dsh-mcp-client` 每次只为一条手写的 `cordis.yml` 行挂载一台服务器,因此要在 harness 内部接入同样这十一台服务器,就意味着要重新敲出十一行配置,并在 Claude Code 一侧的命令、URL 或请求头发生变化时手动同步。已经存在的那份配置从未被读取过。

## 决策

`@deepseek-ai/dsh-mcp-config-claude` 在插件激活时一次性读取 Claude Code 形态配置文件的 `mcpServers` 映射,并通过 `ctx.plugin(mcpClient, ...)` 为每一行挂载一个 `@deepseek-ai/dsh-mcp-client` 子实例——这正是 `packages/saturn/design-brain` 已经用于自身单个托管连接的组合方式,只是把它推广到任意映射上。映射键成为已挂载子实例的 `serverName`,因此一行名为 `awake` 会把工具注册为 `mcp__awake__<tool>`,与 Claude Code 自身展示的完全一致。

本包是既有能力之上的一个纯决策层,而不是一项新能力:它自己从不讲 MCP 协议。`src/config.ts` 把全部契约放进两个纯函数——`readServerMap`(唯一的一次文件读取)与 `planMounts`/`planOneRow`(按 `include`/`exclude` 过滤、防御性形态校验,因为该文件是不可信的部署方 JSON、以及转译为 `dsh-mcp-client` 的 `Config`)——因此规划逻辑无需 Cordis 上下文、无需真实服务器即可做单元测试。`src/index.ts` 负责挂载计划:`stdio` 与 `http` 行直接转译;一行没有 `type` 但 `command` 非空时被当作 `stdio`(Claude Code 自身 `.mcp.json` 的形态,`type` 是可选的);`sse` 行总是以具名原因被跳过,因为 `dsh-mcp-client` 只实现了 `stdio` 与 `streamable-http`。`env` 或请求头字符串值中的 `${VAR_NAME}` 引用会在挂载时从进程环境展开——未设置的变量展开为空字符串,绝不展开为字面占位符——展开后的值绝不会被本包写入任何日志行。

挂载被有意地与连接解耦,并且是**并发**进行的:`apply` 通过 `Promise.allSettled` 为每一条已规划的行触发 `ctx.plugin(mcpClient, ...)`,而不是在循环里逐个 `await`——因为单独一行自身的连接握手可能挂起(强制门户网络、被防火墙黑洞的连接),而 `dsh-mcp-client` 的 `connection.ready` 只有在设置了 `connectTimeoutMs` 时才有截止时间;顺序挂载会让挂起的一行阻塞其后所有行,乃至本插件自身的激活,且永远不会结束。因此 `connectTimeoutMs` 现在默认是 `30_000`,而不再保持未设置。除非插件自身的 `failOnStartupError` 配置另有说明,否则每个子实例仍以 `failOnStartupError: false` 挂载,因此一个不可达的 `stdio` 命令或一个失效的 `http` 端点会由 `dsh-mcp-client` 自身报告为不可用——被记录、按其自身的退避策略重试——绝不会中止挂载计划的其余部分;`failOnStartupError: true` 会在所有行都完成结算后,按规划顺序重新抛出第一行的拒绝原因。`getStatus(ctx)` 为调用方的注册作用域发布 `{ configPath, mounted, skipped, failed }`,并注册为一个 effect,随所属 fiber 释放而清空,让消费方无需重新推导即可看到该计划,也不会在拆除之后仍看到一份过期的 “mounted” 列表。

## 考虑过的替代方案

**先给 `dsh-mcp-client` 加上 OAuth 与 `sse` 传输,让每一行 Claude Code 配置都能挂载。** 已拒绝:本包针对的真实配置中,没有任何一行需要这两者(两条 `sse` 行是 Cloudflare 的远程 MCP 服务器,会以具名原因被跳过;`github` 与 `sentry` 是普通的 `http`)。在没有当前消费方的情况下构建未经验证的能力,正是本仓库自身包约定所警惕的“为公开选择要求证据”式坏味道。

**让本包自身成为一个拥有实时逐服务器状态的 `Service`(类似 `awake` 那种带 `connect()`/`disconnect()` 的托管连接)。** 已拒绝:这里的每一台服务器都意在配置后始终在线,而不像 `design-brain` 的单个 SaturnAI 连接那样由设置界面按会话切换。在插件激活时一次性挂载的函数插件,更贴合实际用法,也让本包保持在任务书划定的两文件形态(`config.ts` + `index.ts`)内。

**跳过 `include`/`exclude` 空数组这一细节,只检查 `!== undefined`。** 这是最初的实现,并且是带着 bug 上线的:Schemastery 会把省略的 `z.array(...)` 配置字段解析为 `[]` 而不是 `undefined`,因此在组合测试发现之前,每一行都被静默地当作已排除处理(`mcp__awake__add` 从未注册过)。

**把“存在但为空”的 `include` 一律当作“未配置”(挂载全部)。** 这是第二版实现,在 Mars 第一轮评审中被打回:这会让操作者为了让某次部署“先不挂载任何东西”而显式写下的 `include: []` 静默地变成挂载全部,包括 `saturn-browser` 的 `keychain_export` 与 `shop-ops` 的 `create_invoice`——而本包的 README 早已承认自己会把 Gate 相关的工具交给模型。已上线的修复不再依赖“是否为空”来做区分,而是把区分放到 schema 层:`include: z.union([z.const(null), z.array(String)]).default(null)`,操作者从未碰过的字段解析为 `null`(“未配置”,考虑每一行),显式的 `[]` 则无歧义地表示失败关闭、不挂载任何一行。`planOneRow` 的过滤条件是 `options.include !== undefined && !options.include.includes(serverName)`,`apply` 把 `config.include === null` 映射为“完全不传该选项”给 `planMounts`。

## 后果

想让 izzy 自己的 MCP 服务器可从 harness 内部访问的部署,只需添加一条指向其 `.claude.json` 路径的 `cordis.yml` 行,而不是十一条会与真源脱节的手工挂载 `dsh-mcp-client` 行。每台已挂载服务器都仅凭“可达”这一点就获得了 Gate 相关的能力——密钥库、发送、支出——本包对此不做任何策略决策;README 的 Gate 姿态一节明确说明,它必须只与挂载在它之前的 Gate 级策略插件组合使用,且这一顺序由部署的集成者强制执行,而不是由本包强制执行。按本任务书范围栏,以下阻塞项均已上报给集成者处理:`full-access-gated` 权限预设行(`packages/bundle/base/cordis.patch.yml` 的预设代码块——Mars 第一轮评审指出,先前的自我报告虽声称已上报此项,实际的 `integration_needs` 里却没有它;本报告的 `integration_needs` 已明确列出它)、`mcp-config-claude` 打包行(默认关闭,为 izzy 自己的配置文件打开)、以及 `tsconfig.base.json`/`tsconfig.host.json` 的注册。

本包只读取配置文件顶层的 `mcpServers` 键——`projects["<path>"].mcpServers` 映射(`.claude.json` 自身的按项目服务器列表;izzy 自己的文件里恰有一行,`higgsfield`)从未被读取。这一轮选择把它记录为已知限制而不是修复:读取 `projects` 需要一个本任务书的配置形态(`configPath`、`include`、`exclude`)目前没有位置容纳的“项目选择”新概念,而且当前没有任何部署需要把那一条项目级的行全局挂载。

## 验证

`node_modules/.bin/vitest run packages/mcp/mcp-config-claude` 全绿(6 个文件共 42 个测试):原有的 35 个(`planOneRow`/`planMounts` 的单元覆盖——stdio/http/sse 转译、`${VAR}` 展开含未设置变量、形态错误的行、include/exclude/名称模式过滤、跳过原因中不含任何密钥值——与 `readServerMap` 针对真实临时文件的覆盖;一套真实组合测试启动一个带有真实工具注册表的 Cordis `Context`,只读复用 `dsh-mcp-client` 自身的 stdio 固件服务器),加上这一轮新增的 7 个(新增的 spec 文件,按仓库规则记录在案——原有的 RED spec 未被改动):`planOneRow` 为带 `command` 但无 `type` 的行推断出 `stdio`;`planMounts` 在 `include` 为显式空数组时不挂载任何一行、在省略时挂载全部;一条真实的 `dsh-mcp-client` streamable-http 行(只读复用 `dsh-mcp-client` 自身的 HTTP 固件)注册出 `mcp__web__ping`,且固件观察到了 `${VAR}` 展开后的 `Authorization` 请求头;一条指向不可路由地址的行与一条真实 stdio 行并发挂载,而不会阻塞后者;以及 `getStatus` 在所属 fiber 释放后返回 `undefined`。`node_modules/.bin/tsc -p packages/mcp/mcp-config-claude/tsconfig.json --noEmit` 结果干净,`npx tsx scripts/run-oxlint.ts packages/mcp/mcp-config-claude` 退出码为 0(Mars 第一轮评审发现这里有 11 处 `typescript/no-unnecessary-type-assertion` 报错——`src/` 里 2 处,RED 测试 spec 里 9 处——按 Mars 的指示,没有把这次“RED 之后的测试改动”悄悄并进功能提交,而是单独落成一次保留断言语义的 `fix(saturn): lint` 提交)。
