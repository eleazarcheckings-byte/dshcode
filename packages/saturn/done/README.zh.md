---
description: "按会话维护的完成定义：证明必须凭工具调用回执或独立评审的会签，方可成立。"
kind: "package-reference"
---

# @saturnai/dsh-done

[English](README.md) | 中文

## 概述

一句简短、始终可见的陈述，说明正在构建什么、以及我们凭什么判断它完成了——以及满足它的证明。这让本框架"'完成'意味着被证明"的法则从私下约定变为结构性约束：`stated` 是承诺，`proven` 要求第三方可复核的证据，而修改陈述始终把状态退回 `stated`，因为改变后的契约必须按它自己的标准重新证明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把 `@saturnai/dsh-done` 挂载到宿主编排上，把 `@saturnai/dsh-client-ui-done` 挂载到浏览器半侧。命令与工具子节点只在编排了 `commands` 或 `tools` 注册表时才激活；没有它们时插件仍然折叠状态、仍然给出指引，只是无法从那一侧撰写契约。

| 部件 | 职责 |
|---|---|
| `done` 投影 | 折叠会话日志，使契约在恢复与分叉后依然存在 |
| `done:policy` 段落 | 模型在每次请求中读到契约，或读到"先声明一条"的指令 |
| `/done` 命令 | 人类的直接控制，不消耗模型轮次 |
| `set_definition_of_done` 工具 | 模型撰写并证明契约的唯一途径 |

持久事件有两个：`done/change`——仅日志、非表层、整值替换，在契约被声明前为 `null`；以及 `done/countersign`——一次独立评审的追加式记录。

### 证明闸门

`prove` 不接受执行该工作的代理对自身工作的叙述，它只接受以下两者之一。

- **`receipt`（回执）**——本会话中某次调用的 `tool_call_id`，且其记录结果不是错误：真正发生过的测试运行、构建或冒烟检查。判定依据是会话日志，而不是调用者对日志的描述。报错的调用、尚无结果的调用、未知的 id，以及指向契约工具本身的调用，一律被拒绝。
- **`countersign`（会签）**——[`@saturnai/dsh-review`](../review/README.zh.md) 在独立评审给出 PASS 时签发的令牌。令牌与评审者所读到的那一条确切陈述绑定，因此修改契约即令其作废，而 REVISE 或 REJECT 的令牌会被指名拒绝。

仅有自由文本会被拒绝，并同时列明两条可行路径。`/done prove <evidence>` 处的人类是被接受的——本人为自己的工作背书，是当事人，而不是自我评分的执行者——并且会被如实记录为人工确认，使读者能够区分人工确认与机器复核的证明。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

该投影是 `stateVersion: 2` 的整值替换：已证明的契约现在携带 `proof`，状态模式在拒绝没有 `evidence` 的 `proven` 的同时，也拒绝没有 `proof` 的 `proven`。v1 快照记录的是没有证明来源的 `proven`，不再被折叠。

回执解析会遍历会话自身的事件日志，找到指名该 id 的 `tool/call`，再找到它最后一条 `tool/result`，并从记录的块上读取 `isError`。会签解析同样遍历日志，找到携带该令牌的 `done/countersign` 记录，并在认可它作为证明之前检查结论与被评审的陈述。两种拒绝都会说明什么才管用，因为只会说"不行"的闸门教不会任何东西。

`mintCountersign` 导出给评审包使用，并且追加每一次结论，而不只是通过的那些。这是刻意为之：不留痕迹的 REVISE 会让会话反复重掷评审，直到出现一个绿灯。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [独立评审](../review/README.zh.md)——签发会签的评审者，及其依据的评分量表。
- [完成定义标签](../../client/ui-done/README.zh.md)——渲染契约、来源信息与结论卡片的浏览器半侧。
- [多任务模式](../orchestrate/README.zh.md)——把完成结果送交评审而非自行评判的策略。

<a id="model-experience"></a>
## 模型体验

### done:policy 段落

#### 模型可见内容

依据折叠后的契约，呈现三种正文之一：缺省形态，指示它在开展实质性工作前先声明完成定义；已声明形态，点明两条证明路径并拒绝它对自身工作的叙述；已证明形态，复述陈述与证据，并用一句话点明其所依托的证明，同时告诉模型不要重启已了结的工作。

#### Token 影响

固定且很小：每次请求一段简短正文，对活跃代理始终存在。

#### KV Cache 影响

契约不变时前缀稳定——未改变的契约渲染出完全相同的字符串。声明、修改、证明或清除会在下一次请求中替换该段落的 token。

### set_definition_of_done 工具

#### 模型可见内容

请求目录中的工具条目：`action`、`statement`、`evidence`、带 `tool_call_id` 的 `receipt` 对象，以及 `countersign`。描述中言明模型对自身工作的叙述不被接受为证明，并说明什么才算。结果是最后写入的契约，其中包含对其证明的一行呈现。

#### Token 影响

编排了工具注册表期间，每次请求一份工具模式，另加每次调用的小体量结果。

#### KV Cache 影响

追加式：模式是稳定的前缀贡献，结果像其他工具结果一样被追加。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **回执只能证明某次调用运行过，不能证明它是对的调用。** 闸门检查被引用的工具调用确实存在于本会话且未报错，但无法区分一次测试运行与一次文件写入。评审路径才是强路径，指引中也如实这样说。
- **会签的作用域限于会话。** 在一个会话中签发的令牌无法证明其分叉或恢复出的同辈会话中的契约，因为它所解析的记录存在于原始日志里。
- **人工路径按设计不作校验。** `/done prove` 接受任意证据行；它被记录为人工确认，正是为了让读者永远不会把它误认为机器复核的证明。
- **`stateVersion: 2` 使 v1 快照作废。** 已有的、没有来源信息的已证明契约不再折叠，这符合本仓库对持久格式的预发布立场。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.zh.md)解释了为何持久化的量表词汇存放在此处而非评审包，以及为何人工命令保留自己的证明类别。

</details>
