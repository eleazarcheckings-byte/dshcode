# Agent Note：对话记录打磨——正文测量宽度、代码块换行策略、动效令牌、动词优先的工具标题、光环倾角

状态：已实现

[English](2026-09-15-transcript-polish.md) | 中文

## 问题

`recon/desktop-ux-audit.md` 将此前四份 2026-09-14 的文档与本次会话时的代码逐条核对，发现七项带 file:line 证据的具体缺陷中，五项在整整一天、37 次提交之后仍未修复——对话记录本身（「一个纯粹的深色聊天日志——看起来像任何一款 AI 编程 CLI 的网页视图」）承载着杠杆最高的发现：正文测量宽度不受限（每行 77–110 个字符，中位数约 100）、代码块在编程工具里逐词换行、14 种随意设定的动效时长且没有命名体系、工具行标题是裸名词（「Bash」「Read」，而非经过推敲的动词）、一处仍在生效的 `Inter` 字体族兜底（设计法则自身明确列为禁用的字体），以及两条渲染路径把标志性的光环绘制成两个不同的倾角（-18° 对 ≈-14.3°）。

## 决定

六项相互独立的修复，各自配有验收测试：

1. **正文测量宽度。** `ConversationRoot.module.css` 的 `.root` 声明 `--dsh-chat-prose-measure: 70ch`，这是一条刻意与既有 `--dsh-chat-content-width`（继续负责外层列宽、composer 与工具卡片的尺寸）分开的新轴。`MarkdownText.module.css` 将其应用到 `.markdown :where(p, li, blockquote, h1..h6)`——只作用于纯文本流元素，而非 `.markdown` 容器本身，因为块级子元素永远无法比其父级的包含块更宽：若限制容器本身，代码块与表格也会被一并压窄。直接定位到这些元素本身，就无需再列一份显式豁免清单。
2. **代码块换行策略。** `CodeBlock.module.css` 的 `.block :where(pre)` 把 `white-space: pre-wrap; word-break: break-all` 改为 `white-space: pre`（保留既有的 `overflow-x: auto`），与它此前相互矛盾的同级组件 `TerminalBlock`/`DiffBlock`/`ReadBlock`/`SearchBlock` 保持一致。`CodeBlock.tsx` 中并不存在需要移除的内联 `word-break` 覆盖（SPEC 预期存在一处，但本次未发现)。
3. **动效令牌。** `ui-theme/src/styles/base.css` 的 `:root` 声明 `--saturn-dur-1/2/3`（120/200/320ms）与 `--saturn-ease-standard/out/exit`，与 `ui-skin-saturn` 在其调色板作用域内拥有的既有单值 `--saturn-duration`/`--saturn-ease` 对并存（而非取代）。目前已有十处调用点采用它们：五处是真正的迁移（`.markdown a` 的聚焦环过渡，以及 `ToolRow.module.css` 与 `bash-sample.module.css` 中四处此前硬编码为 `100ms ease` 的 `opacity` 悬停/显隐过渡）；五处是与真实、既有状态变化绑定的新增、范围克制的补充——新增的逐行时长的入场动效（「回执抵达」的动效节拍，`ToolRow.module.css` 与 `bash-sample.module.css` 均有）、文件路径链接的悬停变色，以及队列编辑框的聚焦边框色过渡和其操作按钮的悬停/禁用过渡。两处长时的环境态扫光循环（`dsh-tool-row-sweep`/`dsh-bash-row-sweep`，2.6 秒）保持不变——这是另一类动效（持续性的环境动画，而非离散的命名令牌过渡），令牌体系本就不打算覆盖它们。
4. **动词优先的工具标题 + 时长。** `toolRowModel` 现在会依据行的状态（`running` 与已结算）从一组 `{running, done}` 键对中解析标题键，范围刻意限定于审计点名的三个工具：Bash（「执行中…」/「已执行」）、Read（「读取文件中…」/「已读取文件」）、Grep（「搜索中…」/「已搜索」，在 `SearchRow` 中处理，因为 grep 本就拥有按工具名覆盖的标题）。其余每个变体（write/edit/code/glob/pwsh/cordis 生命周期动词）都保留其现有的单一标签不变——这是刻意的范围决定，而非疏漏；见「与 SPEC 的偏差」。`ToolRowModel` 还新增了 `durationMs`（`time - callTime`，运行中或配对调用落在已加载窗口之外时为 null），每个 `ToolRow`/`BashRow` 调用点现在都会传入它；`ToolRow` 将其渲染为标题与摘要分隔符之间的一份已结算回执，风格上呼应消息页脚的「用时 Xs」，并配有自己的短促入场动画（见第 3 点）。
5. **失效的 `Inter` 兜底。** `QueueDock.module.css` 中两处 `font-family: Inter, var(--dsw-font-family)` 改为 `font-family: var(--dsw-font-family)`——一处已确认的 `ai-slop` 命中，设计法则自身明确禁用的字体，之所以此前无害，只是因为 `packages/client` 中没有任何为它准备的 `@font-face`。
6. **光环倾角。** `orbital-field.ts` 的实时画布现在以一个命名常量 `RING_TILT_RADIANS = -18°` 旋转（此前是裸魔数 `-0.25` 弧度，约 -14.3°），`OrbitalCanvas.tsx` 的静态 SVG 兜底（本就是 -18°）也添加了明确说明这一点的注释。按 SPEC §2 的要求，处处只用一个倾角值。

