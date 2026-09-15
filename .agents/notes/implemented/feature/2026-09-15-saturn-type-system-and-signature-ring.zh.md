# Agent Note: 自托管 Saturn 字体系统 + 侧边栏当前行上的签名式圆环

Status: implemented

[English](2026-09-15-saturn-type-system-and-signature-ring.md) | 中文

## Problem

SPEC §2/§3 C3（2026-09-15 的这次 fan-out）：应用在 `packages/client` 中没有任何一处 `@font-face` 声明——body 与 display 字体均为裸操作系统字体栈（本机上为 `Segoe UI`），而该产品自身的设计法则明确将其列为一种具体的 `ai-slop` 信号（"不要使用 Inter、Roboto 或系统默认字体栈作为个性"）。favicon 圆环本身早已正确倾斜 -18 度，但只出现在两个界面（hero、First Light 背景）；侧边栏——每一个会话都生活在其中的界面——完全没有承载该品牌的这一唯一具名机制。

## Decision

**字体。** 用 `curl` 从 Instrument Sans variable 与 Commit Mono 各自的官方 GitHub 来源获取，先逐一读取候选授权许可文件再信任 SPEC 的假设，最终只发布验证真正支持的内容：

- Instrument Sans：`Instrument/instrument-sans`，分支 `master`。`fonts/webfonts/InstrumentSans[wdth,wght].woff2` 是官方预构建的 variable woff2（已用 `fontTools.ttLib` 核实：`fvar` 轴为 `wdth 75–100`、`wght 400–700`，与 SPEC 给出的数值完全一致）。仓库根目录的 `OFL.txt`——与 SPEC 相符。
- Commit Mono：`eigilnikolajsen/commit-mono`，发行版 `v1.143`。该发行版 zip 只提供 `.otf`/`.ttf`，不提供 `woff2`；用 `fontTools` 转换了 400 与 700 两个常规字重（`TTFont(src); f.flavor = 'woff2'; f.save(dst)`——只改变容器格式，轮廓与度量均未改动）。**授权许可偏差：** SPEC 的任务书为该文件指定的名称是 `LICENSE-MIT.txt`，但该仓库根目录的 `LICENSE`（MIT）仅覆盖其展示站点与构建工具——字体二进制文件携带各自的 `LICENSE-FONT`，即 SIL Open Font License，其实质内容与发行版 zip 包中随 `.otf` 文件一同提供的 `license.txt` 完全一致。给一个 OFL 授权的二进制文件贴上 MIT 标签会误代表其实际条款，因此 `apps/web/public/fonts/` 携带的是 `LICENSE-OFL-COMMITMONO.txt`。`LICENSE-OFL.txt` 与 `LICENSE-OFL-COMMITMONO.txt` 均已在复制前完整读取。

**可达性，已核验而非假定。** `apps/web/vite.config.ts` 未设置 `publicDir` 覆盖，因此 Vite 的默认行为生效：`apps/web/public/` 下的一切都会原样复制进构建后的 `dist` 根目录。`packages/host/frontend-static/src/index.ts` 的 `serveStatic` 会将任意已解码的请求路径直接解析到该 dist 根目录（`resolve(normalize(join(distRoot, pathname)))`）并从磁盘读取；其 MIME 表没有 `.woff2` 条目，因此未列出的扩展名会回退到 `application/octet-stream` 而不是被拒绝——这与已经发布的 `favicon.svg` 与 `manifest.webmanifest` 这两个 public 资源走的是完全相同的路径。`packages/client/ui-skin-saturn/tests/font-served-path.spec.ts` 通过直接读取真实的生产环境源码（无 mock，也无需新增包依赖——一次相对路径的 `fs` 读取不涉及模块解析）来固定这一点，而不仅仅是断言字体文件存在。

**与度量匹配的回退字体，经计算而非猜测。** 每个自托管的 `@font-face` 都配有一个 `*-Fallback` 字体族（`size-adjust` 加上 `ascent-override`/`descent-override`/`line-gap-override`），使 `font-display: swap` 的切换过程不会产生可见的布局回流。这些比例来自用 `fontTools` 读取每个字体自身的 `OS/2`/`head` 表并与其系统回退字体对比：

```python
from fontTools.ttLib import TTFont
def metrics(path):
    f = TTFont(path); os2 = f['OS/2']; upm = f['head'].unitsPerEm
    return dict(upm=upm, xh=os2.sxHeight, typoAsc=os2.sTypoAscender, typoDesc=os2.sTypoDescender)
# size-adjust = 100 * (target.xh/target.upm) / (fallback.xh/fallback.upm)
# ascent/descent/line-gap-override = target's own typo metrics as % of its upm
```

