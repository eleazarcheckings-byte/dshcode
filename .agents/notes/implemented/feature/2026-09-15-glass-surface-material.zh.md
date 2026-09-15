# Agent Note: 共享主题中的玻璃表面材质

Status: implemented

[English](2026-09-15-glass-surface-material.md) | 中文

## 问题

Web 客户端没有供悬浮于内容之上的层使用的共享材质。想要透出后方页面的表面——下拉卡片、对话框、定义完成记录浮层——原本必须自行选择填充透明度（alpha）、模糊值与明暗主题分支；而缺少 backdrop-filter 的半透明填充会与未模糊的内容合成，读起来像一块发灰的面板，而不是一种材质。主题自身的表面 token 是不透明的：`--dsw-specific-menu` 是满不透明的 layer-3 层级色，因此无法表达一个让读者透视的面板。

## 决策

`packages/client/ui-theme/src/styles/gradient-shadow-text.css` 是玻璃材质的唯一声明处，与它所组合的 elevation token 同在一张表：

- `--dsw-glass-surface`——layer-3 表面取 0.72 的 alpha：`body` 上为 `rgba(255, 255, 255, 0.72)`，`body[data-ds-dark-theme]` 下为 `rgba(53, 54, 56, 0.72)`。两个主题共用同一个 alpha，因此玻璃表面在两种主题下呈现同样的轻重，填充与后方已模糊的内容合成，而不是将其覆盖。
- `--dsw-glass-filter: blur(14px) saturate(140%)`——模糊与饱和度提升合为一个 token，两种主题只声明一次。
- `--dsw-glass-elevation`——elevation 描边加两层柔光，与其他 elevation token 一样在 `body, body *` 上重新声明，使表面对 `--dsw-elevation-stroke-color` 的重绑能够到达它。

表面通过一条规则消费这三个 token 来采用该材质，绝不自行声明它们、写入颜色字面量或添加带引擎前缀的 filter：

```css
border: 0;
background: var(--dsw-glass-surface);
backdrop-filter: var(--dsw-glass-filter);
box-shadow: var(--dsw-glass-elevation);
```

`border: 0` 由 [elevation 决策](2026-09-01-web-elevation-stroke-shadows.zh.md)推出：玻璃 elevation 以 0.5px 发丝描边开头，与它并列的 border 会把轮廓画两遍。

这些 token 归主题所有而不是逐组件声明，因为这三条声明只有合在一起才有意义。逐组件填充会把材质分叉——明暗分支没有唯一归属、表面无从继承回退、也没有可扫描「填充缺少模糊」的位置——而填充所派生的 layer-3 层级色本就声明在这张表中。

## 回退

两条回退路径都在所属样式表内，因此消费表面不携带任何回退：

- `@media (prefers-reduced-transparency: reduce)` 把填充解析为不透明的 layer-3 层级色（明色 `--dsw-static-neutral-bluish-00`，暗色 `--dsw-static-neutral-bluish-800`），并把 filter 解析为 `none`。
- `@supports not (backdrop-filter: blur(1px))` 在两种主题下同样把填充解析为不透明，理由相同：不受支持的 filter 会让半透明填充与未模糊的内容合成。

两条路径都原样保留 `--dsw-glass-elevation`。要求减少透明度的读者失去的是半透明与其模糊——正是该诉求所指的两件事——并保留表面：不透明的 layer-3 填充、发丝轮廓，以及把面板与其覆盖内容分开的柔光层。每个块都重复 `body[data-ds-dark-theme]` 选择器，因为裸 `body` 覆盖会输给暗色填充；两个块在源码顺序上都排在主题填充之后，因此明色覆盖按源码顺序取胜。

## 采用该材质的表面

