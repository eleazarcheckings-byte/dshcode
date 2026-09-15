# SaturnBot 适配器参考

[English](ADAPTERS.md) | 中文

[运行时](README.zh.md)通过全局和各角色的允许列表准入这 23 个强类型工具。适配器声明规定角色上限、效果、输入模式和重试策略；模型参数不能覆盖这些规则。`createBotTools` 需要 Host 管理的数据目录和托管子进程服务。测试仅替换 HTTP 响应，同时使用真实的 Git、文件、进程树和 SQLite。

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

集成设置仅包含环境变量**名称**，不包含凭据字面量。向启动相应 `dsh` 配置档的进程提供这些变量，**或者**将其写入可选的 `<dataDirectory>/.env` 文件（`KEY=value` 形式，忽略注释和空行）。该文件仅在启动时读取一次且从不记录日志；同名的继承进程变量始终优先于文件。为提供方设置最小权限，并指定预期仓库、邮箱、店铺或项目。连接标记为 `configured` 仅表示设置和凭据变量存在，尚未测试认证。缺少配置或提供方返回 401/403 时，显示需要操作。

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
  telegram:
    credentialEnv: SATURN_TELEGRAM_BOT_TOKEN
    resource: '123456789' # 默认聊天 ID；调用时也可改为提供 chatId
  shopify:
    credentialEnv: SATURN_SHOPIFY_TOKEN
    resource: your-store.myshopify.com
  vercel:
    endpointEnv: SATURN_VERCEL_DEPLOY_HOOK_URL # 钩子 URL 本身；将其粘贴到 .env 中，切勿写在此处
  cloudflare-pages:
    endpointEnv: SATURN_CLOUDFLARE_PAGES_DEPLOY_HOOK_URL # 同上：钩子 URL 本身，通过 .env 解析
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

端点覆盖值必须使用 HTTPS，且不得嵌入凭据或片段（查询字符串同样会被拒绝，但 `vercel`/`cloudflare-pages` 的部署钩子 URL 例外，其本身可以合法携带查询字符串）。重定向会被拒绝。远程响应体在解析 JSON 前限制为 128 KiB，随后按提供方响应模式验证。保留的数据会隐去配置的凭据值；传输失败不会保留提供方响应体或异常内容片段。提供方仍可能返回私有业务内容，因此需要保护本地数据目录和仪表盘访问。

`vercel` 和 `cloudflare-pages` 是"必须配置凭据"规则的两个例外——同时也是"`endpoint` 保存 URL"规则的例外：部署钩子 URL 本身即是密钥（平台仅凭该 URL 即可完成认证），因此绝不能以字面量 `endpoint` 值存储——配置会被逐字持久化到日志中，字面量密钥写在那里就会泄漏。应改为配置 `endpointEnv`（环境变量名称，解析方式与 `credentialEnv` 相同）；若在这两个集成上配置了字面量 `endpoint`，会在配置时被拒绝。这两者的 `credentialEnv` 仍为可选项，若配置了该字段，仍会以 `Authorization: Bearer …` 形式发送。

## 提供方操作

| 工具 | 提供方行为 |
| --- | --- |
| `github.create_pr` | 将批准的提交推送到确定性的任务分支并创建草稿 PR，不执行合并。 |
| `email.inbox`、`email.draft`、`email.send` | 读取收件箱预览、创建未发送草稿，或提交精确批准的邮件。 |
| `stripe.metrics` | 读取余额和一页受限的交易记录，保留各币种及其最小货币单位。 |
| `cloud.deploy` | 确认提交已存在于 GitHub，然后触发一等公民的 `vercel`/`cloudflare-pages` 部署钩子，或配置的通用部署 webhook。 |
| `social.publish` | 将批准的频道和文本提交给配置的提供方。 |
| `creative.generate` | 若已连接媒体提供方则路由至该处，否则向配置的 webhook 请求图像/视频/音频资产；两种情况下都返回实际状态和链接。 |
| `telegram.send` | 通过配置的机器人向默认聊天或指定聊天发送已批准的消息。 |
| `shopify.orders_list`、`shopify.products_list` | 读取一页受限、不含客户个人信息的订单或产品及库存变体数据。 |
| `shopify.inventory_update` | 在获得批准后，设置某库存项在某地点的可用数量。 |

