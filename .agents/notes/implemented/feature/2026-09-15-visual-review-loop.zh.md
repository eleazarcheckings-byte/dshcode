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
