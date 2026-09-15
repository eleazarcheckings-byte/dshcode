# 代理笔记：SaturnBot 界面 —— Mars 第一轮复审修复（工作区选择器、不支持的字段、损坏的 JSON）

状态：已实现

[English](2026-09-15-saturnbot-ui-mars-r1-fixes.md) | 中文

## 问题

Mars 对 C8b 的首次复审（`.../scratchpad/review/C8b-saturnbot-ui-r1.md`）针对 `packages/client/ui-saturnbot` 返回了 REVISE，共三项发现：

1. 向导的工作区步骤没有原生目录选择器，尽管 `ctx.uiWorkspace.pickDirectory()`（`packages/client/ui-workspace/src/client/navigation.ts`）正是 AGENTS.md 指定的、用于跨越该边界的可注入 Cordis 服务——`ui-directory-picker-native` 早已采用同样的模式。
2. `ConnectForms.tsx` 会为任意目录字段键渲染一个可编辑的实时文本框，但 `safeParseIntegrations` 只能来回处理 `endpoint`／`credentialEnv`／`resource` 三个键：目录条目一旦命名了其他键（例如未来 telegram 适配器的 `chatId`），生成的输入框每次保存都会被静默丢弃。
3. `Configuration.tsx` 直接把 `safeParseIntegrations(integrations)`（解析失败时会退化为 `{}`）传给生成表单的 `values`；随后第一次字段编辑就会调用 `setIntegrations(JSON.stringify(next))`，从而永久覆盖用户实际在高级 JSON 文本框中输入的内容。

## 决定

- **工作区选择器。** `mount.ts` 现在与 `remote`／`slots`／`locale` 一起注入 `uiWorkspace`，并在 `SaturnBotInjected` 上暴露 `pickDirectory: () => ctx.uiWorkspace.pickDirectory()`。以普通回调 prop 的形式经 `Entry.tsx` → `Dashboard.tsx` → `FirstRunWizard` 逐层传递。工作区步骤保留原有的下拉选择与自由输入框，并在输入框旁新增一个"浏览…"按钮：解析出非空路径即写入该字段；返回 `null`（取消）或 Promise 被拒绝（没有可用的原生选择器，例如纯浏览器构建）都保留手动路径不变，且绝不抛出异常。
- **不支持的目录字段键。** `contracts.ts` 中 `SaturnBotIntegrationField.key` 从固定的三值联合类型放宽为 `string`（SPEC §4 中 C8a 的契约对此没有任何限制；该联合类型仍以 `SaturnBotIntegrationFieldKey` 导出，表示运行时实际接纳的键）。`ConnectForms.tsx` 新增 `isSupportedFieldKey`，对不在该集合内的字段渲染一个禁用的提示（`connect.fieldUnsupported`），而不是一个会静默丢弃自身编辑的实时输入框。
- **损坏的高级 JSON。** `ConnectForms.tsx` 新增 `parseIntegrationsResult`，用于区分"确实无法解析的草稿"（JSON 语法错误，或顶层值不是普通对象）与"格式良好、只是丢弃了某个无法识别字段或形状的对象"——后者维持 `safeParseIntegrations` 既有且已被测试覆盖的静默过滤行为。`IntegrationConnectForms` 新增 `disabled` 属性；`Configuration.tsx` 与 `Wizard.tsx` 都只计算一次 `parseIntegrationsResult(integrations)`，在其为 `ok: false` 时禁用全部生成的输入框并显示 `connect.fixJsonFirst` 提示，绝不再让某次字段编辑把用户的损坏草稿折叠成 `{}`。

## 与修复清单的偏差（明确声明，非默默处理）

- **`Configuration.tsx` 的工作区字段未添加"浏览"按钮。** Mars 的发现与 SPEC §3 C8b 自身的验收措辞（"通过主机目录选择器选择工作区"）都特指**向导**的工作区步骤；`Configuration.tsx` 是通过"跳到高级配置"／"重新运行引导设置"到达的另一个高级配置界面。在那里也加上选择器是合理的后续工作，但既非该 SPEC 语句也非本次修复所要求，因此保持不动，使本轮的改动范围限定在三项被点名的发现上。
- **`Wizard.tsx` 中的损坏 JSON 防护目前不可达。** 向导的连接步骤从未暴露过原始 JSON 文本框（只有 `Configuration.tsx` 有），因此加入 `Wizard.tsx` 的 `parseIntegrationsResult`／`disabled` 接线目前无法通过现有界面真正走到 `ok: false`。仍然照做，以匹配 Mars 修复指示中"Wizard.tsx 中的相同模式"这一要求，并保持两处调用点对称，为向导未来可能出现的原始编辑界面做好准备。
- **顺手修复了在这些文件中发现的 README doc-quick 缺口：** `README.md` 缺少必需的 `## Table of Contents` 标题，`README.zh.md` 缺少 `## 目录`，且原用 `### 开发说明` 而检查要求的是 `### 开发备注`——这三处都早于本轮修复存在（与 Mars 的三项发现无关），但既然为了下面的选择器／已知限制更新而打开了这些文件，就顺带做了这些一行级别的机械修正。未处理：`packages/client/ui-saturnbot/README.md: must contain one or more complete model-context entries`（把"模型体验"章节改写成仓库要求的结构化 model-context-entry 格式是一项与本轮无关、规模大得多的独立文档工作，超出本轮范围），以及英文／中文 README 配对之间的一处链接片段措辞提示（`#summary` 对 `#概述`）——这与其他包的 README 配对早已存在的情况相同。

