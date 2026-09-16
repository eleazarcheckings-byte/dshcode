# Agent Note: 手机尺寸下的 Web 客户端 —— 抽屉、停靠输入框、单一断点

Status: implemented

[English](2026-09-15-mobile-shell-layout.md) | 中文

## 问题

Web GUI 一直是带"窄模式"的桌面外壳，而不是手机产品。在 768px 以下，三栏 `AppFrame` 仍然渲染三栏：侧栏自动折叠成 56px 导轨，在 390px 屏幕上吃掉七分之一；详情栏仍留在轨道列表里；40px 的 `col-resize` 拖拽条压在对话记录上，而触摸表面期待的是滑动。输入框停靠在布局视口底部 —— 在 iOS 上那正好在软键盘*下面*：iOS 不会因键盘收缩布局视口，而是把键盘画在它上面。没有任何表面尊重 `env(safe-area-inset-*)`，所以刘海会盖住会话标题，Home 指示条会盖住发送按钮。工具行保持桌面的 24px 高度，远低于可用的触摸目标。

SPEC §8 M2 要求的是"同一个产品出现在手机上" —— 同样的圆环、同样的 token、同样的动效系统 —— 而不是缩小的桌面；并写明了验收：390×844 的截图，抽屉打开、键盘打开状态的输入框，且 `document.documentElement.scrollWidth <= 390`。

## 决定

一个断点、一张样式表，以及能承载它的最小组件改动。

### `ui-theme/src/styles/mobile.css` —— 唯一权威

由 `installThemeStyles` 最后挂载的新全局样式表，只包含**一个**顶层 `@media (max-width: 768px)` 块（减弱动效的分支嵌套在它内部，而不是另开一个查询）。它适配的是自己并不拥有的组件，因此只锚定那些包有意公开的稳定属性 —— `data-shell-frame`、`data-shell-center`、`data-shell-details`、`data-mobile-drawer`、`data-mobile-backdrop`、`data-mobile-strip`、`data-sidebar-root`、`data-composer-seat`、`data-tool`、`data-disclosure-row` —— 绝不使用 CSS Module 的类名：那是哈希出来的，随时可能无声改变。`mobile-styles.client.spec.ts` 就是这条规则的测试：出现第二个顶层 at-rule、任何类选择器、或 transition 里出现裸的 `ms` 字面量，它都会失败。

它做的事：外壳使用 `100dvh`（URL 栏收起再展开时，`100%` 会在输入框下方留出缝隙）；文档层面 `overflow-x: hidden` 加 `overscroll-behavior: none`；框架轨道变为 `100% / auto minmax(0, 1fr)`，详情栏 `display: none`；侧栏变成 `min(84vw, 360px)` 的 `position: fixed` 抽屉 —— 故意不占满视口，因为遮罩后面仍能看见对话，才让它读起来是覆盖层而不是第二块屏；标题条、抽屉、输入框座位和每个工具折叠行的触摸目标下限 44px；工具标题压成单行但保留折叠控件；输入框座位 `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--saturn-keyboard-inset, 0px))`。

### `ui-layout` —— 手机形状

`isMobileViewport` / `drawerWidth` 加入 `columns.ts`；让步求解器本身仍然与断点无关，就像它对 `SIDEBAR_AUTO_COLLAPSE` 一样。`AppFrame` 从自己用 `ResizeObserver` 量出的盒子读取该判定，然后：(a) 去掉内联 `grid-template-columns` —— 内联模板会压过样式表；(b) 渲染 `MobileTitleStrip`；(c) 渲染遮罩；(d) 给侧栏标上 `role="dialog" aria-modal`；(e) 不渲染两个拖拽条。抽屉里的侧栏始终是**宽**的，绝不是导轨：一条 56px 的导轨浮在对话上只会像残渣。