- `packages/client/ui-primitives/src/Menu.module.css`——下拉卡片及其子菜单（`.list`、`.submenu`）：`border: 0` 配 20px 圆角、填充、filter、玻璃 elevation，并把描边重绑为最浅的 `--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)`。
- `packages/client/ui-primitives/src/Modal.module.css`——对话框：`border: 0` 配 24px 圆角、填充、filter 与玻璃 elevation。其后的遮罩保留 `--dsw-mask-blur`。
- `packages/client/ui-done/src/client/DefinitionOfDone.module.css`——380px 的记录浮层采用完整材质，并保留自己的圆角、l1 描边重绑与 l2 滚动条重绑；芯片自身的悬停与展开填充只取填充与 filter，不带 elevation，因为就位的芯片并不悬浮。

有两个表面有意保持不透明。`packages/client/ui-primitives/src/HoverCard.module.css` 的 `.card` 在两种主题下都从组件局部的 `#2C2C2E` 取填充，并在其上绘制字面白色文字，因此其对比度是针对这一固定暗色填充确定的，跟随主题的半透明材质无法保持它。`packages/client/ui-primitives/src/Toast.module.css` 的 `.toast` 是刻意成对的反色（`--dsw-alias-button-contrast-fill` 配 `--dsw-alias-label-primary-inverted`），半透明会让横幅后方的页面改变这对颜色所依据的对比度。[elevation 决策](2026-09-01-web-elevation-stroke-shadows.zh.md)出于同样理由把这两个表面排除在描边转换之外。

## 测试

`packages/client/ui-theme/tests/glass-styles.client.spec.ts` 针对磁盘上的样式表文本断言：两种主题下取同一 alpha 的半透明填充、同时承载模糊与 saturate 的单个 filter token、逐元素由描边组合而成的 `--dsw-glass-elevation`、两条回退路径把填充解析为不透明并去掉 filter，以及这些回退所依赖的层叠顺序。它还会扫描 `packages/` 下的每张样式表，拒绝引用了玻璃填充却不带 filter 的规则，并拒绝在所属样式表之外再次声明任一玻璃 token。elevation spec 把 `--dsw-glass-elevation` 计入 elevation 投影，因此与它并列的中性 `--dsw-alias-border-*` border 会在那里被判失败。

## 曾考虑的替代方案

**逐组件的半透明填充。** 每个表面各自写 `rgba()` 与模糊。不予采纳，因为该材质是三条只有合在一起才成立的声明：明暗分支、alpha 与回退都会被逐组件重写，在第一次变更时就彼此分叉，而且没有任何门禁能发现缺少模糊的填充。填充派生自本表拥有的层级色，因此 alpha 的归属就在这里。

**把 `--dsw-specific-menu` 全局改为半透明。** 该别名是不透明的 layer-3 层级色，被主题包之外的十张样式表用作背景。它因两点而不予采纳：这会一次性把它们全部推向玻璃，包括从不悬浮于内容之上的表面；同时两条回退路径将不再有不透明的层级色可解析。

**固定为仅明色的材质。** 只用 `rgba(255, 255, 255, 0.72)`、没有暗色分支。不予采纳，因为该材质就是主题值：近乎纯白的面板盖在暗色主题的表面上等于忽略主题，而这张表已经按 `body[data-ds-dark-theme]` 为其余下的层级 token 分支（[Web 客户端样式](../../../../docs/web-styling.zh.md#glass-surfaces)）。

## 后果

三个表面现在共享一种材质，alpha、模糊与两条回退目标都只在一处修改。包参考与样式规则面向消费方描述它（[ui-theme README](../../../../packages/client/ui-theme/README.zh.md)、[Web 客户端样式](../../../../docs/web-styling.zh.md#glass-surfaces)）；[样式系统决策](../process/2026-07-19-web-styling-system.zh.md)拥有这些 token 所处的框架。

采用该材质是逐表面选择性加入的，回退也随之而来：消费方写四条声明，且无法选择退出减少透明度——这正是回退要保证的性质。玻璃 elevation 会被 elevation spec 计入，因此玻璃表面不得与中性 border 配对，而描边色仍可按表面重绑。