GitHub 默认使用 `https://api.github.com` 和 API 版本 `2026-03-10`。发布令牌需要仓库内容写入和拉取请求写入权限。仅当任务标记和头部版本完全匹配时，适配器才复用已有 PR。推送认证仅提供给对应的 Git 调用；钩子、凭据助手、签名和重定向均被禁用。参见 [GitHub 拉取请求](https://docs.github.com/en/rest/pulls/pulls)。

邮件默认使用 Microsoft Graph `https://graph.microsoft.com/v1.0` 的 `/users/{mailbox}`。收件箱访问需要邮件读取权限，创建草稿需要邮件读写权限，提交邮件需要发送权限；委托访问或应用访问遵循租户的授权策略。`email.send` 要求 HTTP 202，并报告已接受提交，**不确认送达**。草稿保持未发送状态。网络结果不确定时，邮件变更不会重试。参见[列出邮件](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)和[发送邮件](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)。

Stripe 默认使用 `https://api.stripe.com/v1`；密钥需要余额和余额交易读取权限。适配器按币种分别汇总 charge/payment 收入、退款、手续费、提现、其他流出和净变动。整数保留各币种的最小单位。提现不计入收入。合计仅覆盖返回的一页；`hasMore` 明确说明存在更多交易。这些数值表示账户资金变动，不是完整的会计利润计算。参见[余额交易](https://docs.stripe.com/api/balance_transactions/list)。

Telegram 默认使用 `https://api.telegram.org`；机器人令牌携带在请求路径中（`/bot<token>/sendMessage`），而非 `Authorization` 请求头，与 [Bot API](https://core.telegram.org/bots/api#sendmessage) 一致。`telegram.send` 默认发送到配置的 `resource` 聊天 ID，除非调用时提供了 `chatId`。请先通过 [@BotFather](https://core.telegram.org/bots#how-do-i-create-a-bot) 创建机器人并将其加入目标聊天，然后再发送消息。

Shopify 会依据 `resource`（店铺域名，在发出任何请求前都会校验其形如 `<label>.myshopify.com`——否则拼写错误或恶意值会把 Admin API 令牌发送到该主机）推导端点为 `https://<resource>/admin/api/2026-07`，除非 `endpoint` 覆盖该值；认证方式为 `X-Shopify-Access-Token`，而非 bearer 令牌——参见 [Admin API 访问令牌](https://shopify.dev/docs/api/admin-rest)。截至 2026-09-15，`2026-07` 是 Shopify 当前受支持的 Admin API 版本（每个版本大约支持 12 个月）；应在 2027-07 之前重新评估。`shopify.orders_list`/`shopify.products_list` 只保留商务字段（id、名称/标题、状态、总额、币种、行项目/变体）；客户姓名、邮箱或地址永远不会进入模型可见的数据。`shopify.inventory_update` 需要精确的 `inventoryItemId` 和 `locationId`，并报告提供方确认的 `available` 数量，参见[库存水平](https://shopify.dev/docs/api/admin-rest/2026-07/resources/inventorylevel)。

## 部署、社交与创意 HTTP 请求

这些集成要求运营者配置实现以下 JSON 请求的端点；任意供应商 API URL 并不足够。每个请求使用 POST、`Authorization: Bearer …`、`Content-Type: application/json`，以及与 `requestId` 相同的 `Idempotency-Key`。未指定的可选 `resource` 字段会被省略。提供方负责去重及所选项目或频道的授权。

| 端点 | 请求 JSON 字段 |
| --- | --- |
| Cloud | `resource?`、`repository`、`revision`、`environment`、`requestId` |
| Social | `resource?`、`channel`、`text`、`requestId` |
| Creative | `resource?`、`kind`（`image`、`video`、`audio`）、`prompt`、`requestId` |

成功的 JSON 响应包含 `id` 和 `status`（`accepted`、`running` 或 `completed`），以及可选 HTTPS `url`。创意响应最多可以包含 20 个 `assets`，每项具有 HTTPS `url` 和 `mimeType`。保留的资产列表较大时会报告 `omittedAssets`。资产 URL 不得嵌入用户名或密码凭据。异步接受保持异步状态；适配器不会虚构完成、轮询状态或下载资产。发布、部署和创意生成在响应不确定时均不会自动重试。其审批规则由中央运行时负责。

## 一等公民部署钩子与媒体路由

`cloud.deploy` 接受可选的 `target`：`webhook`（默认，即上述通用契约）、`vercel` 或 `cloudflare-pages`。对于后两者，它仍会先确认提交已存在于 GitHub，然后直接向通过 `endpointEnv` 解析出的部署钩子 URL POST `{ ref, environment, requestId }`——仅当配置了 `credentialEnv` 时才附加 `Authorization: Bearer …`——并将提供方的 JSON 响应原样返回在 `response` 字段中（若提供方碰巧在响应中回显了钩子 URL 本身，该值也会被隐去），因为 Vercel 与 Cloudflare Pages 各自的接受响应结构不同，本运行时不对其具体字段做断言。参见 [Vercel 部署钩子](https://vercel.com/docs/deployments/deploy-hooks)与 [Cloudflare Pages 部署钩子](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)。

`creative.generate` 首先检查是否已连接媒体能力（`ctx.get('media')`，即 `@saturnai/dsh-tool-media` 契约：`generate({ kind, prompt, provider?, model?, params?, workspace }) → { id, status, assets, cost }`）。若已连接，请求将路由至该处而非通用创意 webhook，返回的 `cost.estimatedUsd`/`provider`/`model` 会与 `assets` 一并保留。若未连接媒体能力，该工具的行为与上述通用 webhook 契约保持不变。

## 报告投递

`reportChannel: inbox`（默认）只会写入持久化的报告收件箱。`reportChannel: telegram` 会在周期结算完成后，额外将每日摘要（截断至 4096 字符）发送到配置的 Telegram 集成对应的聊天 ID；投递失败会产生提醒，但绝不会丢失收件箱中的副本。其他任何频道名称保持原有行为：产生明确提醒说明该频道未实现，报告仅保留在收件箱中。

## 签名 webhook 接入

向 `POST /saturnbot/webhook` 发送 JSON，携带 `x-saturnbot-timestamp`（Unix 秒）、`x-saturnbot-delivery`（稳定的投递 ID）、`x-saturnbot-source` 和 `x-saturnbot-signature`（十六进制 HMAC-SHA256）。使用配置的 webhook 密钥，对 `JSON.stringify([timestamp, deliveryId, source]) + '\n'` 的 UTF-8 字节后接精确原始请求体计算签名；三个请求头值均为字符串。JSON 数组确保标识即使包含句点也不会混淆。Host 执行配置的重放时间窗口和请求体限制。相同标识及内容的重复请求返回接受状态并带有 `duplicate: true`；内容变更返回 HTTP 409。临时存储失败返回 HTTP 503，可以使用相同标识和内容重试。成功存储的回执在下一次评估时提供给 `webhook.inbox`。