## 考虑过的替代方案

**将 `SaturnBotInjected`／`DashboardProps` 上的 `pickDirectory` 设为可选，而非必填**，这样现有基于 fixture 的测试就不需要补一个桩值。已否决：既然 `uiWorkspace` 现在总会被注入，`mount.ts` 也总能提供真实实现，可选签名只会让未来某个调用方忘记传它；对现有 `dashboard.client.spec.tsx` 渲染调用的机械式补参改动每处只需一行。

**把 `safeParseIntegrations` 退化为 `{}` 本身当作"草稿已损坏"的信号，而不是新增 `parseIntegrationsResult`。** 已否决：`safeParseIntegrations` 本就有意为"格式良好但丢弃了某个无法识别字段"的 JSON 也返回裁剪过的 `{}`——这是一个已被测试覆盖、蓄意为之的接纳过滤器（`tests/connect-forms.client.spec.tsx` 中"drops an unrecognized field"一例）。若复用同一个信号同时表示"应阻止编辑"，要么会破坏这一既有行为，要么得用两种方式重复解析同一段文本；用一个独立的 `ok`／`value` 结果类型可以让两种含义保持独立，也能分别单独测试。

**对不支持的字段直接从生成表单中静默剔除**，而不是渲染一条禁用提示。已否决：SPEC 本身对连接表单的验收要求是绝不静默丢弃运行时目录所发布的内容；一个凭空消失、毫无解释的字段，比一个明确说明"尚不支持"的字段体验更差。

## 后果

**代价：** 多注入了一个 Cordis 服务（`uiWorkspace`），并新增了一个必须经三层组件（`Entry.tsx` → `Dashboard.tsx` → `Wizard.tsx`）传递的必填 prop，外加对 `dashboard.client.spec.tsx` 中七处现有 `<Dashboard>` 渲染调用的机械式更新。`SaturnBotIntegrationField.key` 从三值联合类型放宽为 `string`，意味着每个使用方都必须用 `isSupportedFieldKey` 重新核实，而不能再信任类型本身；`ConnectForms.tsx` 生成字段的 `.map` 回调也从一个双向三元表达式变成了显式的三分支提前返回结构，以便在输入框 `onChange` 闭包内保持 TypeScript 控制流窄化有效。

**收获：** 工作区步骤现在能接入与主应用其他工作区选择界面相同的主机文件系统对话框，而不再是唯一一个要求操作者手动输入或粘贴路径的地方。运行时尚无法处理的目录字段如今会明显地显示为不可用，而不是悄悄吞掉按键输入。用户在编辑一份损坏的高级 JSON 草稿时，不会再因为点击了某个无关的生成字段而丢失这份工作——生成表单会直接拒绝触碰一份自己无法解析的草稿，直至它重新可解析为止。

## 测试

新增：`tests/fix-round.client.spec.tsx`（10 个测试：工作区选择器的三种结果——选中路径被保存、取消选择、选择器被拒绝；`parseIntegrationsResult` 的 ok／非 ok 区分；不支持字段键的渲染及其在草稿无效期间的禁用状态；`Configuration` 对损坏草稿的阻断及草稿再次可解析后的重新启用）。更新了 `tests/dashboard.client.spec.tsx`，为其现有的七处 `<Dashboard>` 渲染调用补上现在必填的 `pickDirectory` 属性——纯粹是签名层面的机械更新，未改动任何断言。

先确认了真实的 RED：对本单元这 10 个文件执行路径限定的 `git stash push -- <files>`，将实现代码还原到修复前（Mars 第一轮）的提交状态，同时不触碰任何兄弟单元并发进行中的未提交改动；随后对 `packages/client/ui-saturnbot/tests/fix-round.client.spec.tsx` 运行 `vitest`，10 个新测试中有 9 个在该基线下失败（第 10 个——编辑一个本就受支持的字段——在两种状态下都应通过，它是回归防护而非新行为测试，符合预期）。`git stash pop` 恢复修复实现后，整个包的测试套件转绿。

命令与逐字输出见 `report_path` 指向的完整报告。

## 遗留事项

在 `Configuration.tsx` 自身的工作区字段上加选择器，以及在向导未来（如果）获得原始 JSON 界面后，让 `Wizard.tsx` 中目前不可达的损坏 JSON 分支真正生效，都是超出本轮三项被点名发现之外、但触手可及的下一步；见上文"偏差"一节。README 中"model-context entries"这一预先存在的缺口（见"偏差"一节）同样留待专门的文档整理工作处理。
