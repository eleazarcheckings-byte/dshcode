# SaturnBot 适配器参考

[English](ADAPTERS.md) | 中文

[运行时](README.zh.md)通过全局和各角色的允许列表准入这 19 个强类型工具。适配器声明规定角色上限、效果、输入模式和重试策略；模型参数不能覆盖这些规则。`createBotTools` 需要 Host 管理的数据目录和托管子进程服务。测试仅替换 HTTP 响应，同时使用真实的 Git、文件、进程树和 SQLite。

## 本地工具与隔离

| 工具 | 操作 |
| --- | --- |
| `git.status`、`git.diff`、`fs.read` | 读取仓库状态或受大小限制的 UTF-8 源文件。 |
| `workspace.stage` | 从已提交的 HEAD 创建或恢复任务专属的分离工作树。 |
| `fs.write` | 原子替换一个暂存文件，并提交其精确版本。 |
| `shell.validate` | 运行 `validationCommands` 中完整指定的可执行程序和参数数组。 |
| `memory.search`、`memory.write` | 按字面文本查询或更新持久记忆条目。 |
| `tickets.list`、`tickets.upsert` | 读取或更新具有明确状态的本地支持工单。 |
| `webhook.inbox` | 读取经过认证和去重的 webhook 回执。 |

文件适配器拒绝路径穿越、符号链接路径组件、Git 元数据、常见凭据目录、环境变量文件，以及 Windows 设备名和路径别名。单次读写限制为 128 KiB；保留的字符串上限为 16 KiB，截断时明确标注。工作树不包含源检出目录中未提交的改动。暂存写入会创建提交；验证和发布会检查归属、精确提交以及工作树是否干净。空的验证配置不能授权发布。GitHub 推送和部署始终引用该不可变提交。

验证按配置的 argv 数组执行，不经过 shell 插值；它移除环境中的凭据、替换为独立 HOME、限制输出，并在取消或超时后等待进程树清理完成。**Git 工作树不是操作系统沙箱。** 配置的验证命令能够以 Host 账户的文件系统和网络权限运行项目代码，包括访问工作树以外的位置。不可信仓库需要单独受限的运行环境或主机。清空环境变量无法阻止代码读取账户有权访问的文件。

暂存工作树保留以便检查和恢复审批；创建失败时通过 Git 尝试移除。提交结果不确定时，`fs.write` 不会自动重试。如果暂存工作树变脏或被外部修改，应检查其状态；无法恢复记录的版本时需开始新任务。记忆、工单和 webhook 回执存储在 Host 数据目录的 `knowledge.sqlite`，查询使用参数化语句，连接在每次操作后关闭。记忆查询是子串搜索，不接受任意 SQL。

## 配置凭据

集成设置仅包含环境变量**名称**，不包含凭据字面量。向启动相应 `dsh` 配置档的进程提供这些变量。为提供方设置最小权限，并指定预期仓库、邮箱或项目。连接标记为 `configured` 仅表示设置和凭据变量存在，尚未测试认证。缺少配置或提供方返回 401/403 时，显示需要操作。

```yaml
integrations:
  github:
    credentialEnv: SATURN_GITHUB_TOKEN
    resource: owner/repository
  email:
    credentialEnv: SATURN_GRAPH_TOKEN
    resource: operator@example.com
  stripe:
    credentialEnv: SATURN_STRIPE_KEY
  cloud:
    endpoint: https://deploy.example.com/saturnbot
    credentialEnv: SATURN_DEPLOY_TOKEN
    resource: project-id
  social:
    endpoint: https://social.example.com/saturnbot
    credentialEnv: SATURN_SOCIAL_TOKEN
  creative:
    endpoint: https://creative.example.com/saturnbot
    credentialEnv: SATURN_CREATIVE_TOKEN
  webhook:
    credentialEnv: SATURN_WEBHOOK_SECRET
```

端点覆盖值必须使用 HTTPS，且不得嵌入凭据、查询或片段。重定向会被拒绝。远程响应体在解析 JSON 前限制为 128 KiB，随后按提供方响应模式验证。保留的数据会隐去配置的凭据值；传输失败不会保留提供方响应体或异常内容片段。提供方仍可能返回私有业务内容，因此需要保护本地数据目录和仪表盘访问。

## 提供方操作

