# Agent Note: 多任务切换控件绘制真实的开/关/排队状态

Status: implemented

[English](2026-09-16-orchestrate-toggle-state.md) | 中文

## 问题

composer 的多任务切换控件已经带有 `aria-pressed` 与 `on` 这个 CSS 修饰符，但 `off` 没有自己的规则——每种状态最终都落到同一个透明、无边框的药丸形状上。Izzy："thats fine, make sure the button indicates when its on /off it always looks like the same right now"（大意：那没问题，但要让按钮能表明它此刻是开还是关，现在它看起来总是一个样）。默认在已发布产品中保持关闭（`packages/saturn/orchestrate`，commit `4e1ad8184b`，`1.2.4`）让这一点更严重而非更轻：用户唯一用来确认多任务是否生效、或将其关闭的控件，无论哪种状态都给不出可辨认的信号。

## 决策

让 `off` 拥有独立规则（细描边 `--dsw-alias-border-l2`、弱化墨色、透明填充），`on` 继续填充 `--saturn-accent`、以 `--saturn-void` 作为墨色、边框透明——两者现在背景与边框都不同，不只是类名不同。在"多任务"标签旁加一个小号等宽 `ON`/`OFF` 标签，取自两个新增语言键（`toggle.tag.on` / `toggle.tag.off`），在两种语言词典中都保持不翻译——与 `@saturnai/dsh-client-ui-done` 的 `VerdictCard` 对 `PASS`/`REVISE`/`REJECT` 采用的同一套"教义词元"惯例一致——因此状态以文字呈现，绝不仅依赖填充颜色。`pending` 现在叠加一圈虚线描边，颜色取自排队中的 `data-target`，而不再只是给标签加下划线；描边是虚线而非实线，这样排队中的翻转不会读成已经落定，标题也已经说明"将在下一步生效"。切换控件的颜色/边框过渡搭乘共享的 `--saturn-dur-1` / `--saturn-ease-standard` 动效令牌，并在 `prefers-reduced-motion: reduce` 下禁用。测试先行：`toggle-state.client.spec.tsx`（jsdom 渲染）与 `toggle-state-styles.client.spec.ts`（纯 Node，读取 CSS 模块文本）在 `ef1d0aaebf` 落地时为 RED，随后组件/CSS/语言包改动在 `07523de381` 落地，未修改任一测试文件。

## 曾考虑的替代方案

- **仅改变色调（背景颜色变化，边框不变）。** 已否决：仍然只靠颜色，既不满足"绝不仅靠颜色"的要求，也不利于色盲可读性——恰恰是要修复的问题本身。
- **为 ON 状态使用 `VerdictCard` 的 SVG 印章圈（`pathLength`，自绘）。** 已考虑并推迟：该手法用于封印一个receipt尺寸的印章；在此切换控件 28px 的 composer 行尺度下，填充药丸形状比动画圈一眼看去更清楚，而填充药丸也已经与该控件借用外观的现有 `PermissionSelect` 业务色调惯例一致。圈形手法保留给 PENDING 专用，那里要传达的是"尚未落地"而非"已经生效"——与 ON 的信号不同。
- **排队期间把控件重绘成目标状态。** 已否决：组件自身既有的约定明确写着 `aria-pressed` 与视觉呈现永远报告当前生效状态，绝不报告排队中的目标状态（"绝不能把目标状态画得像已经是当前模式"）；推翻这一点会在本任务范围之外重新裁定一个已经定案的决策。排队圈的颜色是目标状态唯一透出的地方，且仅在排队中的目标是 ON 时生效。

## 后果

三种状态现在在浅色与深色主题下都能视觉区分，不单纯依赖主题的 saturn-accent 回退值：OFF 描边，ON 填充，PENDING 加圈。`packages/saturn/orchestrate` 的默认值（`active: false`）未被触碰——不在本任务范围内，izzy 对该默认值的认可逐字落在 `scripts/harness/SATURN-HARNESS-ADDENDUM.md` 的 "Always-orchestrate" 一节。排队圈的强调色只在排队目标为 ON 时出现；排队目标为 OFF 时沿用静止时的描边颜色，这是一处已记录的已知差距（见包 README 的"已知限制"）。
