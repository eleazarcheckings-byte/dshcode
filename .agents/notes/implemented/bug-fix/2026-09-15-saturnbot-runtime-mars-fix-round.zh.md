# Agent Note：SaturnBot 运行时 Mars 修复轮次——部署钩子密钥通道、推理强度校验、Shopify 域名

Status: implemented

[English](2026-09-15-saturnbot-runtime-mars-fix-round.md) | 中文

## 问题

对 `packages/saturn/saturnbot`（`@saturnai/dsh-saturnbot`，SPEC §3 C8a）进行的一次全新上下文 Mars 审查返回了 REVISE，附带四项必须修复的问题：（1）已配置的 Vercel/Cloudflare Pages 部署钩子 URL——本 cell 自己文档中记载的密钥——被作为字面量 `endpoint` 配置值接受，因而被 `store.ts` 的 `writeConfiguration()` 以明文形式持久化到日志中，违反了 ACCEPTANCE 中"日志中绝不出现任何密钥"的要求；（2）`LoggedBotModel.resolveRoute()` 将已连接模型路由器解析出的 `reasoningEffort` 直接传给 `ctx.llm.stream`，未针对目标模型声明的能力做任何校验，导致路由器解析出配置模型不支持的强度时，每一次规划者/领域代理调用都会硬性失败，与 `contracts.ts` 自身记录的兜底约定相矛盾；（3）唯一新增的对外发送路径（`reportChannel: telegram`）没有任何测试覆盖；（4）Shopify 的 `resource`（店铺域名）未经校验就被拼接进请求主机名，且截至 2026-09-15，锁定的 Admin API 版本（`2025-01`）已超出 Shopify 约 12 个月的支持窗口。

## 决策

**修复 1——部署钩子 URL 现在只能通过 `endpointEnv` 解析，绝不能是字面量 `endpoint`。** 在 [config.ts](../../../../packages/saturn/saturnbot/src/config.ts) 和 [types.ts](../../../../packages/saturn/saturnbot/src/types.ts) 的集成模式中新增 `endpointEnv` 字段（校验方式与 `credentialEnv` 相同：`/^[A-Z_][A-Z0-9_]*$/`）。一个 `superRefine` 在模式层拒绝 `vercel`/`cloudflare-pages` 上的字面量 `endpoint`——`engine.configure()` 和 `store.writeConfiguration()` 都会经过同一个 `parseBotConfig` 调用点——因此字面量钩子 URL 在被写入日志之前就会被拒绝，而不仅仅是事后脱敏。[shared.ts](../../../../packages/saturn/saturnbot/src/adapters/shared.ts) 中的 `deployHook()` 出于纵深防御也镜像了同样的拒绝逻辑（针对在模式之外构造的配置对象），并通过 `endpointEnv` 从 `options.environment`/`.env` 中解析该 URL。`redact()`（shared.ts）与引擎自身的 `redacted()`（[engine.ts](../../../../packages/saturn/saturnbot/src/engine.ts)）现在也会脱敏 `endpointEnv` 来源的值，因此即使提供方碰巧在响应中回显了钩子 URL，它也绝不会进入保留的工具事实。`wizard.ts` 的目录将 vercel/cloudflare-pages 字段标记为 `secret: true`，并给出 `endpointEnv` 名称，而不再是非密钥的 `endpoint` 字段，因此 C8b 生成的表单永远不会将其回显。

**修复 2——路由器解析出的推理强度在调用前会被校验，且在不受支持时被丢弃而非硬性失败。** [model.ts](../../../../packages/saturn/saturnbot/src/model.ts) 中的 `resolveRoute()` 现在是异步的：当解析出的路由携带 `reasoningEffort` 时，它会在返回该路由前调用现有的 `ctx.llm.resolveCallConfig({ provider, model, reasoningEffort }, signal)`（与 `packages/acp/acp` 和 `packages/subagent/tool-subagent` 已在使用的能力预检相同）；`UNSUPPORTED_REASONING_EFFORT`（或任何其他）失败只会丢弃 `reasoningEffort` 字段，保留已解析的 `provider`/`model`——与 `contracts.ts` 已记录的、针对路由器缺失或抛出异常时的兜底约定一致，现已在其文档注释中明确扩展说明这一情形。

**修复 3——telegram 报告通道路径现已获得端到端覆盖。** 新增测试：`adapters.spec.ts` 中针对 `createReportDeliveries().telegram` 的模拟 fetch 单元测试（发送摘要，且投递失败时绝不包含 token）；`engine.spec.ts` 中的引擎级测试，断言周期结算时确实调用了已注册的投递，未注册的通道名称只会产生提醒，以及投递抛出异常时仍保留收件箱报告的用例；`composition.spec.ts` 现在断言真实的 `SaturnBotService.snapshot()` 投影携带 `firstRun`/`integrationCatalog`（该行为本已成立——缺的是覆盖，而非行为本身）。

