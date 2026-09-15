# Agent Note：SaturnBot 的 .env 凭据通道、Telegram/Shopify 适配器、部署钩子及媒体/模型路由

Status: implemented

[English](2026-09-15-saturnbot-runtime-integrations.md) | 中文

## 问题

2026-09-15 会话对 SaturnBot 的调研审计发现：这是一个真实、可持久化的执行引擎，但尚不足以运行一门实际业务——凭据只能通过 Host 启动前设置的操作系统环境变量传入；`cloud.deploy`/`social.publish`/`creative.generate` 都只是通用的运营者 webhook 占位实现，没有任何厂商客户端；没有任何通道能连接到 izzy 自己使用的工具（Telegram、Shopify）；每次规划者/领域代理调用始终使用 harness 唯一配置的默认提供方，无论所需分级如何；控制台向导也没有任何持久化数据可用来渲染首次运行或连接表单体验。

## 决策

新增的受限 `.env` 加载器（[src/adapters/env-file.ts](../../../../packages/saturn/saturnbot/src/adapters/env-file.ts)）在启动时读取一次 `<dataDirectory>/.env`，并将其层级置于继承的进程环境之下（同名的显式进程变量始终优先，与 harness 自身的凭据分层约定一致）；合并后的环境通过一个共享的 `toolOptions` 对象贯穿每个适配器，并传入引擎自身的脱敏逻辑，使 `.env` 来源的密钥在所有检查或脱敏之处都得到与进程提供的密钥完全一致的处理。

[shared.ts](../../../../packages/saturn/saturnbot/src/adapters/shared.ts) 中的 `integration()`/`deployHook()` 现在直接基于 `BotConfig` 解析，而非完整的工具调用上下文，因此同一个解析函数既能服务模型发起的工具调用，也能服务引擎自身直接发起的报告投递。[integrations.ts](../../../../packages/saturn/saturnbot/src/adapters/integrations.ts) 中新增的适配器：`telegram.send`（按照 Telegram Bot API，机器人令牌携带在 URL 中而非 bearer 请求头）向默认或指定的聊天发送消息；`shopify.orders_list`/`shopify.products_list` 通过 `X-Shopify-Access-Token` 读取一页受限、不含客户个人信息的商务数据；`shopify.inventory_update` 在获批后设置某项的库存数量。`cloud.deploy` 新增 `target` 字段：`vercel`/`cloudflare-pages` 在既有的 GitHub 发布确认之后，直接向配置的部署钩子 URL 发起 POST（凭据可选，因为该钩子 URL 本身即是密钥），而通用 webhook 契约保持不变作为兜底。`creative.generate` 会先检查鸭子类型的 `options.services?.get('media')` 能力（即 C7 的 `@saturnai/dsh-tool-media` 契约），再回退到既有的 webhook。

`LoggedBotModel`（[model.ts](../../../../packages/saturn/saturnbot/src/model.ts)）在已连接鸭子类型的 `ctx.get('modelRouter')`（即 C6 的 `@saturnai/dsh-model-router` 契约）时，会为每次调用解析提供方/模型/推理强度——规划用 `coordinator` 分级，角色提案用 `specialist` 分级；若未连接路由器，或路由器抛出异常/返回不完整的路由，则回退到已配置的 `provider`/`model`；持久化的模型请求记录始终反映实际使用的路由。`BotSnapshot` 新增 `firstRun`（当前目标/工作区/提供方，以及已知提供方的凭据是否存在）和 `integrationCatalog`（静态的字段级连接表单目录，每个字段标注是否为 `secret`，确保界面永不回显凭据值），由新的 [wizard.ts](../../../../packages/saturn/saturnbot/src/wizard.ts) 提供，计算方式与既有的 `connections` 投影在 `SaturnBotService.project()` 中的做法完全一致。

## 已考虑的替代方案

最初考虑复用 harness 的 `dsh-credentials-local` 文件支持型提供方，因为它已经在继承环境之下叠加了项目/用户级 `.env`；但由于其文件位置固定在 `$DSH_HOME`/调用目录，而非 SaturnBot 自身的 `dataDirectory`，为寥寥数行逻辑引入跨包依赖并不划算，最终放弃该方案，改用自有的受限加载器。曾考虑让 `reportChannel: telegram` 复用模型可见的工具调用（即 `telegram.send`）来投递摘要，但最终选择由引擎直接调用的 `BotReportDelivery`：摘要投递属于引擎发起的自动化行为，而非模型决策，若强行走审批门槛的工具路径，要么会卡在一个根本没人被问及的审批上，要么会悄悄绕过审批。曾考虑为 Shopify 库存写入这类"无需暂存但需要审批"的非代码操作新增一个 `ToolEffect`；但由于代码库中 `'social'` 效果已经被 `creative.generate`（本身并非"社交"性质）复用作为该类别的既有约定，新增效果只会打散这一已经确立的模式。

## 后果

现有的 54 个 saturnbot 包测试加上 21 个新测试均已通过（`node_modules/.bin/vitest run packages/saturn/saturnbot`：9 个文件、75 个测试）。新增的模拟 HTTP 测试覆盖：`.env` 加载器（解析、优先级、超大文件拒绝）、Telegram 发送及其缺失聊天 ID 时的拒绝、Shopify 的读写及其缺失店铺资源时的拒绝、两个新的 `cloud.deploy` 目标（含嵌入凭据 URL 的拒绝）、`creative.generate` 的媒体优先路由与 webhook 兜底，以及模型路由器的 coordinator/specialist 分级解析及其在路由器缺失/抛错时的回退路径。`tsc -p packages/saturn/saturnbot/tsconfig.json --noEmit` 无错误。

已知缺口记录在包 README 的"已知限制与遗留工作"中：目前只有 Telegram 实现了真正生效的 `reportChannel`；通用的 `cloud.deploy` webhook 目标、`social.publish` 以及 `creative.generate` 的 webhook 兜底仍需要运营者自建中间件；Telegram/Shopify/Vercel/Cloudflare Pages 适配器遵循各自的公开文档编写，但本次会话未针对真实账户验证（因此 Vercel/Cloudflare 部署钩子的响应被当作不透明 JSON 保留，而非逐字段断言）；`firstRun.credentials` 的已知提供方表是人工维护的静态列表，对未识别的提供方 ID 只会返回空列表而不做猜测。姊妹分支 `ui-saturnbot` 会依据这些确切的数据结构、以本地类型编写其向导界面；集成阶段负责协调任何 RPC 层面的偏差。
