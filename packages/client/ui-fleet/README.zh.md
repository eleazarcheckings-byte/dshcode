# @saturnai/dsh-client-ui-fleet

[English](README.md) | 中文

## 会话中的团队动态

Fleet 在 `conversation.composer.dock` 中以顺序 10 注册。在输入框下方显示已委派的成员，并提供直接进入各成员会话的导航。紧凑标题统计实际运行和需要关注的成员数量。前三条路线保持可见；用户可以展开其他路线并再次收起。需要关注的路线位于运行中和已完成的路线之前。

每个成员获得一个由事实推导的状态。待处理的人工交互优先，其后依次是受阻的目标或失败的后台任务、正在运行，以及完成提醒。已停止且没有新状态的成员不显示。没有符合条件的路线时，保留设计好的空状态行。每个状态点都配有文字；计数不包含估算进度、费用或持续时间。

## 数据与导航

此包折叠 `SessionListState.byId`、`jobsBySession` 和 `useSessionPendingInteraction`。它遍历 subagent 后代，在普通 fork 处停止，并忽略谱系环。阻塞原因读取自成员的目标投影，失败后台任务名称读取自成员的任务列表。同级状态的路线保留谱系顺序。

已知寻址路线时，导航使用 `sessions.subagentAddress(id)` 和 `openSubagent(address)`，否则使用 `sessions.open(id)`。浏览器导出通过共享的 slot 和语言服务注册。Host 导出不执行操作；此包没有配置、传输、持久状态或模型可见工具。

## 模型体验

无。此包读取已发布的会话事实，仅改变所选会话。它不直接影响 KV Cache。

## 验证

`pnpm exec vitest run packages/client/ui-fleet` 验证状态优先级、谱系遍历、空输出、无障碍路线名称、导航、关注事项汇总和成员列表展开。

**运行时不变量：** 不发布配套检查器，因为此包没有独立运行时状态；其路线由现有会话读取模型推导。