**修复 4——Shopify 的店铺域名已被校验，API 版本也已更新。** [integrations.ts](../../../../packages/saturn/saturnbot/src/adapters/integrations.ts) 中的 `shopify()` 现在要求 `resource` 在构造任何请求 URL 之前必须匹配 `/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u`，对拼写错误或恶意域名以 `ActionRequiredError` 拒绝，从而在 Admin 令牌被发送到任何地方之前就阻止请求；`describeBotConnections()` 也新增了相应的调用前状态检查。锁定的 Admin API 版本从 `2025-01` 更新为 `2026-07`（Shopify 每个版本大约支持 12 个月；截至 2026-09-15，`2026-07` 是当前受支持版本，注释中注明了应重新评估的时间点）。

**附带修复——README 完全缺少概述/目录/开发备注。** 运行仓库自身的 `doc-quick` 关卡（而不仅仅是原轮次运行过的更窄的校验脚本）发现，`packages/saturn/saturnbot/README.md`/`README.zh.md` 是全仓库 652 个包 README 中，仅有的 2 个缺少 YAML frontmatter 以及 `scripts/doc-standard.spec.ts` 要求的规范概述/目录/开发备注骨架的文件。两个文件都被重构为其他所有同级包早已具备的骨架（中文一侧的锚点保留英文 slug，与 `model-router` 的 README 已确立的配对惯例一致，因为双语配对检查是按位置比较链接目标的）。

## 考虑过的替代方案

**事后对部署钩子 URL 做脱敏，而不是在模式层拒绝它。** 已否决：仅靠脱敏会留下一个窗口——字面量密钥在任何脱敏流程运行之前就已被写入配置 YAML 镜像和日志；在 `parseBotConfig`（每条写入路径都会经过的唯一关卡）处拒绝字面量值，能从源头堵住泄漏，而不是在下游打补丁。

**当路由器解析出的强度不受支持时直接抛出异常，与 `tool-subagent` 中更严格的 `preflightChildLlmRoute` 模式保持一致。** 已否决：`contracts.ts` 明确将该路由器记录为建议性质（"路由器抛出异常或省略字段时，视为该次调用未连接路由器，回退到配置值"），而且 SaturnBot 自身的周期是无人值守的后台工作——因某一分级的强度配置错误就让每一次规划者/领域代理调用硬性失败，会拖垮整个业务目标，而不只是降级某一次调用的路由。

**将 Shopify 版本锁定保持在 `2025-01`，仅在"已知限制"中注明版本漂移。** 已否决：README 已声称结构依据"截至 2026-09-15 的公开文档"；在声称保持时效性的同时留着一个过期、不受支持的版本锁定，正是 SPEC §6 的证据纪律要设法防止的那种悄然失真。

## 后果

`node_modules/.bin/vitest run packages/saturn/saturnbot` 达到 85/85 全绿（54 条基线 + 21 条上一轮新增 + 本轮新增 10 条：1 条模型路由器强度丢弃测试、1 条向导目录测试、6 条 adapters 测试——Shopify 域名拒绝、通过 `endpointEnv` 的 vercel/cloudflare-pages、回显 URL 脱敏、2 条 telegram 报告投递测试——以及 2 条引擎测试覆盖配置模式拒绝与日志安全性，再加 2 条报告通道投递引擎测试）。`tsc -p packages/saturn/saturnbot/tsconfig.json --noEmit` 干净无误。`npx tsx scripts/run-gates.ts doc-quick` 在 `packages/saturn/saturnbot/*` 下显示零个发现项；其余全部 doc-quick 发现项都属于同级 cell 的文件（`ui-saturnbot`、`ui-skin-saturn`、`tool-media`、`agent-presets`）或早于本轮次就存在的全仓库翻译配对积压，留给其各自负责的 cell 处理。`config.example.yaml` 已更新为 `endpointEnv` 形态，且仍可通过 `parseBotYaml` 正常解析。

原轮次记录在 README 中的已知缺口保持不变：只有 Telegram 实现了实际生效的 `reportChannel`；通用的 `cloud.deploy` webhook 目标、`social.publish` 以及 `creative.generate` 的 webhook 兜底路径仍需要运营者自行搭建中间件；Telegram/Shopify/Vercel/Cloudflare Pages 适配器依据公开文档实现，但尚未针对真实账户验证。`ui-saturnbot`（C8b）应依据更新后的 `integrationCatalog` 形态，将 vercel/cloudflare-pages 连接表单字段标记为 `secret`——已作为 `integration_needs` 条目报告给编排者，因为 `packages/client/ui-saturnbot/**` 不在本 cell 的范围之内。

提交轨迹（为 RED→green 审计披露）：修复提交 `0540b952b9` 同时改动了 `70e7c99b6a` 刚提交到 `tests/adapters.spec.ts` 的 RED 代码块——为 `src/adapters/integrations.ts:196` 处部署前的 commit-sha 查询插入了第三个 `fetch` mock，追加了 `expect(fetch).toHaveBeenCalledTimes(3)`，并改写了注释。该改动使测试更严格，且是必要的（没有第三个 mock 该代码块无法转绿），但提交信息没有声明它；本段即为该声明。
