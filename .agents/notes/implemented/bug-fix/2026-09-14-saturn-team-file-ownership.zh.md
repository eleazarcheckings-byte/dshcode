# Agent Note: Saturn Team 策略与文件所有权

Status: implemented

[English](2026-09-14-saturn-team-file-ownership.md) | 中文

## Problem

Team 工具指导要求用户明确请求。内置 preset 还会注册与 Team 工具同名的旧控制工具。文件 claim 拒绝重叠的获取请求，并且第一次变更性写入会自动取得租约，因此未占用的路径不会保持开放。

## Decision

Team 指导遵循会话多任务策略。持续共享工作优先使用具名 teammate，范围明确的独立任务使用一次性 subagent。宿主提供 `agentTeams` 时，standard、cordis 和 ptc preset 通过 Loader 表达式跳过旧消息控制工具并选择一次性后台任务；没有 Team 的宿主保留原有的可继续 subagent 行为。

claims 插件在 `tools/execute` 包装第一方文件修改，之后仍运行文件系统现有的观察、审批和沙箱策略。插件将提供方的规范目标与其他会话拥有的 scope 比较，并在整个工具执行期间持有跨进程账本事务。只有拥有该 claim 的会话才能释放或重新建立观察基准。对尚未占用的路径，第一次变更性写入会为当前 session 自动取得租约；同伴的有效 claim 会被拒绝。

## Alternatives considered

仅靠提示词协调无法阻止意外覆盖。文件系统意图事件只有一个决策槽，已经由 stale-version 策略占用；仅在执行前检查却不持有事务会留下获取 claim 的竞态。解析任意 shell 命令会宣称运行时无法可靠提供的保护。

## Consequences

同一工作区的第一方写操作串行执行，包括互不相关的文件。这优先保证所有权可预测，而非最大化小文件写入吞吐量。Shell 工具、formatter、代码生成器和外部编辑器仍需要协调。同一仓库的链接 git worktree 共享一份账本。执行期间外部修改符号链接不属于所有权协议的保护范围。

聚焦测试覆盖其他会话释放或重新建立基准的拒绝、所有第一方修改、拥有者写入、读取、独立工作、过期、别名解析，以及写入期间的竞争获取。测试专用 Cordis 组合运行真实 agent loop，并对日志中的拒绝工具结果和未改变的文件生成快照。Preset 测试在有无 Team 服务时求值随附 YAML。测试不使用模型凭证。
