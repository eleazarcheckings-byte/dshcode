# Agent Note：1.2.1 发布的收尾清理——媒体工具、会签事件与 doc-quick

Status: implemented

[English](2026-09-15-release-hygiene-1-2-1.md) | 中文

## 问题

1.2.1 发布带来了五个媒体工具（`@saturnai/dsh-tool-media`）和 Agent Teams 的 `merge_teammate` 工具，但生成的目录没有跟上：`gen-tool-catalog.spec.ts` 里已采集工具名的期望列表仍列着 66 个，而启动实际产出 72 个；`gen-config-catalog.ts` 因 `tool-media` 三个提供方里十个未写文档的配置字段而拒绝写出；`gen-cordis-catalog.ts` 因 `model-router` 与 `tool-media` 里八处缺失的 `@returns` 契约而拒绝写出。等这两个生成器都跑通之后，`gen-cordis-catalog.ts` 更深一层的签名类型链接覆盖检查——此前一直被第一个抛出的错误挡住——又暴露出另外 24 处违规：七个 Saturn 包的服务方法引用了生成器 `linkedTypePages`/`typeLinkExemptions` 注册表从未分类过的返回值/参数类型。`scripts/run-gates.ts doc-quick` 有 15 项检查中的 5 项失败，原因跨越一份硬换行的 Agent Note、两份缺少标准 Model Experience 小节的包 README、一个失效的 tool-catalog 锚点、一大批翻译配对积压（`docs/config-catalog.md` 与 `docs/persistence-catalog.md` 早在本次发布之前，就已经在若干与本发布无关的提交中，把中文对照页远远甩在了后面），以及 `claims`/`model-router`/`tool-media`/`skill-premium-output` 四份 README.zh.md 仍停留在不一致的中文小节标题上（摘要/概览/开发者说明/开发说明，而不是标准的概述/开发备注）。

## 决定

在拥有该内容的文件里更新了期望工具名列表与 JSDoc 契约，绝不通过削弱检查来过关：`gen-tool-catalog.spec.ts` 现在按排序列出全部 72 个已采集名称；`tool-media` 三个提供方文件（`gemini.ts`、`openai.ts`、`higgsfield.ts`）里的十个配置字段，以及其周围 `index.ts` 里九个面向 loader 的字段，各补上一行准确描述真实语义与默认值的 JSDoc；`model-router` 的 `externalHarnessesEnabled`/`externalHarnessMounted`，以及 `tool-media` 的 `withAgent`/`generate`/`status`，补齐了陈述行为、失败模式与归属的完整 `@param`/`@returns` 契约。对于类型链接这一层，`scripts/gen-cordis-catalog.ts` 的 `TYPE_LINK_EXEMPTIONS` 新增了 `model-router` 的 `ModelTier`/`TierRoute`/`ExternalHarness`、`tool-media` 的 `BoundMediaService`/`MediaExecContext`/`MediaGenerateRequest`/`MediaJob` 的条目；由于同样无人认领、互不冲突且只是新增，也一并补上了 `agent-team` 的 `MergeTeammateRequest`/`MergeTeammateResult`、`claims` 的 `ClaimCheckRequest`/`ClaimPathConflict`、`design-brain` 的 `DesignBrainStatus`。`remote-access` 的四个未分类类型（`RemoteStatus`、`RemoteMode`、`RemotePairingPayload`、`RemoteEventInput`）则未处理：该包在本次发布中正被另一个单元并发编辑，且不在本单元的分派范围内，因此 `gen-cordis-catalog.ts`/`gen-cordis-api.ts` 会在该包这一项上保持失败，直到其归属单元自行在同一份共享注册表里登记这些类型。

