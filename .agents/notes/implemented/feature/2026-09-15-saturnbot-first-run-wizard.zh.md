# Agent Note：SaturnBot 首次运行引导、生成式连接表单与状态提示条

状态：已实现

[English](2026-09-15-saturnbot-first-run-wizard.md) | 中文

## 问题

`ui-saturnbot` 通往首次运行的唯一路径是原始的 `Configuration` 表单：一次性铺开所有字段的单页，集成配置需要手写 JSON（每个连接一个 `{endpoint, credentialEnv, resource}`），且没有任何地方说明当前还缺什么才能运行。recon 审计（`saturnbot-audit.md`）将其列为这个本身真实、经过充分测试的引擎中最大的首次运行摩擦点："`ui-saturnbot` 中没有任何按提供方划分的连接表单，没有 OAuth 流程，没有密钥管理字段，也没有『在此粘贴令牌』式界面。"

## 决定

在 `packages/client/ui-saturnbot/src/client/` 下新增三个文件：

- `StatusStrip.tsx` —— 纯函数 `computeSetupGaps(snapshot, t)` 读取决定能否运行的四项事实（工作区、目标、提供方、模型），加上 Host 报告的任何未解析凭据；`StatusStrip` 组件要么渲染具体清单，要么明确说明「已就绪」。绝不猜测健康状况或连通性——只使用 SaturnBot 自身已经跟踪的字段。
- `ConnectForms.tsx` —— `IntegrationConnectForms` 为 `snapshot.integrationCatalog` 中的每一项生成一份表单。非密钥字段（`resource`、`endpoint`）是普通文本输入；密钥字段（`credentialEnv`）永远不携带可编辑的值——只展示所需的确切环境变量名，附带复制操作和 `.env` 路径提示，因为运行时是从环境变量解析凭据，而不是从此界面输入的值。`safeParseIntegrations` 用于读取现有 JSON 草稿以供展示，不会因为中间态的畸形编辑而抛出异常。
- `Wizard.tsx` —— `FirstRunWizard` 走完五个步骤（目标、工作区、模型、连接、计划），通过 `resumeWizardStep` 从 `snapshot.firstRun`（或显式传入的 `initialStep`）恢复进度。每次「继续」只保存该步骤对应字段（通过已有的 `configure` 命令），因此中途关闭也不会丢失进度；「跳过」以及各步骤标签都不会丢弃未保存的草稿。

`Configuration.tsx` 中原来的集成 JSON 文本框被替换为 `IntegrationConnectForms`，两者共享同一份 JSON 文本状态作为唯一数据源，并保留一个嵌套的「高级 JSON」折叠面板以便直接访问原始编辑器。`Dashboard.tsx` 在 `snapshot.status === 'needs-setup'` 时自动展示引导流程，同时提供双向手动切换（`wizard.restart` / `wizard.skip`），状态提示条中的每一项缺口都可直接跳转到能解决它的步骤。

## 本地类型，先于 C8a 落地

SPEC §3 的 C8a（一个并行构建的同级 cell）会为 SaturnBot 快照添加 `firstRun: { goal, workspace, provider, credentials: [{ name, env, present }] }` 与 `integrationCatalog: [{ name, label, fields: [{ key, label, secret, env }], docsUrl }]`。本包在 C8a 所属的运行时包必然落地这两个字段之前，就已经针对这份文档化的约定进行了编码：`contracts.ts` 定义了本地放宽类型 `SaturnBotSnapshot = BotSnapshot & { firstRun?; integrationCatalog? }`，两个成员均为可选。本包中的每一个读取点（引导流程的 `resumeWizardStep`、状态提示条的凭据检查、连接表单）在字段缺失时都会回退到引导设置之前的行为——因此无论两个包以何种顺序合并都能正确组合，任何字段形状上的偏差由编排者在集成阶段协调，而不是由本包去猜测一个尚未发布的约定。

## 与 SPEC 文字的偏差（明确声明，非静默偏离）

