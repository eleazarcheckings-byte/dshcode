# Agent Note：DeepSeek 计价指示灯移至右上角栏

状态：已实现

[English](2026-09-15-peak-lamp-top-rail.md) | 中文

## 问题

DeepSeek API 在低峰时段半价计费，harness 用一枚小小的「高峰 / 低峰」指示灯显示 当前时钟处于哪个计价档。这枚灯原本放在输入框的尾部控制行里、模型选择器旁边。 这样一来，一个关于时钟的固定事实被放进了唯一随会话状态而移动的控件中：空白 首页时居中，会话中沉到底部，SaturnBot 窗口里则不见踪影。izzy 要求把它放到界面 顶部。

## 决定

指示灯属于框架级 chrome，而非输入框 chrome。它现在占据框架右上角栏中的一个 `shell.overlay` 席位（`deepseek-peak`），紧邻 SaturnBot 启动按钮，因此在首页和 每个会话中呈现一致，且永远不随输入框移动。

两个席位在互不知晓对方宽度的情况下共享这条栏：

- 启动按钮已经把自身占位以 `--dsh-shell-trailing-inset` 发布到框架上。指示灯 的席位就停在该内缩处，于是恰好落在启动按钮左侧；若没有挂载启动按钮，它 自己占据角落（沿用启动按钮的 18px）。
- 指示灯测量自身盒子（`ResizeObserver` 跟随标签在计价档切换和语言切换时的 变化），把宽度加 12px 间距发布为 `--dsh-shell-trailing-extra`。会话头部把它 加进右内边距，因此右对齐的头部工具（definition-of-done 芯片）会在栏 chrome 之前止步。两个属性彼此独立，席位可按任意顺序挂载，互不覆盖。

指示灯保留其无障碍形态：单个命名的 `role="img"` 节点，绝不是 live region， 底侧 tooltip 携带下一次切换时间。它按与环境动效控件相同的规则避开 SaturnBot 窗口。`data-peak-rail` 与 `data-peak-chip` 是给测试和移动端样式表的稳定锚点， 后者无法触及哈希化的 CSS module 类名。

## 曾考虑的替代方案

- **占用 `conversation.session.header.utilities` 席位**，与 definition-of-done 芯片 并排。这确实是列顶部，但空白首页会隐藏头部，指示灯会恰好在用户斟酌第一条 消息时消失。否决。
- **在首页再挂一份副本。** 一个时钟两处挂载，两处要保持同步，会话开始时还会 跳动。否决。
- **硬编码 `right: 134px`** 以匹配启动按钮发布的内缩。启动按钮一旦缺席或改变 宽度就失效。否决，改为读取启动按钮已经发布的内缩。
- **由指示灯自己抬高 `--dsh-shell-trailing-inset`。** 启动按钮把该属性设为固定 值，谁最后挂载谁赢，另一方的预留就丢了。用第二个独立属性消除挂载顺序依赖。

## 后果

- 会话头部的右内边距现在依赖两个框架属性。新的栏占位者应同样发布自己的 占位，而不是修改头部。
- 输入框尾部控制行少了一个控件；其余未动。
- 在手机上，右上角是标题条带，因此移动端样式表隐藏该栏（`ui-theme/src/styles/mobile.css` 中的 `[data-peak-rail]`）；席位随之测得 0 宽、不预留任何头部内缩。在条带为它 长出席位之前，指示灯是桌面端的功能。
- 客户端 slot 目录在 `shell.overlay` 上新增 `deepseek-peak` 占位者（用 `pnpm run gen-client-catalog` 重新生成）。

## 文件

- `packages/client/ui-conversation/src/client/skeleton/PeakChip.tsx` — `PeakChip` （指示灯本身不变）加上新的 `PeakRail` 席位与 `PEAK_RAIL_GAP`。
- `packages/client/ui-conversation/src/client/skeleton/PeakChip.module.css` — `.rail` 席位：absolute、`top: 14px`、`right: var(--dsh-shell-trailing-inset, 18px)`， 在启动按钮的 32px 行上居中，`-webkit-app-region: no-drag`。
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` — 指示灯离开 尾部控制行。
- `packages/client/ui-conversation/src/client/apply.ts` — `shell.overlay` 注册 （`order: 110`，排在环境动效控件之后，后者仍是 overlay 的第一个条目）。
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` — 头部右内边距改为 `calc(var(--dsh-shell-trailing-inset, 28px) + var(--dsh-shell-trailing-extra, 0px))`。

## 验证

- `tests/peak-rail.client.spec.tsx`：指示灯在栏内渲染为单个命名图像节点，工作日 窗口内读作 Peak、周末读作 Off-peak，在 `--dsh-shell-trailing-extra` 中预留 `宽度 + 12px` 并在卸载时释放或恢复，并在分钟计时上跟随计价档切换。
- `tests/skeleton.client.spec.tsx`：活动会话的输入框与首页输入框都不再渲染 指示灯。
- `tests/apply-wiring.client.spec.tsx`：`shell.overlay` 依次携带 `ambient-motion` 与 `deepseek-peak`。
- 测试先以 RED 状态提交。声明两处 RED 之后的测试修改，均为机械性改动：分钟计时 用例在 `act()` 之外推进了假时钟，状态更新从未刷新，修改把推进包进 `act()`； 布局桩改为 `vi.spyOn` 以满足 linter。断言未变。第二轮 RED（Mars r1）补上了 零宽度守卫与 SaturnBot 窗口用例。
- 运行时证明：已安装的桌面构建以远程调试端口重新启动后，在首页和会话中都能 看到指示灯位于右上角、紧邻 SaturnBot 启动按钮，definition-of-done 芯片与之 无重叠。
