---
description: "读取 Claude Code 形态的 mcpServers 映射，并为每一行挂载一个 dsh-mcp-client 子实例，供想要在 harness 内以 $0 成本接入 izzy 自有 MCP 服务器(awake recall、saturn-browser、saturn-gx、shop-ops、telegram-hive、gemini-media、saturndesign 等)的部署方与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-config-claude

[English](README.md) | 中文

## 概述

`dsh-mcp-config-claude` 读取一个 Claude Code 形态的配置文件——与 `.claude.json` 或 `settings.json` 中已有的同一份 `mcpServers` 映射——并为每一行挂载一个 `@deepseek-ai/dsh-mcp-client` 子实例，让每一台已为 Claude Code 注册的服务器都以完全相同的 `mcp__<serverName>__<tool>` 名称成为 harness 工具。当某个部署的 MCP 服务器已经写在 Claude Code 配置里、再把它们重新写成 `cordis.yml` 行只会是一次有损复制时,添加它。它本身不做任何发现:`stdio` 行会启动一个子进程,`http` 行会拨号 Streamable HTTP,而 `sse` 行——`dsh-mcp-client` 未实现的传输方式——会被以一个具名原因跳过,而不是被尝试。成本模型就是 `dsh-mcp-client` 自身的成本,乘以挂载的行数:每台已挂载服务器的工具定义 token,加上任何不可达或缓慢服务器引入的启动延迟或重连抖动。

## 目录

