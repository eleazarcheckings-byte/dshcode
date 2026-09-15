---
description: "跨 agent session 的强制 workspace 文件归属：持久 TTL 租约、拒绝冲突写入，以及能读懂 shell 命令的守卫。"
kind: "package-reference"
---

# @saturnai/dsh-claims

[English](README.md) | 中文

## 摘要

`@saturnai/dsh-claims` 让文件归属成为锁，而不是彼此的客气。agent 在写入之前，为它将要修改的确切文件或目录前缀取得租约；任何其他 session 试图写入这些路径时，都会在第一个字节落盘之前被拒绝——既包括第一方的 `write`、`edit`、`str_replace_editor` 工具，也包括参数中指名文件的 `bash`、`pwsh` 和 `terminal` 命令。ledger 存放在 `<DSH_HOME>/claims/ledgers`，位于所有工作树之外，因此租约比取得它的 session 更长寿，两个进程操作同一仓库时读到的也是同一份字节。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

只要部署中可能有多个 agent 写同一个 workspace，就挂载它：并行 teammate 组成的 Team、由多个会话分别驱动同一仓库不同单元的场景，或者仅仅是一个希望在动手前先声明界面的单 agent。它注入 `tools` 与 `systemPrompt`，在有 `fs` 时使用它，且无需任何配置。

### 协议

`claim_scope` 为具名 lane 取得 workspace 相对前缀的独占权；与现存 claim 重叠即被拒绝（DENIED），且不会取得任何东西。`claim_check` 重新 stat claim 的文件并报告发生位移的项，使持有者在写入前重新基线化，而不是写出几分钟前读到的缓冲区。`release_scope` 在该单元验证通过后立即释放 lane；`claim_list` 展示每个在册持有者及其剩余租期。租约默认两小时后自行失效，session 被释放时也会释放其持有的全部 claim。

### 强制了什么

同伴的活跃 claim 会在派发之前拒绝会修改文件的第一方工具调用，并且 ledger 事务贯穿该次派发，因此别的进程无法在检查与写入之间抢走该 scope。shell 调用则按其参数能够证明的内容扫描：输出重定向的目标，以及以修改文件为目的的命令的操作数（`rm`、`mv`、`cp`、`tee`、`sed -i`、`git checkout`、`Set-Content`、`Remove-Item` 及同类）。读取从不被阻断，而且 shell 检查会在命令运行前释放 ledger——一次构建若持有跨进程锁，会在其整个时长里拖住其他所有 session 的 claim。

### claim 空间

claim 命名的是仓库中的界面，而不是仓库某一个检出中的界面。当 session 的工作目录是链接的 `git worktree` 时，其 claim 会记录在该仓库主 worktree 下的对应目录上，因此所有检出共享同一个 ledger 与同一组 lane。正是这一点让被隔离的 Agent Teams teammate 既能与团队其余成员协调，又能把自己的文件留在自己手里：在自己的检出里它自由写入，而共享界面仍然有主。

<a id="understand-the-implementation"></a>
## 理解实现

`ledger.ts` 负责算术——scope 规范化、按路径分量比较的重叠判定、过期，以及工具渲染的视图。`store.ts` 负责持久性：每个 workspace 一份 JSON 文档，在跨进程写者锁下原子替换；只有当锁记录的属主可被证明已消失时，等待者才可以打破它。`write-guard.ts` 与 `shell-guard.ts` 是 `tools/execute` 总线上的两个强制点。`workspace.ts` 依据 git 自身的 `commondir` 记录解析 claim 空间，凡是读不到的情况都回退为目录本身。`service.ts` 发布 `ctx.claims`，为代表他人写入 workspace 的 host 代码提供只读接口——Agent Teams 的 `merge_teammate` 正是通过它询问传入 diff 中哪些路径已被同伴占有。

<a id="model-experience"></a>
## 模型体验

### claim 工具与常驻协议

#### 模型看到什么

一段常驻 policy 段落把协议写成可执行的规则：首次编辑前先 `claim_scope`，每次写入前先 `claim_check`，验证后即 `release_scope`，一个界面只有一个写者，以及 shell 命令不是绕开拒绝的方法。拒绝信息会指出持有者、lane、claim id、剩余分钟数以及被阻断的确切路径，然后说明应当怎么做——请求移交、收窄 scope，或等待租约到期。

#### Token 影响

四个紧凑工具，加上约 350 token 的 policy 段落。工具结果是单行 JSON；一次拒绝只花费几十个 token，取代的却是"两个 agent 互相覆盖"这一昂贵得多的事后发现。

#### KV Cache 影响

policy 段落是静态的，与其他常驻段落一起位于 prompt 前缀中，因此随前缀一同缓存。claim 结果作为普通工具结果到达，绝不会重写此前的轮次。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- shell 命令只在其参数能够表明的范围内受到守卫。formatter、代码生成器、构建脚本，或从程序内部写文件的解释器，都超出静态阅读的范围，仍需显式协调；policy 禁止用它们来绕开拒绝。
- scope 是目录前缀或确切文件名，从不是 glob。shell 命令中的 glob 会先被收窄到其字面父目录再做检查。
- claim 漂移通过修改时间与大小观察。目录元数据无法察觉每一处后代改动，陈旧文件内容的检查仍由文件系统观察策略负责。
- claim 空间对每个目录只解析一次并在进程生命周期内缓存，因此若某仓库在 harness 运行期间才变成链接 worktree，它在重启前仍沿用先前的 ledger。
- 第一方守卫在派发期间持有 ledger 锁，因而在一个 workspace 内串行化受保护的修改。shell 守卫刻意不这么做，代价是留下一个很窄的窗口：检查期间新取得的 claim 会被漏掉。

<a id="dev-note"></a>
### 开发者说明

[运行时决策](../../../.agents/notes/implemented/bug-fix/2026-09-14-saturn-team-file-ownership.zh.md)记录了最初的权衡，[worktree 隔离](../../../.agents/notes/implemented/feature/2026-09-15-agent-team-worktree-isolation.zh.md)记录了 ledger 为何改为以仓库为键。本包不发布运行时 invariant 安装器：ledger 事务与两个派发守卫在每次修改处强制该关系，行为测试直接覆盖被拒绝的写入。
