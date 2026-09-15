---
description: "Fleet 路线界面：composer 常驻 dock 中，每个被委派成员对应一条由事实推导的状态行。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-fleet

[English](README.md) | 中文

## 概述

Fleet 以顺序 10 贡献给 `conversation.composer.dock`，在输入框下方保持已委派成员可见，并提供直达每个成员的导航。它把已发布的会话事实——subagent 谱系、待处理交互和后台任务——折叠为每个成员一条状态行；它不拥有独立的运行时状态、传输层或模型可见工具。

## 目录

- [会话中的团队动态](#team-activity-in-the-conversation)
- [数据与导航](#data-and-navigation)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="team-activity-in-the-conversation"></a>
## 会话中的团队动态

Fleet 在 `conversation.composer.dock` 中以顺序 10 注册。在输入框下方显示已委派的成员，并提供直接进入各成员会话的导航。紧凑标题统计实际运行和需要关注的成员数量。前三条路线保持可见；用户可以展开其他路线并再次收起。需要关注的路线位于运行中和已完成的路线之前。

每个成员获得一个由事实推导的状态。待处理的人工交互优先，其后依次是受阻的目标或失败的后台任务、正在运行，以及完成提醒。已停止且没有新状态的成员不显示。没有符合条件的路线时，保留设计好的空状态行。每个状态点都配有文字；计数不包含估算进度、费用或持续时间。

-----

<a id="data-and-navigation"></a>
## 数据与导航

此包折叠 `SessionListState.byId`、`jobsBySession` 和 `useSessionPendingInteraction`。它遍历 subagent 后代，在普通 fork 处停止，并忽略谱系环。阻塞原因读取自成员的目标投影，失败后台任务名称读取自成员的任务列表。同级状态的路线保留谱系顺序。

已知寻址路线时，导航使用 `sessions.subagentAddress(id)` 和 `openSubagent(address)`，否则使用 `sessions.open(id)`。浏览器导出通过共享的 slot 和语言服务注册。Host 导出不执行操作；此包没有配置、传输、持久状态或模型可见工具。

-----

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/client/ui-fleet` 验证状态优先级、谱系遍历、空输出、无障碍路线名称、导航、关注事项汇总和成员列表展开。

**运行时不变量：** 不发布配套检查器，因为此包没有独立运行时状态；其路线由现有会话读取模型推导。

-----

<a id="model-experience"></a>
## 模型体验

### composer dock 展示

#### 模型可见内容

无。Fleet 读取会话、目标和任务服务已发布的 `SessionListState.byId`、`jobsBySession` 与待处理交互事实，并将其渲染为导航路线；它不引入任何自己的提示词、工具 schema 或工具结果。

#### Token 影响

无。此 dock 是浏览器渲染的摘要；它计算或展示的任何内容都不会被复制进模型请求。

#### KV Cache 影响

无。选择某条路线只会改变浏览器中当前打开的会话，不会改变任何组装后的请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 默认只显示前三条路线，其余会被收起；用户必须展开 dock 才能看到完整成员列表，且没有可更改该默认数量的设置。
- dock 没有实时推送订阅；它只会在拥有方服务已发布的状态变化上重新计算，因此不触及这些读取模型的事实变化不会立即体现，要等到下一次触发。
- 展开/收起偏好不会跨会话持久化。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
