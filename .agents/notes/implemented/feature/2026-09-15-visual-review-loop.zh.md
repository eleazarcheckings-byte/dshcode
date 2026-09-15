# 开发笔记：移交前的确定性可视化评审循环

Status: implemented

[English](2026-09-15-visual-review-loop.md) | 中文

## 问题

`skill-premium-output` 要求 agent 检查渲染结果，并认为独立评审对小型工作是"可选的"，但没有指定任何评分标准、脚本，或必须真正派遣评审者的具体时机。设计方向步骤仅以对话文字存在，后续会话或评审者都没有可依据的持久化内容。指南中从未提到 design brain 的 `SATURN-DESIGN-RULES.md` 上线前检查清单，也没有任何内置工具可以依据该清单确定性地为页面评分——每一次"这是不是同质化 AI 产出"的判断都完全依赖构建该页面的同一个上下文。

## 决策

新增 `scripts/review-grade.mjs`：一个基于静态 DOM（`jsdom`）的探针，对已渲染的 HTML 文件按照 `scripts/harness/SATURN-DESIGN-RULES.md` 的全部十二项上线前检查清单评分，写出符合新增 `rubric.schema.json` 的 `rubric.json`。它移植了若干探针——渐变/色相痕迹、卡片同质化统计、批量淡入统计（没有 `animation-timeline` 的滚动揭示类名才是痕迹；同一类名若绑定真实滚动驱动时间线则是技术手段，而非痕迹）、对比度取样，以及预置装饰痕迹——来自 SaturnAI design brain 的浏览器控制台证据收集脚本 `G:/My Drive/Projects/mac/active/izzy-design/collect-evidence.js`（v2），仅作参考读取并在脚本头部注释中注明出处；未修改该文件。四项检查清单条目（品牌测试、唯一命名机制、偏差记录、写者 ≠ 评审者）是任何标记探针都无法判定的主观或流程事实——它们始终返回 `UNVERIFIED` 且评分为 `null`，绝不猜测通过，与本包 `review-web.mjs` 既有的诚实仪器姿态（`visualQualityAssessed: false`）一致。

`policy.ts` 与全部三份 SKILL.md 指南现在都要求在移交重大视觉交付物前派遣新鲜上下文的评审者——一个看不到构建 agent 私有推理过程的独立上下文：依据评分标准为桌面端与 400px 截图评分，并用 `review-grade.mjs` 为渲染后的标记评分。跳过其中任何一步都必须记录为明确偏差，绝不能默默跳过。当 design brain 连接可用时，收集到的证据也会传递给 `mcp__saturnai__review`。各指南现在还要求在实现之前将工作方向保存为 `.saturn/design-plan.md`——一份持久化交付物，而不仅仅是对话文字——并将 CSS 锚点定位与 Popover API 组合列为菜单、工具提示或浮层的默认方案。

## 备选方案

**用真实浏览器（Playwright）驱动该探针，如同 `review-web.mjs`。** 已否决：`review-web.mjs` 已拥有截图环节，并明确不对其捕获内容评分。再引入一个 Playwright 驱动的脚本只会为同一依赖及其 Windows `spawn EPERM` 沙箱限制带来重复，却没有新增能力。`jsdom` 无需浏览器或 canvas 2D 上下文即可解析计算样式（颜色、渐变、字体、圆角、阴影、`animation-timeline`、自定义属性），已覆盖从 `collect-evidence.js` 移植的全部探针；它无法看到布局几何，因此相关检查（渲染后的字符测量、点击目标尺寸）会被报告为未测量，而不是被猜测。

**静态近似阅读测量值（SPEC §3 C9 在移植探针中点名了 `measure`）。** 曾考虑过：标记出既没有在自身、也没有在祖先链上以 `ch`/`ex` 单位声明 `max-width` 的长正文段落——因为 `jsdom` 的 CSSOM 确实会原样保留这些单位（已验证：`65ch` 经过 `getComputedStyle` 会原样返回字符串 `65ch`，而不会被转换成它无法计算的像素值）。本轮推迟未实现：`jsdom` 无法解析某个 `ch`/`ex`/`px` 约束实际产生的*渲染后*字符数，因此该检查至多能证明"祖先链上某处声明了某种宽度约束"，这比"测量值"这一断言弱得多；对 `tests/fixtures/premium.html` 的一次试跑就把它自身收尾小节里那段由网格列宽（而非 `ch` 值）视觉约束的段落误判为命中，若要消除这类误报就必须把启发式放宽到不再可信的程度。判断实际渲染行长度的正确场所仍是 `review-web.mjs` 的真实浏览器截图环节；本包的"已知限制与后续工作"明确点名了这一空白，而不是交付一个靠猜测的探针。