| 工具 | 提供方行为 |
| --- | --- |
| `github.create_pr` | 将批准的提交推送到确定性的任务分支并创建草稿 PR，不执行合并。 |
| `email.inbox`、`email.draft`、`email.send` | 读取收件箱预览、创建未发送草稿，或提交精确批准的邮件。 |
| `stripe.metrics` | 读取余额和一页受限的交易记录，保留各币种及其最小货币单位。 |
| `cloud.deploy` | 确认提交已存在于 GitHub，然后将其 SHA 提交给配置的部署提供方。 |
| `social.publish` | 将批准的频道和文本提交给配置的提供方。 |
| `creative.generate` | 请求图像、视频或音频资产，返回提供方实际状态和 HTTPS 链接。 |

GitHub 默认使用 `https://api.github.com` 和 API 版本 `2026-03-10`。发布令牌需要仓库内容写入和拉取请求写入权限。仅当任务标记和头部版本完全匹配时，适配器才复用已有 PR。推送认证仅提供给对应的 Git 调用；钩子、凭据助手、签名和重定向均被禁用。参见 [GitHub 拉取请求](https://docs.github.com/en/rest/pulls/pulls)。

邮件默认使用 Microsoft Graph `https://graph.microsoft.com/v1.0` 的 `/users/{mailbox}`。收件箱访问需要邮件读取权限，创建草稿需要邮件读写权限，提交邮件需要发送权限；委托访问或应用访问遵循租户的授权策略。`email.send` 要求 HTTP 202，并报告已接受提交，**不确认送达**。草稿保持未发送状态。网络结果不确定时，邮件变更不会重试。参见[列出邮件](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)和[发送邮件](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)。

Stripe 默认使用 `https://api.stripe.com/v1`；密钥需要余额和余额交易读取权限。适配器按币种分别汇总 charge/payment 收入、退款、手续费、提现、其他流出和净变动。整数保留各币种的最小单位。提现不计入收入。合计仅覆盖返回的一页；`hasMore` 明确说明存在更多交易。这些数值表示账户资金变动，不是完整的会计利润计算。参见[余额交易](https://docs.stripe.com/api/balance_transactions/list)。

## 部署、社交与创意 HTTP 请求

这些集成要求运营者配置实现以下 JSON 请求的端点；任意供应商 API URL 并不足够。每个请求使用 POST、`Authorization: Bearer …`、`Content-Type: application/json`，以及与 `requestId` 相同的 `Idempotency-Key`。未指定的可选 `resource` 字段会被省略。提供方负责去重及所选项目或频道的授权。

| 端点 | 请求 JSON 字段 |
| --- | --- |
| Cloud | `resource?`、`repository`、`revision`、`environment`、`requestId` |
| Social | `resource?`、`channel`、`text`、`requestId` |
| Creative | `resource?`、`kind`（`image`、`video`、`audio`）、`prompt`、`requestId` |

成功的 JSON 响应包含 `id` 和 `status`（`accepted`、`running` 或 `completed`），以及可选 HTTPS `url`。创意响应最多可以包含 20 个 `assets`，每项具有 HTTPS `url` 和 `mimeType`。保留的资产列表较大时会报告 `omittedAssets`。资产 URL 不得嵌入用户名或密码凭据。异步接受保持异步状态；适配器不会虚构完成、轮询状态或下载资产。发布、部署和创意生成在响应不确定时均不会自动重试。其审批规则由中央运行时负责。

## 签名 webhook 接入

向 `POST /saturnbot/webhook` 发送 JSON，携带 `x-saturnbot-timestamp`（Unix 秒）、`x-saturnbot-delivery`（稳定的投递 ID）、`x-saturnbot-source` 和 `x-saturnbot-signature`（十六进制 HMAC-SHA256）。使用配置的 webhook 密钥，对 `JSON.stringify([timestamp, deliveryId, source]) + '\n'` 的 UTF-8 字节后接精确原始请求体计算签名；三个请求头值均为字符串。JSON 数组确保标识即使包含句点也不会混淆。Host 执行配置的重放时间窗口和请求体限制。相同标识及内容的重复请求返回接受状态并带有 `duplicate: true`；内容变更返回 HTTP 409。临时存储失败返回 HTTP 503，可以使用相同标识和内容重试。成功存储的回执在下一次评估时提供给 `webhook.inbox`。
