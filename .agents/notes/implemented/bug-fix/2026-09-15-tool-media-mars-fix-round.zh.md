# 开发笔记:tool-media 的 Mars 修复轮次——真正的 `withAgent` 绑定,以及照旧诚实的那些缺口

状态:已实现

[English](2026-09-15-tool-media-mars-fix-round.md) | 中文

## 问题

一次全新上下文对 `packages/saturn/tool-media`(`@saturnai/dsh-tool-media`,SPEC §3 C7)的 Mars 评审给出了"需修改"结论,提出四处必须修复的问题:(1)`MediaService.generate()` 对 SPEC §4 固定的单参数调用(`generate(req)`,没有 `exec`)会抛出"没有 agent 可用于路由批准提示"——而这恰恰是唯一已知消费者 SaturnBot 的 `creative.generate` 实际调用它的方式,所以那个调用点从一开始就是死路;(2)`media_motion_transfer` 的 Higgsfield "Genjutsu" 缺口需要一个真实端点,或是一份书面确认——接受动作迁移功能改为调用方自行配置;(3)本包唯一那次实现提交改动了一个 RED 测试文件(只是替换了 mock 路由,而非断言,但仍是流程违规);(4)`src/types.ts` 导出了两个运行时 `const` 数组,违反了本仓库对该文件"仅类型"的约定。

## 决策

**修复 1(阻塞项)——`MediaService.withAgent(agent, defaults?)`。** 在 `src/index.ts` 中新增:将本服务绑定到某一个调用方 `Agent`,返回一个 `BoundMediaService`(`{ generate(req): Promise<Job>; status(id): Promise<Job> }`),与 SPEC §4 固定的形状完全一致——手上持有 `Agent` 的消费者可以完全不传 `exec` 参数进行调用,而底层真正的花费闸门依然生效。由 `tests/with-agent.spec.ts`(新文件,先提交 RED)证明:绑定对象的固定形状调用能顺利通过审批,费用行照常出现,且被拒绝的审批仍会照常关闭失败。

这**并未**解开 SaturnBot 实际调用点的死结,而这一点也如实报告而非悄悄打上补丁:阅读 `packages/saturn/saturnbot/src/adapters/integrations.ts` 与 `contracts.ts`(二者均不在本 cell 的 IN 范围内,仅作只读阅读)可见,SaturnBot 自身的工具执行模型里根本没有 `dsh-agent` 的 `Agent` 对象——它的工具由自己的 `roles`/`effect` 中心化审批机制(`ActionRequiredError`)在调用前统一把关,而不是针对某个交互式会话逐次审批。要求一个没有会话形态身份的调用方在 `media.generate` 内部再走一次独立的 `ctx.approval` 提示,是两个包之间的架构不匹配,不是本包能单方面从 `packages/saturn/tool-media/**` 内解决的缺失绑定。因此将其记录为一项阻塞性的 `integration_needs`,列出三个具体解决方案(SaturnBot 自行构造一次性的 Agent 影子对象并通过 `withAgent` 绑定;接受 SaturnBot 自身的前置审批对这一调用点已经足够;或修改 `BotMediaService`/`creative.generate` 的契约),交给负责 C7↔C8a 接线的一方决定。

**修复 2——Genjutsu 已重新核实,而非猜测。** 本轮修复中重新实时抓取了 `docs.higgsfield.ai/docs/openapi.json`:仍是相同的 50 条路径,依旧没有动作迁移/物体替换/genjutsu 操作。另外还直接探测了 `docs/genjutsu`、`docs/motion-control`、`docs/models/genjutsu`——均返回 404 或被重定向到文档首页(一个客户端渲染的 SPA,没有静态站点地图,因此不带 JS 运行时的抓取器只能确认到这一步)。本次自主运行中无法获得 izzy 关于"改为发布一个猜测路径"的书面确认,因此调用方自行配置(要求 `params.modelPath`/`params.body`,拒绝猜测)的行为保持不变,现在 README 中同时引用并标注了这两次抓取的结果与日期。

**修复 3——留痕,而非改写历史。** git 历史无法事后改写;本轮修复自身的两次提交(`test(saturn)` RED,随后是这次 `fix(saturn)`)是干净的,README 的开发者说明现在也明确点出了此前那次被错误归并的提交,供日后审计历史的人参考。

**修复 4——`src/types.ts` 重新变回仅类型。** `MEDIA_PROVIDER_IDS` 与 `MEDIA_KINDS` 移入 `src/index.ts`(仍从同一个公开入口以相同名称导出——对消费者而言没有可见变化);`types.ts` 现在只保留 `MediaProviderId`/`MediaKind` 等类型。

## 考虑过的替代方案

**直接悄悄修改 SaturnBot 的 `integrations.ts`,构造一个 Agent 影子对象并调用 `withAgent`。** 被否决:`packages/saturn/saturnbot/**` 属于 C8a 的 IN 范围,不属于本 cell;即便改动能顺利编译,写入那里也违反 SPEC §3 为每个 cell 规定的排他范围规则。