Instrument Sans -> Arial：`size-adjust: 98.35%`，`ascent-override: 97%`，`descent-override: 25%`，`line-gap-override: 0%`。Commit Mono -> Consolas：`size-adjust: 110.15%`，`ascent-override: 90%`，`descent-override: 20%`，`line-gap-override: 0%`。

**Token 与 display 的字宽动作。** `ui-skin-saturn/src/client/index.ts` 声明了 `--saturn-font-display`、`--saturn-font-body`（两者是同一个 Instrument Sans 字体栈——SPEC §2："一个 variable 字体族同时承载 UI 与 display"）以及 `--saturn-font-mono`，均置于该文件既有的 `body[data-dsh-saturn][data-dsh-saturn]` 双重特异度作用域下。它同时把几乎所有既有组件已在使用的两个上游变量——`--dsw-font-family` 与 `--ds-font-family-code`（均在 `ui-theme/src/styles/base.css` 中以 `:root` 作用域定义）——重新指向新的 Saturn token，使整个应用无需改动任何一个消费方即可继承该字体系统。**偏差，以及为何这不是缺陷：** 该 variable 字体的 `wdth` 轴为 `最小 75 / 默认 100 / 最大 100`——默认值本身就是宽的一端；这条轴上并不存在一个比默认更宽的取值可以切换过去。`--saturn-font-display-variation: 'wdth' 100` 因此是把这个值显式声明出来（以防未来更换字体时该轴的默认值被悄悄改变），而不是编码一次真正从更窄的 body 默认值出发的位移；对 hero 大标题而言，感知上的"动作"其实是这次显式固定，结合 `HeroShell.module.css` 已有的紧缩字间距（`letter-spacing: -0.045em`）。`apps/web/index.html` 在应用关键路径上预加载了两个文件（Instrument Sans variable、Commit Mono 400）；Commit Mono 700 属于次要／强调字重，未被预加载。

**侧边栏当前行上的圆环。** 真正的会话行标记（以及其经过哈希处理的 CSS-module 类名）属于 `ui-workspace` 的 `Rows.tsx`——即 `sidebar.workspaces` 插槽的注册方——不在本 cell 的写入范围内（仅限 `ui-sidebar/src/client/**/*.module.css`）。因此没有触碰该包，而是让 `SidebarRoot.module.css` 通过自身已作用域化的 `.regionArea` 类，穿透到每一行（无论由哪个包渲染）都已经具备的两个属性：`role="treeitem"` 与 `aria-selected`。CSS Modules 只会重写复合选择器中最前面的类名——方括号属性选择器是纯 CSS，不会被重命名——因此 `.regionArea [role='treeitem'][aria-selected='true']` 能够触及真实的行，而无需与 `ui-workspace` 做任何协调，也不依赖任何私有 API。圆环本身是一个 `::after` 绝对定位叠加层（永不参与 flex 布局，`pointer-events: none`），用 `mask-image` 加 `background-color: var(--saturn-accent, currentColor)` 绘制，而非写死的十六进制色值，从而继承强调色 token——椭圆几何与 favicon 完全相同（`rx=27 ry=9.5`，`rotate(-18deg)`，64×64 viewBox），即 SPEC §2 所要求的、处处统一使用的那一个倾斜角度。

## Alternatives considered

**将圆环作为参与 flex 布局的生成式 `::before` 内容内联进去。** 已否决：一旦某行变为当前行，这会使该行既有内容整体位移自身宽度，产生可见的单行布局跳动，而本代码库在别处对"空闲时零副作用"的动效克制标准并不容忍这种情况。

**在 Instrument Sans 的 `src` 上添加 `format('woff2-variations')` 格式提示。** 核查当前 Chromium/Electron 支持后已放弃：普通的 `format('woff2')` 提示已经足够——variable 字体能力是从文件自身的 `fvar` 表读取的，而非格式字符串——因此额外的提示只增加复杂度而没有带来兼容性收益。

## Consequences

`document.fonts.check('16px "Instrument Sans"')` 在已发布的应用中解析为 true（自托管，没有任何网络字体请求——由 `typeface-tokens.client.spec.ts` 直接断言：只要任何 `@font-face` 引用了 `fonts.googleapis.com`／`fonts.gstatic.com` 或裸的 `http(s)://` URL，测试套件就会失败）。现在不只是 hero，每一个既有界面都以 Saturn 字体系统渲染，因为这次覆盖发生在整棵组件树本就消费的那两个变量上。侧边栏的当前行现在通过与 PASS 裁决印章、favicon 相同的标记而在视觉上可辨识为"这就是那个打开的会话"，把品牌唯一具名机制的覆盖范围，从 2026-09-15 UX 审计发现的那两个界面向外延伸。