**对全部十二项检查清单条目都进行机械评分。** 已否决：品牌测试、唯一命名机制、偏差记录、写者 ≠ 评审者是任何页面标记都无法判定的主观或流程事实。为它们编造评分正是本包策略在别处已经警告过的"编造已完成检查/验证结果"失败模式。`UNVERIFIED` 且评分为 `null` 才是诚实的做法。

**在代码中强制执行评审步骤（在缺少评审时阻止工具调用或"完成"声明）。** 按设计不在本包范围内——本包拥有由 effect 管理的提示词/技能内容，"没有需要与独立可变状态对账的投影"（见既有的开发说明）。强制执行属于 `@saturnai/dsh-done`/`@saturnai/dsh-review`（SPEC §3 C4）的职责，本包的策略文本通过明确点名该要求，而不是将其隐含在文字之间，为其指明方向。

## 后果

构建重大视觉交付物的 agent 现在拥有一个命名脚本与评分标准，可在声明完成前运行；而任何脚本都无法判断的四项条目会被明确点名，而不是被默默通过。`.saturn/design-plan.md` 让新鲜的评审者（以及后续会话）拥有可依据的持久化内容，用于评判*决策*本身，而不仅仅是*产出物*。本包的 `README.md`/`README.zh.md` 新增"可视化评审循环"一节记录以上内容；"已知限制与后续工作"现在是一份项目符号列表（此前是散文段落），并明确说明这里没有任何机制强制执行该步骤——它与本包其余指导一样，是指令性的。

## 验证

`tests/review-grade.spec.ts` 覆盖了 `parseArgs`、针对新增 `tests/fixtures/premium.html` 的 `gradePage`（每一项机械评分条目均为 PASS）与 `tests/fixtures/slop.html`（每个命名痕迹都被触发且总体判定为 REJECT）、两个夹具上四项主观条目始终返回 `UNVERIFIED`/`null`、"CSS 滚动驱动时间线是技术手段而非痕迹"这一细节，以及 CLI 的退出码（0/1/2）及其写出的 `rubric.json`/`rubric.md`。先提交 RED（模块未找到），随后实现。策略文本变更后重新运行了本包既有的 `skill-premium-output.spec.ts`（含策略文本快照）与 `premium-output.e2e.ts`；快照已重新生成以匹配新文本。

## 修复轮次（Mars 评审，第二轮，REVISE——第三轮修复见下文）

对第一轮修复（将 `review-grade.mjs`/`rubric.schema.json` 移入 skill 资源基）的一次全新上下文 Mars 评审给出了 REVISE，提出两项必须修复的问题：