`docs/config-catalog.md` 与 `docs/persistence-catalog.md` 各自积压了远超本次发布范围的一整代未同步内容——新的 `@saturnai/dsh-design-brain`、`dsh-model-router`、`dsh-remote-access`、`dsh-review`、`dsh-saturnbot`、`dsh-skill-premium-output` 配置小节，一个 `agent-team.worktreeRoot` 字段，一个 `mcp-client.connectTimeoutMs` 字段，以及一个 `saturnbot/*` 持久化小节——全都没有同步进 `.zh.md` 一侧。本轮把这些内容悉数翻译并同步（JSON/TS 代码围栏按配对契约逐字节复制，包括让三处围栏的 CRLF 换行符与生成器从 Windows 编写的源文件里原样继承来的一致）；`docs/tool-catalog.zh.md` 补上了并行的 `merge_teammate` 工具与新增的 `@saturnai/dsh-tool-media` 小节。闸门列出的其余每一个不同步配对（`README.md`、八篇 `docs/cordis-tutorial/*` 页面、`packages/boot/app-boot`、`packages/core/system-prompt`、`packages/sandbox/sandbox-policy`、`packages/skill/skill-badge`、`packages/skill/skill-premium-output`）经核实都只是一次早已对称完成的品牌重命名编辑之上的过期一致性记录（逐行比对了同时改动两侧的那次提交），因此只用 `--write` 重新记录，而不是重新翻译。`packages/client/ui-brand-official/README.zh.md` 与 `packages/experimental/webworker-runtime/README.zh.md` 各有一句确实未翻译的内容（鱼形标志改为 Saturn 标志的品牌重命名；`global` 别名修复），做了真正的翻译。`claims`、`model-router`、`tool-media`、`skill-premium-output` 的 README.zh.md 被统一到 `doc-standard.spec.ts` 要求的标准概述/开发备注骨架标题上；`model-router` 的 README.zh.md 此前把每个顶层标题都整个留在英文，现已完整译出。`apps/mobile/ios/App/CapApp-SPM/README.md`——一个 Capacitor 自身工具在每次原生同步时都会重新生成的文件——被加入 `scripts/translation-pairing.manifest.json` 的 `excluded` 列表，并记入 `docs/i18n/README.md` 的排除说明，而不是配一份下次 `pod install` 就会立刻过期的翻译；该排除项只精确指向这一个文件，而不是整个 `apps/mobile/**`，因为顶层的 `apps/mobile/README.md` 是一个真实、持续维护的双语页面。

原始任务只点名了一份需要合并硬换行的 Agent Note，但闸门额外发现的五份硬换行文件与一份包 README（`2026-09-15-saturnai-tools-front`、`2026-09-15-model-router-mars-r2-fixes`、`2026-09-15-tool-media-mars-fix-round`、`packages/client/ui-primitives/README`）也用同样方式合并成每段一个物理行——它们都是已提交、与任何并发单元无关的内容，既然合并工具已经为必修的那一份写好，顺手修完不额外费成本。`2026-09-15-peak-lamp-top-rail.*` 与 `2026-09-15-apps-mobile-replay-endpoint.*` 则保持原样：两者都是 `ui-conversation` 与 `apps/mobile` 两个单元今天仍在进行中的工作产物，而本单元被明确告知绝不能碰这两个路径。

## 考虑过的替代方案

**也把 `remote-access` 的四个类型分类掉，让 `gen-cordis-catalog`/`gen-cordis-api` 完全转绿。** 已否决：`packages/saturn/remote-access/**` 被明确列为本单元的禁区，因为另一个单元正在同一份共享工作树里并发编辑它；替它的类型猜测文档归属，有可能与该包自己的单元将要写入同一份共享 `TYPE_LINK_EXEMPTIONS` 表的条目相冲突。

**把 `docs/config-catalog.md`/`docs/persistence-catalog.md` 积压的全部内容从头重新翻译。** 已否决：这批积压大多是对称的、本就正确的品牌重命名或行号变动；配对契约自身的最小补丁原则（`docs/i18n/README.md`）要求针对差异打补丁，而不是整份重译。

## 后果

`gen-tool-catalog.ts`、`gen-config-catalog.ts`、`gen-client-catalog.ts`、`gen-persistence-catalog.ts` 全部干净写出；`gen-cordis-catalog.ts`/`gen-cordis-api.ts` 仅因 `remote-access` 的四个未分类类型而继续拒绝，这归属于该包自己的单元。`scripts/run-gates.ts doc-quick` 报告 15 项中 13 项通过；剩下两项失败——`packages/client/ui-sidebar/README.zh.md`（翻译配对）与 `2026-09-15-peak-lamp-top-rail.*`/`2026-09-15-apps-mobile-replay-endpoint.*`（markdown 换行）——无一例外都落在本单元被告知绝不能碰的路径之内，且本次会话中都正被各自的归属单元持续编写。对 `packages/saturn/tool-media`、`packages/saturn/model-router` 以及 `packages/core/tools/tests/gen-tool-catalog.spec.ts` 运行 `node_modules/.bin/vitest run` 全部通过（95 个测试）；`model-router` 与 `tool-media` 的 `tsc --noEmit` 均干净。在与多个兄弟单元共享同一份 git 工作树中作业，重现了此前 `2026-09-15-saturn-hygiene-docs-sweep` 记录过的隐患：本单元对 `tool-media` 与 `model-router` `src/` 下的部分源码编辑，在本单元走到自己的提交步骤之前，就被卷入了无关兄弟单元的提交，而不是落进本笔记随附的两次提交中的任何一次。内容本身无论落在哪次提交里都是正确且持久的，只是审计轨迹不够干净。
