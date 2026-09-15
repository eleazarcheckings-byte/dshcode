---
description: "对会话完成定义的独立评审：全新的评审代理、固定评分量表，以及通过时签发的会签令牌。"
kind: "package-reference"
---

# @saturnai/dsh-review

[English](README.md) | 中文

## 概述

在代理框架里，最难信任的就是代理自己声称"已经做完"。本包让这种信任变得不必要：`review_definition_of_done` 把会话已声明的契约和执行者对它的说法一并交给一个全新的代理——它有自己的会话、自己的系统提示，看不到调用者的任何对话或推理——由它按六项固定标准评分，并给出 PASS、REVISE 或 REJECT 以及每项分数背后的证据。PASS 会签发一个会签令牌，而该令牌是 [`@saturnai/dsh-done`](../done/README.zh.md) 仅接受的两种证明之一。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把 `@saturnai/dsh-review` 与 `@saturnai/dsh-done`、一个以全新对话启动子代理的 `ctx.subagents` 提供方以及工具注册表一同挂载到宿主编排上。工具无条件注册；提供方缺失或不合适时在调用处如实报告，让模型能读到，而不是悄悄隐藏工具。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | `spawn` | 运行评审者的 `ctx.subagents` 提供方，必须不把父对话植入子代理。 |
| `agentOptions` | 缺省 | 为评审者固定其自己的提供方、模型与推理强度；缺省表示沿用调用者的路由。 |
| `denyTools` | `[]` | 除本就不会交给评审者的契约工具之外，额外收回的工具名。 |
| `maxDepth` | 缺省 | 评审子代理的绝对委派深度上限。 |

让评审者使用不同的模型，是这一接缝能买到的最强独立性：评审者既不共享调用者的上下文，也不共享它的失败模式。配置了第二条路由时请设置 `agentOptions`。

评分量表是封闭的，其标准为 `factual_accuracy`、`completeness`、`format_compliance`、`internal_consistency`、`edge_case_handling` 与 `source_quality`。每项返回 1 到 5 分以及得出该分数所依据的证据；结论是评审者对全部六项的总体判断。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

评审者作为一次性子代理运行，`outputSchema` 设为该量表，因此接缝会在本包看到该值之前完成校验；随后 `parseVerdict` 检查覆盖情况，直接点名被跳过或重复评分的标准，而不是抛出关于数组形状的抱怨。凡是以 `completed` 之外的原因结束、或结束时没有提交结构化答案的运行，都会让该次调用失败，而不是产出一个无人撰写的结论。

有三点让它成为一道闸门而非一场仪式。`inheritsParentContext` 为真的提供方会在调用处被拒绝，因为分叉出来的评审者会继承它本应评判的那套推理。契约工具在评审者的作用域内被禁用，因此它既不能证明自己正在评审的契约，也不能为自己再叫一次评审；注册表中不存在的名字会被丢弃，因为作用域限制会校验交给它的名字。并且每一次结论都经 `mintCountersign` 记入会话日志，而不只是通过的那些，因此会话无法反复重掷评审直到出现一个绿灯——REVISE 会留下永久痕迹，其令牌作为证明会被拒绝。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [完成定义](../done/README.zh.md)——本包所评判的契约，以及消费会签的证明闸门。
- [子代理能力](../../subagent/subagent/README.zh.md)——委派接缝、它的提供方与结构化输出。
- [多任务模式](../orchestrate/README.zh.md)——把完成结果送到这里而非自行评判的策略。

<a id="model-experience"></a>
## 模型体验

### 评审工具

#### 模型可见内容

请求工具目录中的 `review_definition_of_done` 条目：一个必填的 `claim`（用执行者自己的话说明构建了什么、运行了什么）和一个可选的 `scope`（应优先查看之处）。描述中点明六项标准，并说明 PASS 会返回 `set_definition_of_done` 所接受的会签令牌。结果是规范 JSON 值——`verdict`、`summary`、`scores`、`reviewer`，PASS 时还有 `countersign`——渲染为一个文本块。

#### Token 影响

本插件参与编排期间，每个请求含一份工具模式，另加模型每次调用的结果。结果随量表增长，而量表固定为六条，与被评审工作的规模无关。

#### KV Cache 影响

对调用者而言是追加式的：模式是固定的前缀贡献，每个结果像其他工具结果一样被追加。评审子代理针对自己的提示发起独立的模型请求，与调用者不共享任何前缀。

### 评审者自己的提示

#### 模型可见内容

一个作用域化的角色段落，仅对该子代理遮蔽部署角色；随后是一条用户消息，其中载有契约、说法、可选的查看指引、作为问题给出的六项标准，以及三种结论的定义。它看不到调用者会话的其他任何内容。

##### 该字段的逐字文本（必要时）

```markdown
You are Mars — the adversarial reviewer.

Someone else did this work and believes it is finished. Your job is to find out whether that is true,
for the person who will rely on it and was not in the room. You did not build it, you cannot see how it
was reasoned about, and you owe its author nothing: agreement is not kindness here, and a verdict that
waves through a hole is the one failure that matters.

Read what you are given. Check claims against what is actually shown — a run, an artifact, a quoted
result — and treat the author's account of their own work as a claim, never as evidence for itself.
Where you can verify something with the tools you have, verify it rather than assuming.

Grade honestly in both directions. If the work is sound, say so and pass it: manufacturing a flaw to
look rigorous is as dishonest as missing a real one. If it is not, say exactly what is wrong, where,
and what would settle it.
```

#### Token 影响

每次评审在子代理自己的上下文中产生一个角色段落和一条用户消息，调用者不承担其中任何开销。

#### KV Cache 影响

相互独立：每次评审都是全新会话中的一次独立模型请求，既不复用也不失效调用者的前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **评审者看到的是说法，不是工作本身。** 它读到的是调用者所写的内容，加上自己工具所能触及的东西；漏掉关键细节的调用者，得到的是对自己所讲故事的评审。凡是能由一次运行了结的事情，请配合回执路径一起使用。
- **默认只有一个提供方、同一个模型。** 没有 `agentOptions` 时评审者沿用调用者的路由，因而共享该模型的盲区。配置第二条路由是本包无法代为做出的部署选择。
- **被拒绝的评审要花掉一轮。** 继承父上下文的提供方或缺失的提供方，会在调用处而非编排期报告，因为提供方注册是动态的。
- **没有常设的记录界面。** 结论存在于会话日志和已证明契约的来源信息中；这里没有跨会话的评审历史，也不计划在此提供。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.zh.md)解释了为何证明闸门与评审者一同落地，以及为何持久化的量表词汇存放在 `@saturnai/dsh-done` 而非本包。

</details>