1. **README 配对中残留两处过期的包根路径。** `README.md` 与 `README.zh.md` 的开发说明文字仍写着 `` `scripts/review-grade.mjs` ``——一个纯代码片段，不是 markdown 链接，因此 `verify-md-links` 从未检查过它，第一轮新增的 `skill-resource-paths.spec.ts` 也只锁定了三份 `SKILL.md` 指南自身的资源引用，未覆盖包根 README 的文字。从包根目录看，根本没有 `scripts/` 目录；真实路径是 `skills/premium-web-experience/scripts/review-grade.mjs`。已修复这两处，以及下方泛化测试额外发现的同类问题：两份 README 中"评审者子 agent 仍需要真实的……截图"一句里的 `` `scripts/review-web.mjs` ``。新增测试 `tests/skill-doc-paths.spec.ts`（新文件——`skill-resource-paths.spec.ts` 是第一轮已提交的 RED 文件，因此以新增文件而非改动它的方式扩展）将检查泛化到超出 Mars 指出的单一实例：两份 README 中任何一处以路径形式（即在文件名前带有 `/` 连接的前缀，以此区分"声明了一个位置"与"仅提及脚本名"）提及任一脚本文件名的地方，都必须能相对包根解析到一个真实存在的文件。
2. **`measure` 探针（上文"备选方案"一节中推迟未实现）现已实现，按该节结尾所预告的方式拆分到两个脚本中。** `review-web.mjs` 新增 `measureProse()`（Playwright 的 `page.evaluate`，完全不涉及 jsdom）：对主正文容器（`main`，缺省时回退到 `body`）内可见的 `<p>`/`<li>` 文本，通过为每个字符逐一扩展单字符 `Range` 并观察 `getClientRects()[0].top` 的变化——这是从真实布局中判定换行边界的标准手法——分割出前约 20 行渲染行，再报告每行字符数的中位数，形式为每个视图上的 `{measure_ch, pass: <= 75, linesSampled}`（受 4000 字符扫描上限约束；找不到可取样正文时为 `null`，绝不猜测）。`review-grade.mjs` 新增 `--report <path>` 参数，读取一份 `review-web.mjs` 的 `report.json`，取出其 `desktop` 视图的 `measure`，并在 rubric 上报告一个新增的顶层 `measure` 字段（`{verdict, measure_ch, evidence}`）——省略 `--report`，或其 desktop 视图不带测量值时为 `UNVERIFIED` 且 `measure_ch: null`；提供测量值时为 `PASS`/`REVISE`（绝不是硬性 `REJECT`）。`measure` 被有意设计为与 `items` 并列的顶层字段，而非塞进固定的十二项数组作为第十三项——`rubric.schema.json` 已将该数组的长度与检查项枚举锁定为 SATURN-DESIGN-RULES.md 的清单，而该 rubric 对象自身的 `additionalProperties: true` 正是为了允许这类补充字段而存在。它不会影响 `overallVerdict`，后者仍只依据那十二项 schema 条目判定。新增测试：`tests/review-grade-measure.spec.ts`（新文件，原因同上——`review-grade.spec.ts` 虽已提交但处于绿色而非 RED 状态，本轮修复本身也没有把它重新置为 RED，向一个已经通过的测试文件中追加断言容易造成"测试文件被静默改动"的观感，因此改用新文件）覆盖了 `gradePage` 的 `measure` 字段本身（缺失时为 UNVERIFIED，提供时为 PASS/REVISE，且始终不影响 `overallVerdict` 或十二项计数），以及 CLI 对 `--report` 的消费（读取带 desktop 测量值的夹具 `report.json`；面对不带测量值的夹具仍保持 UNVERIFIED；`--report` 指向不可读/非法 JSON 时退出码为 2）。`review-web.mjs` 自身对 `measureProse()` 的浏览器端捕获仅由其既有的、受 Playwright 门控的测试覆盖（`review-web.spec.ts` 中的 `it.skipIf(!hasPlaywright)`）——本环境未安装 Playwright，本轮因此无法运行这些用例；这与 README「已知限制」中早已点名的"浏览器检查仍依赖截图"这一缺口是同一类，并非本次改动新增。

**偏差（修复轮次）。** Mars 提出的两项必须修复均未被拒绝，均按原样实现。第二轮评审另外将某个 cell 范围之外的越界提交、以及 `jsdom` 作为未声明的运行时依赖标记为 `integration_needs`（而非必须修复项）——二者均不受本轮改动影响，仍是编排者需要裁定的事项，此处不再复述。

**测试（修复轮次）。** `tests/skill-doc-paths.spec.ts`（3 个测试）与 `tests/review-grade-measure.spec.ts`（7 个测试）均为新文件，均已在实现前针对修复轮次前的代码确认失败（RED），实现后转绿。完整包测试套件：7 个文件 / 50 个测试，全部通过（本轮之前为 5 个文件 / 40 个测试）。`tsc -p packages/skill/skill-premium-output/tsconfig.json --noEmit` 干净。`scripts/run-gates.ts doc-quick`：9 通过 / 6 失败，与第二轮相同的既有基线失败项（本 cell 的文件未新增任何失败）。
