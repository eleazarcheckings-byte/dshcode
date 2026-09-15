---
description: "Saturn 组地图：Agent Teams、检查点、claims、design-brain 连接器、definition of done、多任务编排与 SaturnBot，供用户与维护者浏览此组。"
kind: "package-group"
---

# packages/saturn

[English](README.md) | 中文

## 概述

Saturn 组承载 harness 中带有 Saturn AI 品牌的增量部分：具有持久邮箱和共享任务 DAG 的同伴消息 Agent Teams、内容寻址的 workspace 检查点、在第一次编辑之前就拒绝冲突写入的、带 TTL 租约的 claims 账本、可选启用的 SaturnAI 设计评审连接器、按会话的 definition of done、始终开启的多任务编排，以及 SaturnBot——一个持久化的、角色约束的自主操作员。此处每个包都以 `@saturnai/dsh-*` 为作用域；它们在浏览器端的展示对应物（`ui-agent-team`、`ui-done`、`ui-fleet`、`ui-orchestrate`、`ui-saturnbot`、`ui-brand-saturn`、`ui-skin-saturn`）与其他所有 UI 插件一起位于 [`client/`](../client/README.zh.md) 之下。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`agent-team`](agent-team/README.zh.md) | 隐式根 Agent Teams 成员列表、持久同伴邮箱与共享任务 DAG | `ctx.agentTeams` |
| [`tool-agent-team`](tool-agent-team/README.zh.md) | 覆盖 `ctx.agentTeams` 的、限定作用域的面向模型 Agent Teams 工具 | 无服务 key |
| [`checkpoints`](checkpoints/README.zh.md) | 会话级代码检查点：内容寻址快照、`checkpoints` 投影与 `/checkpoint` 恢复命令 | 无服务 key |
| `claims` | 强制执行的 workspace claims：记录哪个 agent 拥有哪个文件表面的、带 TTL 租约的持久账本（README 尚无中文版） | 无服务 key |
| [`design-brain`](design-brain/README.zh.md) | 可选启用的 SaturnAI MCP 连接，具有持久偏好和经验证的 Host 工具可用性 | `ctx.designBrain` |
| `done` | 按会话的 definition of done：`done` 投影、`done:policy` 提示词片段、`/done` 命令与 `set_definition_of_done`（README 尚无中文版） | 无服务 key |
| `orchestrate` | 已记录的按会话多任务（始终编排）模式：`orchestrate` 投影、其策略提示词片段与 `/orchestrate` 命令（README 尚无中文版） | 无服务 key |
| [`saturnbot`](saturnbot/README.zh.md) | 持久化的、角色约束的 SaturnBot 执行周期、批准流程与类型化业务工具 | `ctx.saturnbot` |

-----

<a id="related-documentation"></a>
## 相关文档

- [`client/`](../client/README.zh.md)——Web GUI 浏览器半侧，包含此组每个服务对应的 Saturn 品牌 `ui-*` 展示包。
- [packages/AGENTS.md](../AGENTS.md)——包约定：导出、服务访问、不变式与测试。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