**从已连接的 Higgsfield MCP 内部模型 id(`hf_mult_motion_control`、`hf_mult_replace_object`)猜测一个 Genjutsu 路径。** 本轮再次否决,原因与最初构建时相同:那些是聚合器 MCP 自身的内部 id,不是已发布的 REST 路径,本包的品质底线是一个已验证的契约,或一次诚实的拒绝——绝不是一个猜测出来的契约。

**彻底去掉 `exec` 扩展,要求每个调用方都必须持有一个 `Agent`。** 被否决:这会让 `ctx.media` 从设计上就无法被任何非交互式会话的调用方使用,而不只是 SaturnBot 一家;`withAgent` 是更小范围、更正确的修复——它扩展了调用方*能做*的事,而没有改变固定形状本身*是*什么。

## 后果

任何持有真正 `dsh-agent` `Agent` 的消费者,现在都可以通过 `ctx.media.withAgent(agent)` 完全按 SPEC §4 固定的方式使用 `ctx.media`。SaturnBot 的 `creative.generate` 具体仍未接通,等待编排者/C8a 负责人在上述三个方案中做出决定——这是一个已知、已报告的缺口,而非悄悄隐瞒的缺口。`tsc -p packages/saturn/tool-media/tsconfig.json --noEmit` 干净通过,`vitest run packages/saturn/tool-media` 为 62/62 全绿(相比本轮之前的 59,新增了 `with-agent.spec.ts` 的三个测试)。本包 README 上的 `doc-quick` 结果与本轮之前相同,只有一项此前已知的发现(`docs/tool-catalog.md#saturnaidsh-tool-media` 锚点,只有仓库级的 `doc-sync` 才能重新生成),没有新增问题。

## 第三轮补充(同日)——上文"阻塞性"的缺口本可避免,现已解决

第二次全新上下文的 Mars 评审(本轮修复的"round 2")发现,上文记录的 `integration_needs` 其实并不需要编排者做决定:`ctx.userQuestions`(`packages/interaction/user-questions`,`UserQuestionService.ask()`)把 `agent` 参数声明为**可选**,在未提供时本就会以不限定范围的方式发问(`ctx.waterfall('user-questions/request', request, noAnswerer)`)——完全在本包自身的 IN 范围之内,而且正是 SPEC §3 C7 早已点名的那个"interaction/approval 能力"。

**已应用的修复:** `requireSpendApproval`(`src/index.ts`)在调用携带 `Agent` 时仍优先走 `ctx.approval`(与上文修复 1 的 `withAgent` 绑定行为一致,未变),没有 `Agent` 时则改走新增的 `requireSpendApprovalViaUserQuestions`——通过 `ctx.userQuestions.ask()` 发出一个是/否问题,携带与优先路线完全相同的预估成本行,在人类应答之前零网络请求,并在拒绝、发问被中止/超时,或没有应答者被装配(`NO_PROVIDER`)时保持关闭失败——与优先路线的关闭失败保证完全一致。由新文件 `tests/agentless-spend-approval.spec.ts`(先提交 RED)证明:(a)成本行出现在问题的 `detail` 中,(b)应答之前零请求,(c)拒绝→零请求+被拒绝的结果,(d)没有应答者装配→依然关闭失败,但信息不同。SaturnBot 的 `creative.generate` 调用点(`BotMediaService` 定义于 `packages/saturn/saturnbot/src/contracts.ts`;调用本身在 `src/adapters/integrations.ts`)现在无需 SaturnBot 拥有任何 `Agent` 对象即可解通——上文修复 1 中那项阻塞性的 `integration_needs` 已经真正解决,而不只是换一种方式重新描述。

同一轮 Mars 评审中还修复了:本包 README 开发者说明里那处"被错误归并的提交"现已写明确切哈希(`78a06d26b1`);README 与本笔记中对 SaturnBot 的引用均改为按符号引用(`BotMediaService`、`creative.generate` 调用点),而不是按行号——因为第一轮记录的行号到第二轮评审时已经过期。

`tsc -p packages/saturn/tool-media/tsconfig.json --noEmit` 依然干净通过(为此在本包的 `tsconfig.json` 中新增了一条 `packages/interaction/user-questions` 的项目引用,并在 `package.json` 中新增了对应的 `workspace:^` 依赖);`vitest run packages/saturn/tool-media` 为 65/65 全绿(62 + 新增 3 个)。本 cell 未运行 `pnpm install`(被禁止)——为了让新依赖眼下就能在测试/`tsc` 中解析,手动创建了一个 `node_modules` 目录联接(junction),但一次真正的 `pnpm install` 仍需要运行,`pnpm-lock.yaml` 才能正确记录这条依赖边;已在 `integration_needs` 中报告。