## 与 SPEC 文字的偏差（明确声明，非静默偏离）

- **动词优先的范围。** SPEC §3 C2 与审计报告都只给出了三个具体范例（Bash/Read/Grep）；其余每个工具行变体都保留了现有单一标签，而不是为 SPEC 从未给出文案的部分自行发明现在时/过去时表述。将其扩展到 write/edit/code/glob/pwsh/webSearch/webFetch 是自然的后续工作，但不在本次会话审阅过的范围内——见「已知后续」。
- **时长不止出现在被重新命名的三个工具上。** 逐行时长是通用的（任何带 `callTime` 的已结算调用都会显示），包括待办/提问行以及 cordis 生命周期动作——比三个点名的范例更宽，但这直接服务于审计报告自身「状态点旁的逐行时长」这句原话，而不做按变体的例外划分；为此更新了若干既有基线测试中拼接文本的断言（见「测试」）。
- **`AssistantMarkdown.module.css` 并不存在 `.markdown` 规则。** SPEC §3 C2 指名正文测量宽度上限应落在 `AssistantMarkdown.module.css` 的 `.markdown` 规则里；该规则在那里并不存在——真正的 markdown 正文根类（由 `MarkdownText` 渲染，位于本 cell IN 范围内的 `ui-primitives/src/markdown/**`）才是 `.markdown` 的定义处，也是助手渲染正文实际所在之处。因此改在那里应用；`AssistantMarkdown.module.css` 本身无需改动。
- **既有基线测试的更新。** `packages/client/ui-tool/tests/**` 完整位于本 cell 的 IN 范围内，因此少数硬编码了旧裸名词标题（且都没有考虑新增时长文本）的既有断言，在功能实现之后的一个独立 `fix(saturn):` 提交中一并更新——从未触碰本 cell 自己新写的 RED 测试文件。清单见「测试」。

## 考虑过的替代方案

**限制 `.markdown` 自身的 `max-width`，并为 `pre`/表格添加显式突破（代码库已用于宽表格的 `md-table-wide` 模式）。** 已否决：突破手法（负外边距 + 宽度计算）之所以存在，是因为那条具体规则需要突破更窄的祖先容器。而这里只需完全不限制祖先容器、只限制纯文本流子元素，就能以更简单的方式得到相同的可见结果，无需维护负外边距的算式。

**一次性为每个已分类的工具变体都配上现在时/过去时。** 本轮已否决：SPEC 与审计报告只为三个工具给出了确切文案；为其余部分自行创造无人审阅过的文案存在风险。已标记为后续工作。

## 测试

新增、先提交为 RED 再实现：`packages/client/ui-primitives/tests/{markdown-prose-measure,code-fence-wrap-policy}.client.spec.ts`、`packages/client/ui-conversation/tests/{conversation-root-prose-measure,orbital-ring-tilt}.client.spec.tsx`、`packages/client/ui-theme/tests/{motion-tokens,no-inter-font}.client.spec.ts`、`packages/client/ui-tool/tests/{tool-row-duration,tool-title-tense}.client.spec.tsx`——共 25 个测试，已确认在未修改的基线代码上失败（完整 RED 输出保留在 cell 报告中），实现后全部转绿。`packages/client/ui-tool/tests/{chat-code-subcalls,coverage-tails,read-card,search-card,tool-row,toolview-slot}.client.spec.tsx` 需要更新既有断言以适配新标题/时长文本（RED 阶段未触碰，在后续的 `fix(saturn):` 提交中更新）。完整测试套件均为绿色：`ui-tool` 295/295、`ui-primitives` 574/574、`ui-conversation` 416/416、`ui-theme` 94/95（1 个既有、与本改动无关、属于某同级 cell 在制品 `ui-saturnbot` 文件的失败）、`ui-chat` 346/346（1 个偶发、与本改动无关的 shiki 模块解析失败，单独运行时通过）。`tsc -p <pkg>/tsconfig.json --noEmit` 对 `ui-tool`、`ui-conversation`、`ui-primitives`、`ui-theme`、`ui-chat` 均干净（需先通过 `tsc -b packages/client/ui-conversation/tsconfig.json` 重建 `ui-conversation` 自身的声明产物，因为 `ui-tool` 是通过项目引用而非源码消费其本地化键类型的）。

## 已知后续

动词优先标题与「十处调用点」的动效令牌普查都刻意采取了克制的范围（见「偏差」）；待有人审阅过其余变体的文案后，扩展二者都是自然的下一步。本次会话的全仓库扫描在 `packages/client/ui-saturnbot/src/client/Dashboard.module.css` 中发现的圆角配对缺口属于某个同级 cell，已在此报告，未在此修复。
