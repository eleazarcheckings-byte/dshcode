---
description: "按会话记录的多任务模式：协调者所读到的策略，以及改变它的开关。"
kind: "package-reference"
---

# @saturnai/dsh-orchestrate

[English](README.md) | 中文

## 概述

会话的多任务设置被写入日志，默认为 ON。`/orchestrate [on|off]` 可以更改它；在活跃轮次中做出的更改会在下一个被接受的步骤生效；恢复或分叉会话会保留其日志中的选择。该设置改变的是指引，从不改变工具目录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把 `@saturnai/dsh-orchestrate` 挂载到宿主编排上；编排了命令注册表时 `/orchestrate` 命令随之激活，`@saturnai/dsh-client-ui-orchestrate` 提供撰写区的开关。部署方可以提供非空的 `on` 与 `off` 字符串来替换任一正文。

ON 指导协调者分派独立工作，并给出具体交付物、上下文、互不重叠的文件范围与验证要求；持续性的共享工作优先交给具名团队成员，边界清晰的独立工作交给一次性子代理。随后它点明那条让这套安排值得信任的规则：协调者从不评判自己团队的工作。各部分就位后，合并结果交给 `review_definition_of_done`，由它针对完成定义运行一位全新的评审者；契约凭该评审的会签、或凭一次运行的回执来证明——绝不凭协调者自己对过程的叙述。

OFF 要求代理在单一线程中工作，除非用户明确要求委派，并直言这条会话级指令覆盖长期的"始终编排"姿态。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`orchestrate` 投影以 `init` 为激活状态折叠会话日志，因此空日志上长期姿态成立，只有 `orchestrate/mode` 事件才会关闭它。轮次进行中做出的选择保存在内存里，在下一个被接受的轮内前置步骤提交，这样日志状态不会在请求进行中改变，而段落读取的是"待定或已记录"的值——与计划模式相同的形态。

关闭并不会注销委派工具。按照计划模式的缓存规则，开关前后请求工具目录保持稳定；改变的只是下一次请求所读到的指引。

评审工具的名称在本包中以字面量写出，而非导入。本包只贡献提示文本，为读取一个面向模型的名称而引入对评审包的依赖边没有任何收益；`@saturnai/dsh-review` 拥有该工具及其契约。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [独立评审](../review/README.zh.md)——ON 策略把完成结果送去的评审者。
- [完成定义](../done/README.zh.md)——会签或回执所证明的契约。
- [智能体团队](../agent-team/README.zh.md)——ON 策略在持续性共享工作中优先选用的具名队友。

<a id="model-experience"></a>
## 模型体验

### orchestrate:policy 段落

#### 模型可见内容

由"待定或已记录"的设置从上述两段正文中选出的其中一段，渲染在计划策略之后。两者都是稳定的、部署方拥有的散文，均不随会话数据变化。

##### 该字段的逐字文本（必要时）

```markdown
Multi-task mode is ON for this session. Coordinate substantial work across independent specialists
while making useful progress yourself. When spawn_teammate is available, use named teammates
for work that needs shared tasks, peer messages, or follow-up. Use one-shot subagents for bounded
work with no continuing coordination. Give each delegation a concrete deliverable, relevant
context, disjoint write scopes, and verification requirements. Acquire file claims when available.
Check progress, unblock dependencies, and wait for required teammates before the final response.
You never grade your own team's work. When the pieces are in, hand the combined result to someone
who did not build it: `review_definition_of_done` runs a fresh reviewer against the definition of done and
returns a verdict with its reasons. Prove the contract with the countersign that review returns, or
with the receipt of a run — never with your own account of how it went. Keep trivial reads, direct
edits, and tightly dependent work in the main thread. Parallel work should reduce the time to a
verified result.
```

#### Token 影响

固定：每次请求一段简短正文，对活跃代理始终存在。

#### KV Cache 影响

设置不变时前缀稳定。切换会在下一次请求中替换该段落的 token；提示或工具目录中没有其他内容随之移动。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **这是指引，不是强制。** ON 与 OFF 改变模型所读到的内容；两者都不会收回委派工具，因此设为 OFF 的会话若模型选择委派仍然可以委派。真正的强制存在于证明闸门，而不在此处。
- **评审工具名称以字面量重复了一份。** 它在本包中写出，由 `@saturnai/dsh-review` 拥有；重命名该工具需要同时修改两处，而评审包自己的测试固定了该名称。
- **排队中的切换在落地前不可见。** 轮次中做出的选择在下一个被接受的步骤生效；从未到达该步骤的轮次会沿用先前的策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.zh.md)解释了 ON 策略为何不再让主导者自行评判合并结果。

</details>