打开状态作为 `drawer` 存在布局 store 中，旁边是断点的镜像 `mobile` —— 和已有的 `narrow`/`narrowExpanded` 同一形状，理由也相同：`toggleSidebar` 需要知道自己此刻是哪一种语义。它现在按"最窄的带优先"选择（手机 → 抽屉，窄 → 覆盖开关，宽 → 宽度），于是 `ctx.layout.toggleSidebar()` 和侧栏自己的开关按钮都能操作抽屉，无需新增服务方法、无需新增调用方边。离开手机带会关闭抽屉，因此缩放永远不会把覆盖层遗留在桌面框架上。

`drawer.ts` 是普通的安装函数而非 hook：它订阅的是 DOM，而业务组件一律通过四份 props 份额获取一切。Escape 关闭；Tab 只在首尾两端回绕（中间的每一次 Tab 都属于浏览器自己）；焦点回到标题条控件。焦点归还目标是传入的，而不是从 `document.activeElement` 读取 —— "打开时聚焦的那个元素"只有在确实由某个聚焦控件打开时才正确：指针按下不会移动焦点，而 `ctx.layout` 可以从任何地方打开抽屉；记录 activeElement 的路径仍作为兜底保留。

标题条上的控件就是 SPEC §2 的签名圆环 —— favicon 的那枚椭圆，用 mask 绘制以便取按钮自身的墨色 —— 关闭时倾斜 -18°，抽屉打开时旋转至水平。它与抽屉滑出是这个表面仅有的两处有意动效，都走 `--saturn-dur-2` + `--saturn-ease-out`，都在减弱动效下取消。这条约定在 JS 中同样兑现：减弱动效时，焦点陷阱在同一个任务里移动焦点，而不是等待一帧根本不会发生的滑动。

根条目现在声明自己的 `layout` 语言命名空间而非 `common`；绑定到命名空间的 `t` 同样能读共享的 common 词汇，所以 `brand.localBuild` 依旧可解析，而标题条的三条文案由渲染它的那个包拥有。

### `ui-conversation/skeleton/keyboard-inset.ts` —— 输入框在键盘下存活

`keyboardInset(layoutHeight, visualViewport)` 就是全部测量：`max(0, round(innerHeight - viewport.height - viewport.offsetTop))`。减去 `offsetTop` 很关键 —— 那一段已经滚出顶部，再算一次就会重复补白。`installKeyboardInset` 订阅视觉视口的 `resize`（键盘）与 `scroll`（浏览器为了让聚焦字段保持可见而滚动，它改变 `offsetTop` 却不改变高度），并把结果作为 `--saturn-keyboard-inset` 发布到文档元素上。`ConversationRoot` 安装它一次 —— 它是输入框座位的常驻拥有者，且全局只有一个 —— 样式表则把它花在座位的下内边距上。没有 `visualViewport` 的引擎发布 `0px`：既然没有任何东西报告键盘，凭猜测补白只会平白移动输入框。

### `ui-conversation/skeleton/ConversationSession.tsx` —— 会话头部同样是触控表面

第一版把标题条、抽屉、输入框座位与工具折叠行提到了 44px 便止步于此，结果手机用户最常伸手去点的那一行仍保持桌面尺寸：视图标签是 13/16 的文字加 11px 下内边距（实测 27px），而 `actions` / `utilities` 座位 —— Agent Team、任务列表、Definition of Done —— 只有 21px。这些座位由样式表并不拥有、也不应被迫改动的包填充，因此头部发布一个持久锚点 `data-conversation-header`，样式表据此抬高其中的每一个 `button`。视图标签另带一个锚点 `data-conversation-tab`，理由只有一个：选中态是画在按钮自身底线上的 2px 横条，按钮变高后必须让文字继续坐在那条底线上（`inline-flex` + `align-items: flex-end`），而不是浮在新盒子的中间。在 Chromium 中以 390×844 加载真实样式表实测：改前为 28/21/21/27/27px，改后五个控件全为 44px，且 `document.documentElement.scrollWidth` 仍是 390。

## 考虑过的替代方案

**独立的移动路由或分叉的手机布局。** 依授权与本身价值均被否决：两套外壳会漂移，之后每个功能都要做两遍。

