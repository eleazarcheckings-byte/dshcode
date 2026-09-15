# Agent Note：终端守卫不再猜测自己的 shell，隔离队友与 Lead 站在同一层

Status: implemented

[English](2026-09-15-claims-terminal-dialect-and-worktree-subdirectory.md) | 中文

## 问题

两个狭窄的缺口击穿了 worktree 隔离本该提供的守卫，而且两个都是静默的。

认领写入守卫的 shell 一半，是用 `process.platform` 来决定用哪种词汇表去读一行 `terminal_send`。终端承载的是会话当时打开的那个 shell，Windows 上的 Git Bash 与 POSIX 上的 `pwsh` 一样寻常，于是在每一台 Windows 主机上，整张 POSIX 变更命令表都不会被查阅：在终端里敲下的 `sed -i`、`truncate`、`tee`、`patch`、`dd`、`ln`、`chmod` 会毫无阻拦地落到同伴已认领的文件上；在 POSIX 主机上的 PowerShell 会话则是镜像的缺口。重定向仍然被拦住——正是这一点让缺口难以被察觉。

另一处，`git worktree add` 检出的是整个仓库，而隔离队友被交到手上的永远是检出的**根**，不管它的 Lead 站在哪里。认领是按 workspace 记录的，所以一个会话位于 `<repo>/app` 的 Lead 向账本询问的是 `<repo>/app`，而它队友的租约却记在 `<repo>` 之下。两者永不相遇：队友的认领对 `merge_teammate` 不可见，于是合并报告"无冲突"并直接覆盖过去。本该防止工作丢失的功能，反而制造了工作丢失。

## 决定

`ShellCall` 携带的是 `dialects` 而不是单个 `dialect`。专用工具只指明一种，因为它的可执行文件是事实——`bash` 跑的就是 bash，`pwsh` 跑的就是 PowerShell。终端两种都指明，守卫取两种读法所得写入目标的并集。代价是偶尔会为一个在另一种 shell 里毫无意义的名字多问一句；而猜测的代价是同伴的文件。

`WorktreeManager.checkoutWorkspace()` 按仓库相对深度把 Lead 的 workspace 映射进检出，并在基线提交中缺少该目录时创建它。roster 把这个目录而非检出根交给子会话，于是它的认领空间——通过既有的链接 worktree 映射——解析到 Lead 询问的同一个 `<repo>/<sub>`。检出根仍留在 roster 行上，因为收集与移除操作的仍是整个检出。

## 备选方案

**从终端后端配置探测它的 shell。** `terminal-bash` 确实记录了 `shellDialect`，但守卫位于工具总线上，手里只有一个会话 id，拿不到打开它的后端，而这里答错就是放行。两种词汇表都读，不需要任何查找，也不会放行失败。

**让 bash 与 pwsh 也取并集。** 它们的方言不是猜测，扩大范围会让 PowerShell 别名（`sc`、`ni`、`si`）——在 POSIX 上是寻常的程序名——被拒绝。这份歧义只属于终端。

**让所有会话都按仓库根记账本。** 这样确实能通过抹掉区分来消除分裂，但也会把两个刻意工作在同一仓库不同子目录的 agent 的账本合并——为一个只有隔离才会产生的情形，改变每一位现有用户的行为。

## 后果

指向同伴已认领路径的终端命令行，在每个平台上都被拒绝。工作在仓库根之下的 Lead 与其隔离队友共享同一个认领空间，于是 `merge_teammate` 看得见同伴租约并拒绝。位于仓库根的 Lead——常见情形——不受影响：映射出的目录就是检出根。

## 验证

两个新测试套件，在修复前先跑出 RED。`packages/saturn/claims/tests/shell-guard-dialects.spec.ts` 在每个用例里桩掉平台，因此它在任何机器上都证明同一份契约：跨两种词汇表、两个平台的六条终端变更被拒绝，四条只读命令行仍被放行，持有者自己的变更被放行，`bash` 保持其已声明的方言。`packages/saturn/agent-team/tests/worktree-subdirectory.spec.ts` 构造一个文件位于 `app/` 之下的真实仓库，把 Lead 放在 `<repo>/app`，断言子会话的 workspace 落在 `<checkout>/app`，并断言在那里取得的认领会拒绝同伴的合并、而持有者自己的合并照常落地。`vitest run packages/saturn/agent-team packages/saturn/tool-agent-team packages/saturn/claims packages/subagent/subagent` 报告 39 个文件 / 798 通过、2 跳过；四个工程的 `tsc --noEmit` 均无诊断。

## Model experience

工具面没有变化。在终端里敲下变更命令的模型，现在收到的是它在 `bash` 与 `pwsh` 上早已收到的、点名持有者的同一份拒绝；从子目录合并隔离队友的 Lead，现在收到的是带被拦路径的拒绝，而不是一次静默覆盖。