**已记录而非被悄悄接受的已知限制：** 圆环的 `::after` 与既有的拖拽标记 `::after`（`ui-workspace` 的 `Rows.module.css` 中的 `.sessionRow.dropAfter::after`）针对的是同一元素上的同一伪元素插槽；在某一行同时是当前会话*且*是一次进行中拖拽的"之后"落点这种罕见情形下，按 CSS 特异度／源码顺序，每个属性只会有一种视觉效果生效。这是一次瞬时拖拽手势期间纯粹的外观重叠，而非功能性回归；若要从结构上修复，需要对 `ui-workspace` 做协调改动，这超出了本 cell 的范围。

## Verification

- `packages/client/ui-skin-saturn/tests/typeface-tokens.client.spec.ts`——固定了所注入的确切 `@font-face` 规则（自托管与回退两者）、三个 token 加上 `wdth` variation token、`--dsw-font-family`/`--ds-font-family-code` 的重新指向、禁止网络字体来源的守卫，以及对 favicon -18 度倾斜角的回归锁定。
- `packages/client/ui-skin-saturn/tests/font-served-path.spec.ts`——读取真实的 `apps/web/vite.config.ts`、`apps/web/index.html` 与 `packages/host/frontend-static/src/index.ts` 源码（无 mock）以证明 `/fonts/*` 的可达链路，并核验已发布 `woff2` 的魔数字节与两个授权许可文件的实际文本。
- `packages/client/ui-sidebar/tests/active-row-ring.client.spec.ts`——固定圆环的定位上下文、其非交互式绝对叠加层属性、强调色 token 的 mask 绘制，以及与 favicon 共享的 -18 度／`rx=27`／`ry=9.5` 几何形状。
- `node_modules/.bin/vitest run packages/client/ui-skin-saturn packages/client/ui-sidebar`：10 个测试文件、48 个测试全部通过（在这台并发压力很大的共享机器上出现过一次瞬时 worker 进程崩溃，立即重跑后干净通过）。
- `node_modules/.bin/tsc -p packages/client/ui-skin-saturn/tsconfig.json --noEmit` 及对 `ui-sidebar` 的同一命令：均无报错。
- `npx tsx scripts/run-gates.ts doc-quick`：`ui-skin-saturn` 的 README 现已通过本 cell 范围内文件所能满足的每一项检查；唯一仍然失败的一项（"must contain one or more complete model-context entries"）需要在 `scripts/verify-package-readme-model-experience.ts`——一个跨 cell 共享的仓库级门禁脚本，不在本 cell 写入范围内——中新增一条 `SENTENCE_MODEL_EXPERIENCE` 白名单条目；已在 `integration_needs` 中记录确切的修复方式，且 README 自身的那句话已按所需模式措辞（`None, as this package only changes browser presentation.`），一旦该白名单条目落地即无需再改动 README。

## Round 3 addendum — hero headline 的 `wdth` 改动已经落地，而非仍是缺口

本笔记此前的"Alternatives considered"一节曾把 `HeroShell.module.css` 那两行改动记为一条未选之路，仅记录为一条 `integration_needs` 条目，理由是该文件不在本 cell 的范围内。Mars round 2 推翻了这一处理：它明确把这一处单文件改动指派给了本 cell，而不是留给 C2 或编排者去处理，round 3 随即直接应用了它。提交 `4e47e14b25`（"fix(saturn): round-3 doc-gate skeleton + hero headline display move"）在 `packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css` 的 `.headline` 规则中恰好加入了 `font-family: var(--saturn-font-display, inherit);` 与 `font-variation-settings: var(--saturn-font-display-variation, 'wdth' 100);`——对那一个文件的两行改动，与本包 README 的 doc-gate 骨架修复在同一提交中一并落地。该改动由 `packages/client/ui-skin-saturn/tests/hero-headline-font-tokens.spec.ts` 固定：该测试在前一提交 `fb9a59f932`（"test(saturn): pin the hero headline's consumption of the Saturn display font tokens"）中先以 RED 状态针对修复前的规则提交，待 `4e47e14b25` 落地后转为 GREEN。因此 SPEC §3 C3 "wdth used as the display move for the hero headline" 这一交付项已经彻底完成，而不仅仅是记录为留给他人解决的缺口。
