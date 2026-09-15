# 开发说明：Saturn hygiene-docs cell 作用域内的 doc-quick 卫生清理

状态：已实现

[English](2026-09-15-saturn-hygiene-docs-sweep.md) | 中文

## 问题

2026-09-15 Saturn 扇出的侦察报告（`harness-audit.md`）发现仓库自身的文档门禁阶梯（`scripts/run-gates.ts doc-quick`）15 项检查中有 6 项失败，几乎全部针对新的 Saturn 包：缺少 `## Known Limitations and Deferred Work` 和 `## Model Experience` 小节、标题顺序不规范、缺少 YAML frontmatter、一个失效的跨语言锚点，以及 `packages/README.md` 顶层地图中没有 `@saturnai` 分组条目。`ui-orchestrate` 完全没有 README，`ui-brand-saturn`/`ui-orchestrate` 也没有证明其 slot 注册能在 HMR 下存活的单元测试。

## 决定

此 cell 拥有的每个 README（`packages/saturn/checkpoints`、`packages/saturn/design-brain`（仅修复 zh 锚点与开发备注标题）、`packages/client/ui-fleet`、`packages/client/ui-agent-team`、`packages/client/ui-brand-saturn`、新建的 `packages/client/ui-orchestrate`，以及顶层的 `packages/README.md`）现在都具备规范的概述/目录/开发备注骨架、YAML frontmatter（`kind`、`description`）、`## Model Experience` 小节（完整的三字段结构化形式，或在已被审计的情况下使用短句形式），以及作为最后一个 H2 的 `## Known Limitations and Deferred Work`（Model Experience 是倒数第二个）。新增了 `packages/saturn/README.md`（+ 中文版）分组页面并链接自顶层地图——因为"把 saturn 组加入地图"意味着一个真实的目标，而不是一个失效链接；其中此 cell 不拥有的两行（`claims`、`done`、`orchestrate`）改为纯文本而非链接，因为这些包自己的 README.zh.md 姊妹文件仍是其他 cell 正在进行中的交付物。

新增两个浏览器插件测试文件（`ui-brand-saturn/tests/browser-plugin.client.spec.tsx`、`ui-orchestrate/tests/browser-plugin.client.spec.tsx`），证明：这些 slot 具有声明感知能力（无论 hole 是在 `apply` 之前还是之后声明都会填充），并且 HMR 契约的两端都成立——处置声明方 slot 的 fiber 会清空占用者，处置本插件自身的 fiber 也一样，重新声明时不会产生重复注册。`ui-orchestrate` 的测试还额外证明了 `/orchestrate on|off` 命令派发及其 RPC 失败/未匹配准入的折叠行为，仿照现有的 `ui-plan` 和 `ui-goal` 测试模式。

## 考虑过的替代方案

- **把 `ui-agent-team`、`ui-fleet`、`ui-brand-saturn`、`checkpoints` 注册进 `SENTENCE_MODEL_EXPERIENCE`/`NO_LIMITATIONS`**（`scripts/verify-package-readme-model-experience.ts` 中的短句允许清单）——已否决：这些脚本位于此 cell 的 IN 作用域之外（SPEC §3 C1 未列出 `scripts/**`），因此每个包改为携带完整的结构化 Model Experience 形式（对于 `ui-agent-team`，则使用其允许清单条目已支持的短句形式）。
- **把 `packages/saturn/README.zh.md` 的 `claims`/`done`/`orchestrate` 行链接到它们的 `README.zh.md`**——已否决：这些文件尚不存在（由 C4/C5 拥有），链接到不存在的目标会导致 `verify-md-links` 失败；英文页面对这三行也同样去掉链接，使两种语言页面在结构上保持一致，以通过翻译配对门禁。

## 后果

- `doc-quick`（markdown 链接、翻译配对、markdown 换行、包 README 限制、包 README 模型体验，以及 `doc-standard.spec.ts` vitest 套件）在此 cell 拥有的每个文件上都通过；编排者会看到的其余 `doc-quick` 失败属于仍在进行中的兄弟 cell 的包（`ui-done`、`ui-skin-saturn`、`ui-saturnbot`、`claims`、`done`、`orchestrate`、`saturnbot`、`skill-premium-output`、`model-router`、`review`、`tool-media`），以及在此次扇出之前就已存在的、与 Saturn 无关的翻译漂移（`README.md`、`docs/cordis-tutorial/**`，以及若干更早的包）。
- 在全部 16 个指定的 Saturn 包（8 个 `packages/saturn/*` + 7 个 `packages/client/ui-*` + `skill-premium-output`）上，`tsc -p <pkg>/tsconfig.json --noEmit` 全部干净通过。
- 一次全仓库 `knip` 运行发现两项超出此 cell 作用域的条目：`packages/saturn/agent-team/tests/built-lib.e2e.ts` 被标记为未使用（归 C5 所有），以及 `@deepseek-ai/dsh-client-ui-slots` 被标记为 `ui-brand-saturn` 的未使用 devDependency（此前已存在，很可能是 `knip` 静态分析无法看到的纯类型增强依赖——为避免破坏类型合并而保留不动）。`knip.json` 默认的 `packages/*/*` entry 模式（`tests/**/*.spec.ts`）不匹配新增的 `.spec.tsx` 测试；`ui-brand-saturn` 与 `ui-orchestrate` 加入了一份已有同样缺口的包列表（`ui-brand-official`、`ui-done`、`ui-approval`、`ui-settings-plugin-inventory`、`util/values`）——修复 `knip.json` 超出此 cell 能触及的范围（明确禁止编辑），已转交编排者处理。
- 与十二个兄弟 cell 共用同一个 git 工作树，暴露出一个真实的隐患：正在进行中的兄弟 cell 自身的 `git add`/pre-commit 流程，可能会把此 cell 已暂存但尚未提交的文件一并卷入其自己的提交（观察到的现象：此 cell 的 README 修复最终落入了另一个 cell 的 `feat(saturn): add the visual review loop …` 提交，而不是此 cell 自己的提交）。内容本身无论如何都是正确且持久的；只是审计轨迹不够干净。这正是 SPEC §3 C5（worktree 隔离）本应解决的隐患。
