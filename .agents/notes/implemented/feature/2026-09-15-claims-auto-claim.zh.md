# Agent Note: 第一次会修改文件的写入自动取得 claim

Status: implemented

[English](2026-09-15-claims-auto-claim.md) | 中文

## 问题

claims 会拒绝同伴的有效租约，但未占用的路径仍然开放。两个从未调用 `claim_scope` 的 agent 仍可能冲突。要求每次编辑前先 `claim_scope`，等于让锁在实践中变成可选项。持有者再次写入自己已经覆盖的界面时，绝不能对自己死锁。

## 决策

write guard 与 shell guard 在已扫描的修改落地之前，为当前 session 取得或刷新租约。尚未被占用的路径记入 lane `auto`，TTL 与 `claim_scope` 相同的两小时。已覆盖的持有者租约就地延长。同伴重叠仍然 DENIED，并且不会写入任何内容。当前 session 从不被当成自己的同伴。

这不是在 `merge_teammate` 上自动取得 claim。该替代方案仍被 [worktree 隔离](2026-09-15-agent-team-worktree-isolation.zh.md) 否决：merge 不得把 Lead 锁在它刚刚带回来的文件之外。

## 考虑过的替代方案

- **让未占用的路径保持开放。** 否决：任何跳过 `claim_scope` 的人都会让锁重新变成礼貌约定。
- **持有者再次写入时拒绝它自己。** 否决：那是自我死锁，不是锁。
- **为 `merge_teammate` 应用的每一条路径自动取得 claim。** 否决：Lead 在一份额外租约到期前无法编辑刚刚 merge 进来的文件。

## 影响

第一次会修改文件的写入会创建其余团队看得见、也能据以拒绝的 `auto` claim。持有者再次写入同一界面只刷新时钟。shell guard 仍在命令运行前释放 ledger。离开 session cwd 的路径不是这份 ledger 能持有的 scope。

## 验证

`packages/saturn/claims/tests/auto-claim.spec.ts` 钉住 lane `auto`、TTL 与持有者刷新。`plugin.spec.ts` 与 `shell-guard.spec.ts` 证明同伴写入被拒绝，而当前 session 自己的写入不会。
