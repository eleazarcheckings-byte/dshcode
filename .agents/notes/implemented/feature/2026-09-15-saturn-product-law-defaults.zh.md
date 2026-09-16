# Agent Note: Saturn 产品法默认值

Status: implemented

[English](2026-09-15-saturn-product-law-defaults.md) | 中文

## 问题

已交付的 Team 与多任务默认值把 Saturn 当成共享目录、默认编排的 harness。新会话会自行分叉，八个 teammate 可以共用一个 cwd，web-app 人设仍叫通用 coding agent。这与产品主张冲突：用户要求组队之前保持单线程，除非显式选择共享否则使用私有检出，名册小到「团队」仍是团队。

## 决策

四项默认值，只写在它们所拥有的 web-app 键上，以及这些键所描述的派生与折叠代码里：

1. teammate 隔离默认 `worktree`。`shared` 在 `spawn_teammate` 上选用。
2. Team 名册上限为 4（`agent-team` 的 `maxMembers: 4`）。
3. 多任务模式折叠为未激活。委派工具仍然注册。`/orchestrate on` 或输入框开关打开该模式。
4. web-app 的 `system-prompt` 人设把 Saturn AI 称为证明其工作的 agent harness。preset 本地人设仍是 coding-agent 文本。

[worktree 隔离](2026-09-15-agent-team-worktree-isolation.zh.md) 机制不变。[每任务一支团队的 ON 策略](../architecture/2026-09-15-team-per-task-then-standby.zh.md) 仍描述开关打开之后发生什么。

## 考虑过的替代方案

- **保持 `shared` 为派生默认值**，使既有记录的 Team 逐位相同。否决：成员之间静默交叉写入正是隔离要阻止的失败；选用共享才是诚实的例外。
- **把名册上限留在 8。** 否决：八个并发检出是一支舰队，不是 Lead 能 merge 的团队。
- **默认打开多任务。** 否决：新会话是单线程；ON 是昂贵的「每任务一支团队」形态。
- **把 Saturn 人设写进每一个 preset。** 否决：只有 web-app 部署覆盖层拥有产品声音；preset 是用户可以替换的组合。

## 影响

新 teammate 会得到私有检出，除非调用方要求 `shared`。不是 git 仓库的 workspace 仍在派生时拒绝 worktree。新会话是一条直线程；ON 仍表示每任务一支团队然后待命。人设改动只作用于 web-app。

## 验证

`packages/saturn/agent-team` 测试钉住 worktree 默认值与上限 4。`packages/saturn/orchestrate` 策略测试钉住未激活的 init。`packages/saturn/tool-agent-team` 的 schema 文本把 worktree 称为默认值。