**用容器查询替代媒体查询。** 抽屉是相对视口的 `position: fixed`，安全区也是视口的，所以视口才是诚实的查询对象。容器查询对组件内部的重排仍然适用，并未被排除。

**给关闭的抽屉加 `inert`。** 没有必要：样式表已用 `visibility: hidden` 把它停在画布外，这本身就移除了所有 tab 停靠点；`focusableWithin` 读的正是同一个计算出的 visibility，因此陷阱与浏览器的判断一致。

**用 `offsetParent` 判断可聚焦性。** 否决：在真实布局引擎之外它恒为 0/null，会让陷阱在 jsdom 中无法测试，并在任何绘制前的调用中无声地返回空。计算出的 `display`/`visibility` 能同时回答这两件事。

**在 `ILayout` 上加 `closeDrawer` 方法。** 否决：`toggleSidebar` 本就表示"显示或隐藏导航栏"，把手机语义交给它，所有现有调用方无需契约扩张即保持正确。

## 测试

对 `ui-layout`、`ui-sidebar`、`ui-theme`、`ui-conversation` 运行 vitest —— 73 个文件、668 个用例全绿。新增：`drawer-trap.client.spec.ts`（Escape、两个方向的 Tab 回绕、空面板兜底、两种焦点时序分支、归还及其幂等）、`mobile-columns.client.spec.ts`（断点与 store 的抽屉语义）、`mobile-frame.client.spec.tsx`（手机形状、抽屉的 dialog 标记、遮罩/Escape/路由变化关闭、焦点归还，以及 1280px 下的桌面形状）、`keyboard-inset.client.spec.ts`、`mobile-styles.client.spec.ts`（上文的样式表契约）、`drawer-anchor.client.spec.tsx`。另有三处既有断言因 store 新增两个字段而放宽，一处因新样式表加入挂载顺序而更新，侧栏快照因新的根属性重新录制。

`session-header-anchors.client.spec.tsx` 从 DOM 一侧固定这两个头部锚点（头部即 `<header>` 元素、该行的每个按钮都在其内、每个标签都被标记且保留 `role="tab"`），`mobile-header-targets.client.spec.ts` 固定同一契约的样式表一侧（两个方向都 44px、标签文字钉在它的横条上、只用属性选择器、仍然只有一个断点）。两者在本轮之前的样式表上均失败。

`apps/web/tests/mobile-layout.e2e.ts` 在 390×844 下驱动真实组合：抽屉从标题条打开，停在 `left: 0`、占屏宽 84%、遮罩可点；选中会话行触发路由变化后抽屉关闭；手机外壳中没有任何小于 44px 的控件 —— 标题条、抽屉、会话头部与输入框座位，正是样式表所管辖的那一组；输入框在模拟的 336px 键盘带上方抬起且不被裁切；两种状态下 `document.documentElement.scrollWidth` 均 ≤ 390。截图写入 `.artifacts/`，与所有同级场景一致。该场景在当前代码树中无法启动 —— `launchWebScaffold` 因陈旧的 `packages/saturn/tool-media/lib/index.js` 抛出 `failed to apply loader entry saturn-tool-media … Cannot read properties of undefined (reading 'gemini')`，这个问题早于本次工作，且会拦住每一个 web 场景而不只是这一个 —— 因此只有在一次构建刷新该包的 `lib/` 之后才能重新跑绿。

## 影响

手机形状由一个判定决定、由一张样式表绘制，因此下一个需要移动端分支的表面只需在那里加一条规则，而不是自己再开一个断点。代价是对上面那串属性名形成长期耦合：它们现在是产品契约而不是顺手写的标记，而 `mobile-styles` 的"禁止类选择器"断言正是让改名者能看见这件事的机制。在页面的 viewport meta 带上 `viewport-fit=cover` 之前，`env(safe-area-inset-*)` 解析为 0；每一处内边距都写成让这种解析退化为桌面等价间距，而不是退化成坏掉的布局。
