---
description: "完成定义标签：会话标题栏中的契约、它的来源信息，以及点击后展开的评审结论卡片。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-done

[English](README.md) | 中文

## 概述

会话标题栏中的一个工具位，用一行承载当前契约；点击之后展开完整记录——陈述、证据、来源信息、独立评审的结论卡片、本轮回执，以及还原可以恢复的检查点。法则说"'完成'意味着被证明"；正是在这里，它不再是代理的私事，而成为读者可以核查的东西。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在浏览器半侧挂载本包，与宿主侧的 `@saturnai/dsh-done` 配对。它占用已声明的 `conversation.session.header.utilities` 列表位，通过标准套件的 `useProjection` 读取 `done` 投影、通过 `useConversation` 读取 Chat 目标的时间线，并且每个动作都作为 `/done` 命令经 `remote.commands.execute` 执行——因此界面控件与斜杠命令是同一条路径、同一条被记录的结果行。

| 状态 | 圆环 | 标签 | 标签行 |
| --- | --- | --- | --- |
| `stated` | 空心 | `STATED`（描边） | 陈述 |
| `proven` | 实心 | `PROVEN`（填充） | 陈述 · 证据 · 来源信息 |

已证明的契约绝不只显示"已证明"这个词。标签在状态旁边携带来源信息：由一次运行证明的显示 `回执 <工具>`，由独立评审通过的显示"已会签"，命令处的人工确认显示"由你确认"。已会签的契约会在面板中展开评审者的完整量表：盖章的结论、评审者是谁、其总结，以及每项标准一行的分数与其所依据的证据。

没有已声明契约、但存在可供还原的检查点的会话仍保留该位置，转而显示检查点标题。两者皆无的会话则不渲染任何内容。

陈述以 `/done -- <statement>` 写入；`--` 转义保持措辞的字面性，因此以 `clear`、`prove` 或 `edit` 开头的契约永远不会被当作控制词。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

标签的尺寸对齐标题栏自身的控件——最小 28px、12px 文字——并且只有一行且带省略号，因此绝不会撑高该栏；在 720px 以下，陈述与来源信息会隐去，只留圆环、标签与折叠箭头。记录面板是固定 380px 的玻璃表面，绘制在传送门中并相对标签定位，因此标题栏自身的裁剪与堆叠无法将其切断；面板外的指针、Escape 或标签本身都会关闭它。Escape 会把焦点交回标签，除非内联编辑器正持有焦点。

结论卡片在构造上就是呈现性的：它所绘制的一切都来自 `done` 投影已经携带的持久证明，因此它不做任何自己的读取，也不可能与状态栏产生分歧。它唯一的动效是一次断言而非装饰——在 PASS 时，签名圆环以本产品的 -18° 倾角、用 `currentColor` 自绘一次；在降低动效偏好下，它直接就是画好的状态。

`provenance` 是标签与面板共用的纯函数，因此两处界面绝不可能对同一份证明给出不同的描述。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [完成定义](../../saturn/done/README.zh.md)——宿主半侧：投影、策略段落、命令与证明闸门。
- [独立评审](../../saturn/review/README.zh.md)——本卡片所渲染量表的来源评审者。
- [检查点](../../saturn/checkpoints/README.zh.md)——折叠进同一面板的还原行。

<a id="model-experience"></a>
## 模型体验

### 为读者渲染的契约状态

#### 模型可见内容

本包不贡献任何内容。契约面向模型的每一处界面都属于 `@saturnai/dsh-done`：`done:policy` 段落、`set_definition_of_done` 模式，以及 `/done` 命令的结果。本包为人类绘制同一份持久的 `done` 投影，自身不注册任何提示段落、工具或工具结果。

#### Token 影响

零直接 token 影响。来源信息行与结论卡片读取的是宿主已经携带的状态，因此渲染它们不会给任何请求增加内容。

#### KV Cache 影响

相互独立：这里不产生任何请求 token，因此本包渲染的任何内容都不会使前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **结论卡片展示的是评审，而不是工作本身。** 它渲染评审者所记录的内容；想看底层运行的读者仍需前往对话记录。
- **状态栏中的来源信息会被截断。** 过长的工具名会以省略号收尾，以保持标题栏单行；完整文本在面板中以及标签的悬停提示里。
- **面板是固定的单列。** 380px 使它绝不撑宽标题栏，同时也意味着过长的量表证据行会换行而不是变宽。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/architecture/2026-09-15-proof-gated-done.zh.md)解释了为何单独一个"已证明"被判定为过弱的主张，以及来源信息的词汇归属何处。

</details>
