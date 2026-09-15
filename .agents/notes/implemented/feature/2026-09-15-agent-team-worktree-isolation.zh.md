# Agent Note: Team 成员可以在隔离的 git worktree 中工作

Status: implemented

[English](2026-09-15-agent-team-worktree-isolation.md) | 中文

## 问题

每个 teammate 都运行在 Lead 的同一个目录里。子 session 原样复制父级的 `cwd`，因此某个成员的 formatter、代码生成器或做到一半的重构，会立刻被其他所有成员看到，也可能被他们破坏。claim ledger 会拒绝冲突的第一方写入，这是真实的保护，但它保护的是一棵共享工作树，而不是消除共享本身。凡是会重写其他成员正在读取的文件的工作，都没有办法挪到一边去做。

## 决策

`create_teammate` 新增 `isolation`，默认为 `shared`。取 `worktree` 时，roster 会把 Lead 的 HEAD 检出到 `<DSH_HOME>/worktrees/<team>/<member>`，并把该目录作为 teammate 的持久 workspace；该检出记录在成员的 roster 行上，并在 Team 运行时释放时删除。这一模式移植自 SaturnBot 的 local adapter，它自诞生起就为每个任务创建一个 detached worktree；其进程监管与脱敏未被移植，因为这里的每条 argv 都由模块固定，只有路径是变量。

teammate 的 workspace 通过 `childSessionMeta` 上一个新的可选参数抵达，并从 `ContinuableStartSpec.cwd` 贯穿传递。省略该参数或传入空字符串即保留父级 workspace，因此所有既有调用方行为不变。

`merge_teammate` 是唯一的回程。它先暂存该检出（`add -A`，因此新文件计入，被忽略的构建产物不计入），列出所得 diff 中的每个路径，向 claim ledger 询问其中哪些路径已被同伴占有，再用 `git apply` 应用补丁——该命令在写入第一个 hunk 之前会校验全部 hunk。只要有一个路径被占有，整次 merge 即被拒绝，并报告每个被阻断的路径及其持有者；若 diff 触及 Lead workspace 之外，同样被拒绝，因为归属按 workspace 记录，无法在其之上校验。claim 通过 `ctx.get('claims')` 以鸭子类型方式查询：未挂载 claims 插件的部署会在无守卫的情况下 merge，而不是组合失败。

调用 git 时设置 `core.autocrlf=false`。隔离必须逐字节忠实，否则检出时改写行尾、merge 时再改写回来，会让一行改动在部分开发者的机器上变成整文件 diff，而在另一些机器上不会。真正需要 CRLF 的仓库仍可通过 `.gitattributes` 声明。

## 考虑过的替代方案

**为每个 teammate 分配独立进程或容器。** 隔离更强，但会同时改变委派模型、session 日志与审批路径。worktree 只提供文件系统隔离，而这正是缺失的那一部分。

**teammate 完成时自动 merge。** 这会恰好掩盖需要做决定的那一刻。两个成员编辑同一个文件是 Lead 必须处理的信息，静默落地的 merge 会把它重新变成意外。

**为每个被 merge 的路径自动取得 claim。** 这确实能让同一文件的第二次 merge 高声失败，但也会让 Lead 在一个并非自己持有的租约到期前无法编辑刚刚 merge 进来的文件。只查询既有 claim、不创建新 claim，才能让归属始终是 agent 主动声明的东西。

## 影响

worktree 隔离按 teammate 选用且默认关闭，因此既有 Team 的行为完全不变，roster 行只是显示 `isolation: "shared"`。采用它的 Team 以一次 merge 步骤换取即时可见性，而 merge 正是偿付被隔离推迟的协调成本之处。若进程在未释放 Team 的情况下退出，其创建的检出会留在 harness home 下的磁盘上；持久 roster 记录了它们的路径，后续清理可以找到它们。

## 验证

测试针对带 Windows 路径的真实临时仓库运行：从 HEAD 创建检出、收集并应用其 diff、删除目录；被隔离 teammate 的活动 session 将该检出报告为自己的 workspace，而共享 teammate 报告 Lead 的目录；非仓库 workspace 在写入任何持久内容之前即拒绝隔离；释放会删除这些检出。merge 测试会派生两个编辑同一文件的隔离 teammate，通过 claims 插件在第一个 teammate 的检出内部取得真实 claim，并证明第二个 teammate 的 merge 被拒绝、拒绝信息指名第一个 teammate、Lead workspace 保持原样——随后成功 merge 持有者自己的工作。