- [使用本包](#use-this-package)
- [Gate 姿态](#gate-posture)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当一个 Claude Code 形态的配置文件已经列出了某部署想要的 MCP 服务器、而把它们逐一手写成 `cordis.yml` 里独立的 `dsh-mcp-client` 行会重复那份列表时,添加 `dsh-mcp-config-claude`。一条配置项就配置了整份文件。

### 最小配置

```yaml
- id: mcp-config-claude
  name: '@deepseek-ai/dsh-mcp-config-claude'
  config:
    configPath: 'C:\Users\izzy\.claude.json'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `configPath` | 必填 | 指向一个 `.claude.json` 或 `settings.json` 形态文件的路径,其顶层 `mcpServers` 键持有该映射 |
| `include` | 每一行 | 只考虑这些服务器名(映射键);空列表或省略表示每一行都考虑 |
| `exclude` | `[]` | 这些服务器名永不挂载,即便 `include` 允许它们 |
| `toolCallTimeoutMs` | `60000` | 转发给每个已挂载子实例,作为其单次工具调用超时 |
| `connectTimeoutMs` | 未设置(`dsh-mcp-client` 的默认值) | 设置时转发给每个已挂载子实例,作为其连接握手截止时间 |
| `failOnStartupError` | `false` | 任意一行挂载失败时拒绝本插件自身的激活,而不是记录该失败并继续 |

### 从配置文件读取的行形态

每条 `mcpServers` 记录都按其 `type` 字段读取,与 Claude Code 写出的完全一致:

```json
{
  "mcpServers": {
    "awake": { "type": "stdio", "command": "node", "args": ["awake-server.mjs"] },
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp" },
    "cloudflare-bindings": { "type": "sse", "url": "https://bindings.mcp.cloudflare.com/sse" }
  }
}
```

- `"stdio"` 挂载一个 `dsh-mcp-client` 的 `StdioConfig`——`command`、`args`、`env`、`cwd` 直接转译,`args` 与 `env` 缺省时分别默认为 `[]` 与 `{}`。
- `"http"` 挂载一个 `dsh-mcp-client` 的 `StreamableHttpConfig`——`url` 与 `headers` 直接转译,`headers` 缺省时默认为 `{}`。
- `"sse"` 总是被跳过:`dsh-mcp-client` 只实现了 `stdio` 与 `streamable-http`。任何其他或缺失的 `type`,以及任何不是 JSON 对象的行,同样被跳过。
- 映射键成为已挂载子实例的 `serverName`,因此上面的 `awake` 会把工具注册为 `mcp__awake__<tool>`——与 Claude Code 和 Codex 为同一台服务器所用的名称完全相同。

`env` 或 `headers` 中含有 `${VAR_NAME}` 的字符串值,会在挂载时从当前进程环境展开;未设置的变量展开为空字符串,绝不会展开为字面占位符。展开后的值绝不会被本包写入任何日志行。

### “已挂载”的含义,以及它不代表什么

通过过滤与形态校验的一行,会以默认的 `failOnStartupError: false` 交给 `ctx.plugin(dsh-mcp-client, ...)`。那次调用成功解析意味着子插件实例已加载——**并不**意味着该服务器已应答。一个不可达的 `stdio` 命令或一个失效的 `http` 端点,会由 `dsh-mcp-client` 自身报告为不可用(见其 README),它会记录该失败,并默认以退避策略持续重试;本包永远不会把这当作整个挂载计划的致命错误。将 `failOnStartupError` 设为 `true` 会改变这一点:它会被转发给每一个已挂载的子实例,而第一个子实例被拒绝的行也会拒绝本插件自身的激活,阻止其余各行被继续尝试。

调用本包导出的 `getStatus(ctx)`,可读取调用方注册作用域内最近一次的计划:`{ configPath, mounted, skipped, failed }`。`mounted` 列出子插件已加载的服务器名;`skipped` 列出本包拒绝挂载的行及原因(`sse` 传输、被排除的名称、形态错误的行);`failed` 列出子插件实例自身未能加载的行(schema 错误、命名空间重复)——极为罕见,且只有在未设置 `failOnStartupError` 时才会非空,因为设置后该失败会中止激活。向 `mcpClient.isServerConnected(ctx, serverName)`(来自 `@deepseek-ai/dsh-mcp-client`)查询实时连接状态。

<a id="gate-posture"></a>
## Gate 姿态

本包挂载的每一台服务器,都会成为一个具备该服务器自身工具全部能力的 harness 工具——一个密钥库、一次发送、一笔支出、一次数据库写入。本包对这一切不做任何策略决策;它只决定哪些已配置的行有机会注册工具。**只**将它与一个挂载在它之前的 Gate 级策略插件(例如 `@saturnai/dsh-gates`)组合使用,并由部署的集成者来强制这一顺序。在没有 Gate 级策略先行挂载的情况下挂载本包,等于把已配置服务器暴露的每一个携带凭据或支出能力的工具,直接、无中介地交给模型。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

命名空间插件(具名导出 `name` / `inject` / `Config` / `apply`,无默认导出)——与它组合的 `dsh-mcp-client` 子实例形态相同。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口:`Config` schema、读取文件、为每个已规划的行挂载一个子实例、发布 `getStatus` |
| [`src/config.ts`](src/config.ts) | 纯规划逻辑:`readServerMap`(唯一的一次文件读取)、`planOneRow` / `planMounts`(过滤、形态校验、`${VAR}` 展开、转译为 `dsh-mcp-client` 的 `Config`) |
| [`src/types.ts`](src/types.ts) | 仅类型:Claude Code 形态的行与映射形状、计划与状态形状 |

### 设计哲学

- **一次文件读取,之后是纯粹的决策。** `readServerMap` 是 `src/config.ts` 执行的唯一 I/O;`planOneRow` 与 `planMounts` 接收已解析的 JSON 并返回一份计划,因此过滤与转译逻辑无需 Cordis 上下文或真实服务器即可做单元测试。
- **一行内容永远不被信任已匹配某种形态。** 配置文件是部署方拥有的 JSON,不是经过 Schemastery 校验的值,因此每个字段都在边界处被防御性地收窄;本包无法理解的一行是一次具名跳过,绝不是一次抛出的错误。
- **挂载把一切模型可见之事都委托出去。** 本包不注册任何自己的工具、提示词片段或结果渲染逻辑——每台已挂载服务器的工具、描述与结果,都与用相同配置手写一行时 `dsh-mcp-client` 所呈现的完全一致。
- **空的 include 列表意味着“未配置”。** Schemastery 会把省略的 `z.array(...)` 字段解析为 `[]` 而不是 `undefined`;把“存在但为空”的 `include` 当作“无过滤”(而不是“排除一切”)处理,符合从未碰过该字段的操作者的预期。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 已挂载的 MCP 工具(委托给 dsh-mcp-client)

#### 模型看到什么

每台已挂载服务器的每一个工具,渲染方式与 `dsh-mcp-client` 自己的 README 所记录的完全一致:一个名为 `mcp__<serverName>__<rawName>`(或其规范化形式)的原生工具,带有服务器提供的描述与输入 schema。本包不贡献任何自己的提示词文本、工具 schema 或结果投影——它只在每次插件激活时决定一次,哪些已配置的行会被交给某个已挂载的 `dsh-mcp-client` 子实例,以及使用什么 `serverName`。

#### Token 影响

间接且完全委托:每台已挂载服务器的 token 影响就是 `dsh-mcp-client` 自身的影响(工具描述与 schema 在注册期间进入每次请求)。本包跳过的一行——`sse` 传输、被排除的名称、格式错误的 JSON——完全不产生 token 影响,因为根本没有子实例为它挂载。

#### KV 缓存影响

间接且完全委托:与某服务器挂载后 `dsh-mcp-client` 自身的 KV 缓存影响完全相同。本包在挂载之后不做任何影响缓存的决策;它自己的文件读取与规划只发生一次,即插件激活时,早于任何模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制描述了你用本插件做不到什么,以及它何时需要运维关注。它们是当前的包级约束,不是与其他配置导入器的比较,也不是任务待办列表。

- **无 OAuth** ——需要 OAuth 流程(而非静态请求头)才能接入的服务器行,会以 `http` 行的形式挂载,并带上配置文件提供的任意 `headers`,并在连接时鉴权失败;本包无法代表模型或操作者驱动任何此类流程。
- **无 `sse` 传输** ——`dsh-mcp-client` 只实现了 `stdio` 与 `streamable-http`;每一行 `sse` 都会被以具名原因跳过,绝不会被尝试。把某台服务器迁出 `sse` 不在本包范围内。
- **无组织级托管服务器列表** ——本包只读取恰好一个本地文件;想要集中管理服务器名单的部署,需要为该文件自备分发机制,或使用完全不同的配置来源。
- **配置文件不会实时重载** ——文件只在插件激活时读取一次;之后编辑它不会有任何效果,直到插件(或 Host)重新加载。
- **格式错误行自身的错误文本中不做二次脱敏** ——本包本身绝不会把原始的 `env` 或 `header` 值拼进日志行或跳过原因,但本包所调用的某个依赖抛出的上游错误(罕见,且仅出现在结构性无效的配置值上)会被原样记录;本包自身实际控制的边界见组合测试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

这条开发备注是给维护者的工作背景:尚未决定的开放设计问题与方向。它明确不具权威性——已发布的行为、限制与已接受的理由,存在于上面各节、包代码与关联的 Agent Note 中。

- 行校验是防御性的,但并不穷尽:一个 `stdio` 行的 `command` 仍可能指向根本不是 MCP 服务器的东西,这会以与任何其他不可达服务器相同的方式呈现(记录、重试、默认非致命),而不是作为一种独立诊断。
- `include`/`exclude` 是否也应接受 glob 或正则,而不仅是精确服务器名,尚属开放问题;本包所针对的真实配置从未需要过这一点。
- 未来若有 `getStatus` 的消费方想为每台已配置服务器渲染一行 UI(已挂载 / 已跳过 / 失败,附原因),可以按已发布的形状读取;目前这里还没有任何东西渲染它。

</details>
