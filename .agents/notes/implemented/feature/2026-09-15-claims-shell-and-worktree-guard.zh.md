# Agent Note: claim 守卫 shell 写入，并覆盖仓库的全部 worktree

Status: implemented

[English](2026-09-15-claims-shell-and-worktree-guard.md) | 中文

## 问题

claim ledger 通过 `write`、`edit` 与 `str_replace_editor` 拒绝冲突写入，而 Agent Teams 的 policy 把没说出口的部分直接写在明面上："Bash、formatter、代码生成器和脚本没有被文件系统版本守卫完全保护。"一把附带公开绕行方式的锁，就是写者会绕开的锁，而 `echo x > src/app.ts` 正是那条绕行路。

第二个问题随隔离检出而来。ledger 以 session 的工作目录为键，于是同一仓库两个链接 worktree 中的两个 teammate 会拥有两份私有 ledger，各自确信自己拥有 `src/app.ts`。这正是最初那种工作丢失式冲突，只是来得更晚、代价更大，因为那时两份 diff 都已经写好了。

## 决策

`tools/execute` 总线上新增第二个守卫，读取 `bash`、`pwsh` 与 `terminal_send`。它不解释命令——这里没有任何东西试图预测 `node build.mjs` 会碰什么。它只扫描 argv 能够证明的内容：输出重定向的目标，以及以修改文件为唯一目的的命令的操作数，覆盖 POSIX 与 PowerShell 两套词汇，并理解具名参数，因此 `Set-Content -Path src/app.ts -Value 'text'` 得到的是路径而不是文本。目标相对命令自身的工作目录解析，投影到 claim 空间，落在其外者被丢弃。

读取被刻意保持自由。会拒绝 `cat` 的守卫，一天之内就会被绕开。与第一方守卫不同，这个守卫不会在派发期间持有 ledger 事务：该锁是跨进程的，一次构建持有它会在整个构建时长里拖住其他所有 session 的 claim。检查读取、判定、随后在命令启动前释放，代价是留下一个很窄的窗口——检查期间新取得的 claim 会被漏掉，这远小于锁被拖住的代价。

claim 空间是另一半。当 session 的工作目录是链接的 `git worktree` 时，其 claim 记录在该仓库主 worktree 下的对应目录上；检测依据是 git 自身的 `.git` 文件与 `commondir` 记录，按目录缓存，凡是读不到的情况都回退为目录本身。因此 scope 命名的是所有检出共享的、以仓库为基准的界面。第一方守卫现在在 claim 空间解析被占有的 scope，同时在 session 自身的检出中解析模型给出的路径——正是这一点让被隔离的 teammate 在自己的 worktree 内自由写入，而共享界面仍然有主。

对尚未被占有的路径，第一次变更性的第一方写入，或一次被扫描到的 shell 变更，会为当前 session 在 `auto` lane 上自动取得租约，TTL 与 `claim_scope` 相同（两小时）。写入自己已经覆盖的界面会续租，且永远不会与自己死锁。同伴的有效 claim 仍在任何字节落地之前被拒绝。

`ctx.claims` 把 ledger 作为只读接口发布，供代表他人写入 workspace 的 host 代码使用；Agent Teams 的 `merge_teammate` 正是据此得知传入 diff 中哪些路径已被同伴占有。该读取接口不取得任何租约。write 与 shell 守卫在第一次未占有的变更上为 session 自动取得租约；merge 仍然只查询、不创建。

## 考虑过的替代方案

**用真正的 shell 文法解析命令。** 在奇特语法上更精确，但会引入依赖，并带来大得多的出错面。这次扫描刻意保持浅层，其限度写在模型会读到的 policy 里。

**拒绝一切指名被占有路径的 shell 命令，包括读取。** 看着安全，实则不可用：查看同伴的文件是正常且必要的，阻断它只会促使写者关掉守卫。

**让所有 session 都以仓库根为 ledger 键。** 这同样能统一 worktree，但也会把在同一仓库不同子目录工作的两个 agent 的 ledger 静默合并——为了修一个只有链接 worktree 才有的情况，却改变了所有既有用户的行为。

## 影响

指名同伴已占有文件的 shell 命令现在会被拒绝，并给出持有者、lane、租期与被阻断的确切路径，常驻 policy 也据此改写，不再承认这个缺口。同一仓库的所有检出共享同一组 lane，因此 worktree 隔离与 claim 相互组合，而不是彼此抵消。写入行为无法从 argv 看出的命令——formatter、生成器、脚本——仍不在覆盖范围内，policy 仍然指明那是 agent 之间必须彼此履行的协调义务。

## 验证

测试驱动真实工具运行时，配以真的会执行写入的 shell 形状 fixture，因此"未能拒绝"会表现为字节被改动，而不仅是缺少一个错误：重定向、`rm`、`cp`、`sed -i`、`Set-Content`、`Remove-Item`、`Out-File` 以及一次 terminal 写入，针对同伴占有的文件逐一被拒绝；持有者自己的命令被放行；四条只读命令被放行；workspace 之外的目标被忽略；相对目标按命令的 `workdir` 解析。claim 空间针对带真实链接 worktree 的真实仓库验证：worktree 解析到其主检出，且在一个 worktree 中取得的 claim 会拒绝第二个 worktree，并对仓库本身中的 session 可见。
