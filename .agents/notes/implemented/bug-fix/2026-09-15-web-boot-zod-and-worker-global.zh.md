# Agent Note：交付版 Web 启动依赖 design-brain 的 zod 声明与 worker 的 global 别名

Status: implemented

[English](2026-09-15-web-boot-zod-and-worker-global.md) | 中文

## 问题

design-brain 宿主插件生成的 remote（`lib/typert.remote-client.js`）导入了 zod，但包清单从未声明它，于是 pnpm 没有在该包旁落地任何内容，tsdown 在 ui-settings-models 的客户端包里把 `require("zod")` 留成了外部依赖。加载器的模块表无法回答裸的 zod 标识符，因此所有搭建起来的 Web 启动都以 "Failed to load plugins" 失败。打包后的 preview worker 中同一棵树更早失败：design-brain 的 mcp-client 依赖链在导入时求值 cross-spawn/which/isexe，而它们读取 worker 从未安装的 Node `global` 对象。

## 决定

design-brain 在 `dependencies` 中声明 zod `^4.4.3`——与其他所有带生成 remote 的 saturn 包相同的声明——使客户端打包器能解析并内联它。WebWorker 运行时在已有的 process、timer、crypto 与 Buffer 全局旁安装 Node 风格的 `global` 别名（与 `globalThis` 同源），使在模块求值时读取 `global` 的原样 Node 兼容包可以加载，而不是在树激活前抛错。preview 通道继续演练交付版引导流程：showcase fixture 预置已完成的 First Light 与已确认的欢迎声明，交付版提供方提示通过其真实按钮推迟，而该推迟打开的 Models 面板随后被关闭。

## 备选方案

**只补 `global` 而不声明 zod。** 只解决了失败的一半：浏览器包仍会请求加载器无法回答的标识符。

**把 design-brain 排除在 preview 组合之外。** preview 的契约是启动真实的交付树；组合排除只会掩盖漂移，而不是加载这棵树。

**在 preview 通道里走完整个 First Light 流程。** 引导 UX 已有针对真实宿主运行的专用通道；preview 通道负责 worker 启动与 showcase，因此 fixture 预置完成状态。

## 后果

全新安装并构建后，served app 与打包 worker 均可启动。今后任何生成 remote 导入 zod 的包都必须以同样方式声明；该模式即 saturn 包已有的做法。

## 验证

onboarding-deepseek-config、onboarding-usable-provider、ambient-canvas、saturnbot、agent-team-panel 与 preview-boot 各 Web 通道在无密钥重放模式下通过；onboarding 的黄金快照已刷新为改版后的欢迎文案、提供方选择对话框与 Design brain 底部卡片。WebWorker 运行时的 global-alias 测试固定别名同源性，vfs-example fixture 测试逐字节固定预置的 settings.yaml。

## 模型体验

模型可见内容无变化。该修复恢复了插件加载与 worker 兼容层。
