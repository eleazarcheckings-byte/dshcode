---
description: "会话级代码检查点：在一个 turn 即将修改文件之前生成内容寻址快照，并提供一条命令即可完成的恢复。"
kind: "package-reference"
---

# @saturnai/dsh-checkpoints

[English](README.md) | 中文

## 概述

会话级**代码检查点**：在一个 turn 即将修改文件之前生成内容寻址快照，并提供一条命令即可完成的恢复，把文件放回原状。agent 工作中具有破坏性的那一半，恰恰是人类无法提前看见的那一半，因此每个会修改 workspace 的 turn 都会在第一次修改落地**之前**打开一个检查点，并且每次恢复都会先记录它即将覆盖的状态——这正是恢复本身可撤销的原因。

## 目录

- [本包拥有什么](#what-this-package-owns)
- [两套刻意共享的词汇](#the-two-vocabularies-deliberately-shared)
- [为什么恢复是安全的](#why-a-restore-is-safe)
- [组合方式](#composition)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="what-this-package-owns"></a>
## 本包拥有什么

| 部件 | 角色 |
|---|---|
| Blob 存储 | `<DSH_HOME>/checkpoints/blobs/<ab>/<sha256>`——内容寻址，位于用户仓库之外 |
| 持久目录 | 会话日志中的 `checkpoints` 投影（路径 + 每个文件一个 sha-256） |
| 捕获 | 包裹 `tools/execute`；记录 `write`、`edit` 以及具有修改性质的 `str_replace_editor` 目标 |
| 恢复 | `/checkpoint restore <id>`——校验整套计划、记录当前状态，然后写入 |

记录检查点从不弄脏工作树、出现在 diff 中或进入提交：只有内容哈希和相对 workspace 的路径进入会话日志，字节内容存放在 harness home 之下。线上取值是有界的（{@link MAX_WIRE_CHECKPOINTS} 条最新摘要）；折叠会保留每一个检查点，因此 `/checkpoint` 仍可恢复更早的一个。

-----

<a id="the-two-vocabularies-deliberately-shared"></a>
## 两套刻意共享的词汇

捕获精确记录 turn 回执所展示的路径：第一方的 `write`、`edit` 以及具有修改性质的 `str_replace_editor` 调用。Shell 重定向和第三方写入者不在这套词汇之内，也不在此功能范围内，因此回执与检查点不会对某个 turn 究竟做了什么产生分歧。

turn 是两个界面共同使用的单位。检查点绑定到会话日志中已打开的 turn，因此 turn 之外的工具活动（一次命令派发、一个被委派的子任务）不会记录任何内容。

-----

<a id="why-a-restore-is-safe"></a>
## 为什么恢复是安全的

- **整体计划式拒绝。** 每个记录的路径都会在实时 workspace 根目录下重新解析并重新守卫。在另一个目录中记录的检查点、现在会经过 `node_modules` 或 `.git` 的路径，或者恰好*是*已安装应用的 workspace，都会整体拒绝恢复——绝不会部分执行。
- **写入前先校验。** 每个记录的 blob 必须仍然存在、必须仍能哈希出其地址、必须仍保持记录的长度；记录为 `absent` 的路径不得已变成目录。
- **绝不涉及记录集合之外的内容。** 恢复只写入记录的文件，并删除记录中标记为不存在的文件。它绝不删除其他任何内容，捕获无法记录的路径会被报告为保持不变。
- **原子写入。** 每个文件都通过 `@deepseek-ai/dsh-atomic-write`（先暂存、再重命名）替换，因此读取者要么看到旧字节，要么看到记录的字节，绝不会看到写到一半的文件。
- **可撤销。** 恢复前的检查点会记录本次恢复即将触及的那些路径的当前字节，其 id 会打印在结果中。

-----

<a id="composition"></a>
## 组合方式

在 host 名册上挂载 `@saturnai/dsh-checkpoints`。命令仅在组合了 `commands` 注册表时才会挂接；捕获钩子本身就是插件的一部分。客户端通过 definition-of-done 卡片的检查点行（`@saturnai/dsh-client-ui-done`）读取 `checkpoints` 投影，因此不会有第二张卡片加入 composer dock。

-----

<a id="model-experience"></a>
## 模型体验

### 修改性工具的捕获

#### 模型可见内容

提示词或工具 schema 中没有任何新增内容。捕获作为前置钩子搭在既有的 `tools/execute` 上，覆盖现有的 `write`、`edit` 和具有修改性质的 `str_replace_editor` 调用；模型自身收到的工具结果不变，`/checkpoint` 命令是面向人类的界面，模型从不会主动发出它。

#### Token 影响

零。捕获写入一个内容寻址 blob 和一条 `checkpoints/change` 日志条目；两者都不会进入组装后的提示词。恢复结果行（id 与受影响路径）只有在人类把它转述回对话时，模型才会看到。

#### KV Cache 影响

没有直接影响：这里的任何操作都不会改变请求流。如果一次恢复还原了后续 turn 将要读取的那些文件，会改变随后工具调用的返回内容，这只是普通的、会打断缓存的内容变化，并非检查点特有的效应。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 检查点只覆盖第一方修改工具命名的文件。由 shell 命令、构建步骤或 workspace 之外路径写入的文件不会被记录，也无法被恢复。
- 超过捕获预算（4 MiB）的文件会被记录为已跳过，恢复时会保持不变，而不会被整体读入内存。
- 存储是按机器隔离且从不清理的：检查点会在 harness home 下持续累积，直到有人手动移除。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