- **`envPath`** —— SPEC 文档化的 `firstRun` 约定并未命名一个字段来表示已解析凭据的值应粘贴到的确切 `.env` 路径，但验收文字明确写的是「展示环境变量名以及应粘贴到的 `.env` 路径」。因此在本地类型中新增了 `firstRun.envPath?: string`；当快照缺失该字段时，连接表单回退为通用提示文案（`connect.envPathFallback`）。已在 `integration_needs` 中标出，供 C8a／编排者决定采用该字段名，或提供路径的其他来源。
- **提供方／模型选择器** —— 「provider/model from the harness model directory」无法做到实时对接：主机现有的唯一模型选择服务（`ui-model-selection` 的 `ModelDirectory`）是按聊天会话作用域的，而接入它（或并行构建、且不在本 cell IN 范围内的 C6 `model-router`）意味着一个功能插件直接引用另一个功能插件的值，这正是 Client 技术栈在插槽／注入服务之外明确禁止的做法。模型步骤因此保留了现有的自由文本提供方／模型输入框，只是加上了一个静态、无需密钥的 `<datalist>` 快捷选项（与 SPEC §3 C6 自身默认档案列表所列的一致）——绝非实时查询，也绝不会阻挡未列出的提供方。
- **工作区选择器** —— 「workspace via the host directory picker」由已有的 `workspaces` 属性（主机自身的工作区列表，在本次改动之前就已经提供给 `Configuration`）承担；未新增单独的原生文件系统对话框。
- **集成字段键保持固定** —— 生成的表单只会写入 `endpoint` / `credentialEnv` / `resource`，与 `BotConfig['integrations']` 现有的固定记录结构、以及 `Configuration.tsx` 中已经过测试的 `parseAdvanced` 校验（对任何其他键都会抛出异常）保持一致。将该记录扩展为可容纳 C8a 新增 telegram／shopify 适配器的任意字段名，留给 C8a 处理；本地类型 `SaturnBotIntegrationFieldKey` 明确记录了这一假设。

## 考虑过的替代方案

**用一次性的「首次运行」标志代替 `snapshot.status` 来控制引导流程的展示。** 已否决：`needs-setup` 本身就是 Host 对「必需配置缺失」这一事实的权威声明，重新推导一个仅存在于客户端的并行标志只会与其产生分歧。手动切换（`wizard.restart`／`wizard.skip`）已经覆盖了操作者希望无视当前状态、强制显示某一界面的场景。

**在每次按键时都将原始 JSON 文本框实时解析进生成表单的字段。** 已否决为不必要的复杂度：JSON 文本已经是唯一数据源（`Configuration.tsx` 中的既有模式），`safeParseIntegrations` 仅用于读取以供展示，就能让生成表单与「高级 JSON」折叠面板保持同步，无需再维护第二份需要协调的状态。

## 测试

新增：`tests/status-strip.client.spec.tsx`、`tests/connect-forms.client.spec.tsx`、`tests/wizard.client.spec.tsx`（整包共 46 个测试，较 28 个测试的基线有所增加）。已确认在实现落地前处于 RED 状态（`Failed to resolve import "../src/client/{Wizard,ConnectForms,StatusStrip}.tsx"`），实现后转为全绿。`tsc -p packages/client/ui-saturnbot --noEmit` 干净。`verify-client-ui-i18n`、`verify-translation-pairing`、`verify-package-readme-limitations`、`verify-package-readme-model-experience`、`verify-md-wrap`、`verify-md-links` 以及 `doc-standard.spec.ts` 针对本包文件均干净（全仓库范围的 `doc-quick` 会暴露其他同级 cell 正在进行中的包里的无关失败，已在报告中列出，未在此处修复）。

## 后续工作

一个真正接入 model-router 的提供方／模型选择器，以及通过 `firstRun` 暴露的真实主机 `.env` 路径，都只比本 cell 自身 IN 范围内能触及的范围多一小步；详见上文「偏差」部分。

## 后果

`Configuration.tsx` 中原始的 JSON 文本框不再是主要的集成配置界面：它现在收纳在一个嵌套的「高级 JSON」折叠面板里，操作者首先看到的是 `IntegrationConnectForms`。连接表单由 `snapshot.integrationCatalog` 生成，而不是逐个提供方手写而成，因此新增一个适配器时，本包无需任何界面改动就能得到一份可用的表单——唯一要存在的只是目录中的那一条记录。密钥字段永远不会把值回显到界面上；它只展示所需环境变量的名称、一个复制操作，以及一条 `.env` 路径提示，因此运行时自身对环境变量的解析，始终是唯一读取凭据值的地方。

`packages/saturn/saturnbot/src/wizard.ts`——本包在 `contracts.ts` 中本地放宽的运行时约定（`SaturnBotSnapshot` 的 `firstRun` 与 `integrationCatalog`）所对应的那份运行时契约——如今是承重的：引导流程的续接行为、状态提示条的缺口检测，以及每一份生成的连接表单，都读取 `snapshot.firstRun`，因此未来若要改动该运行时契约的形状，必须让本包现有的读取点继续优雅降级（就像它们在字段缺失时已经做到的那样），或者在同一次改动中一并更新它们。本地放宽类型是一座桥梁，不是永久的分叉：一旦 C8a 的 `BotSnapshot` 原生携带 `firstRun` 与 `integrationCatalog`，两种形状就需要被协调统一，而不是任由它们继续分道而行。
