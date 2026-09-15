---
description: "在 SaturnAI 协作控制台中检查 Team 活动、任务依赖和共享工作。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-agent-team

[English](README.md) | 中文

## 概述

会话标题栏中的 Team 操作打开支持键盘操作的协作控制台对话框：画布视图展示成员列表与依赖关系图，看板视图展示每个任务的状态。它通过生成的 `ctx.remote.agentTeams` 读取权威 Team 成员列表和共享任务看板。Client 包只负责展示和临时表单状态；它不注册模型可见输入，也不在现有 Remote 操作之外写入 Team 状态。

## 目录

- [协作控制台](#mission-control)
- [刷新与交互](#refresh-and-interaction)
- [组合](#composition)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="mission-control"></a>
## 协作控制台

画布为每位成员显示一个节点，并把 lead 放在中心。节点包含分配给该成员的未完成任务的精确数量。实线表示 lead 成员关系；虚线表示分配给不同成员的任务之间尚未解决的依赖。运行中的成员显示沿圆周移动的指示点。成员列表的悬停和键盘焦点会突出对应节点。普通成员按钮和任务说明提供等价的无障碍内容，并通过稳定的寻址 subagent 路径导航。

看板显示已完成任务占全部未删除任务的精确数量，不估算未完成任务的百分比。筛选器选择全部、未完成、需要关注或已结束的任务。需要关注的任务包括先决条件未解决的待处理任务，以及具有写入范围警告的未完成任务。每个任务保留其状态、负责人、依赖名称、标识、范围、警告和现有修改控件。

-----

<a id="refresh-and-interaction"></a>
## 刷新与交互

对话框在打开、观察到成员运行状态变化、返回窗口、显式刷新和修改成功后刷新。文档隐藏时，不因活动变化刷新。刷新携带会话和请求代次，防止旧响应覆盖较新的工作。浏览器没有任务事件订阅或定期轮询：页脚明确说明刷新行为，手动刷新可以取得不影响成员运行状态的更改。

任务创建、编辑、分配、取消分配、完成、重开和删除使用当前修订号。发生冲突时，先重新加载权威状态，再显示冲突提示。文本或范围编辑和依赖变更保留各自顺序执行的比较并交换操作。输入框有可见标签，模态框限制 Tab 导航范围，Escape 关闭对话框，关闭时焦点返回触发按钮。

画布仅为运行中的成员播放动画，并限制帧频。减少动态效果偏好会保留静态图。文档可见性、画布相交状态和卸载会停止动画；尺寸变化和恢复可见会重新绘制当前事实。小屏幕使用完整的 HTML 成员列表和看板，不显示画布。

-----

<a id="composition"></a>
## 组合

已发布的 `@saturnai/dsh-web-app` bundle 默认挂载本包：它的 patch 声明 `ui-agent-team` 行，因此 Web composition 会自动包含该面板，不存在需要额外添加的独立 Web profile 层。Host 导出不执行操作。浏览器入口挂载生成的 Remote 描述符，并通过可释放的 Cordis effect 注册语言字典和标题栏 slot。此包没有配置字段。[晋升记录](../../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md) 说明包位置、发布族与依赖隔离。

-----

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/client/ui-agent-team` 覆盖 Remote 注册、任务比较并交换竞争、导航、看板筛选、模态框焦点、精确总数、确定性依赖投影和画布资源归属。应用 Web 冒烟测试和回放套件验证浏览器组合。

**运行时不变量：** 不发布配套检查器。Remote 保持权威；UI 仅拥有可释放的展示资源和本地查看状态。

-----

<a id="model-experience"></a>
## 模型体验

无，因为浏览器端投影和任务控件不注册任何模型可见输入；Team 工具（`@saturnai/dsh-tool-agent-team`）和普通会话提交负责此处任务变更之后的每一个模型可见效果。

#### KV Cache 影响

没有直接影响。通过此对话框完成的任务修改可能改变之后 Team 工具读取所返回的内容，这只是下游普通的内容变化，并非此包自身注册所带来的效应。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 画布是浏览器本地的可视化，跨会话没有持久化的布局、缩放或平移状态。
- 没有实时任务事件订阅，因此另一个标签页中同伴的编辑只能在[刷新与交互](#refresh-and-interaction)所列的刷新触发点上体现，永远不是即时的。
- 小屏幕会回退到不含画布的 HTML 成员列表和看板；依赖关系图本身没有非画布的呈现方式。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
