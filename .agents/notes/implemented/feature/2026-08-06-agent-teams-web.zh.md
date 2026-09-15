# Agent Note：实验性 Agent Teams Web 控件

状态：已实现

[English](2026-08-06-agent-teams-web.md) | 中文

> 打包更新（2026-09-15）：本记录描述的 Agent Teams Web profile 层已删除。`ui-agent-team` 行随 `@deepseek-ai/dsh-web-app` 发布，因此 Web composition 会自动包含该面板，不存在需要额外添加的独立 Web profile 层。

## 问题

持久 Agent Teams runtime 负责 roster、mailbox 与 task 状态，但只提供模型工具和 Host service method。Web 用户需要查看 teammate 活动、按同样的 compare-and-set 规则管理共享任务，并打开 teammate 会话。Agent Teams 仍处于实验阶段，因此这些能力不能向稳定 API Proxy、Session Controller、Client UI package 或 Web bundle 增加 Team 专用 contract 或依赖。

## 决策

私有 `ctx.agentTeams` service 除 domain operation 外，还直接负责生成式 `agentTeams/view`、`agentTeams/createTask` 与 `agentTeams/updateTask` Remote method。Team package 负责浏览器安全的 view 与 mutation-result type。View 包含 roster 与当前 task 状态，但不包含 pending mailbox 内容或已删除 task tombstone。Create 与 update rejection 通过封闭 business result 跨越 Remote；过期的 update revision 保留为 `team-task-conflict`，其他 Team rejection 保留为 `team-rejected`。意外 failure 仍是普通 `RemoteResult` failure。

`@saturnai/dsh-client-ui-agent-team` 通过稳定 `ctx.remote` service 挂载 `@saturnai/dsh-agent-team/remote` contribution，随后直接消费生成式 `ctx.remote.agentTeams` method，不增加 Client result 包装层。它展示 roster status、model 与 diagnostics，并支持 task create、edit、dependency update、assignment、completion、reopen 与 deletion。每次 update 都发送当前显示的 revision。每个 create 或 update 都独立持有 pending token，在开始前使更早的 refresh 失效，并在成功后重新读取完整 Team view。Conflict 仅在其 reload 成功后要求用户检查；如果重新读取失败，则保留该错误。重叠 refresh 只发布所选 Session 的最新请求。

Teammate navigation 使用既有 `{ parentSessionId, childSessionId, mode: 'continuable' }` Subagent address，不带 Team tag。UI 刷新直接 child catalog、再次检查所选 Session，然后打开 addressed conversation。History 与后续人类 prompt 使用稳定 Subagent 路径；Team mailbox 只用于 Team 工具发起的 Team peer delivery。

私有 Web profile 层过去只插入 UI，`@saturnai/dsh-agent-team-profile` 插入 domain、Remote contribution 与模型工具；base-backed profile 挂载 Host 层，而 Web composition 从已发布 bundle 取得 UI。已发布的 `@deepseek-ai/dsh-web-app` bundle 自身就携带全部三行 row 及其依赖，因此 Web composition 不需要任何额外层，也不能在其上叠加——重复的显式 `id:` 会让 Loader 抛出 `duplicate loader entry id`。

稳定 Web preset 仍会在自身 preset scope 内注册 continuable Subagent control。顶层 composition 只能 patch 自己的 entry 列表，无法禁用这些 preset 内的 registration，因此 Web 会话可能同时暴露 Team delegation 工具与 legacy child control。Team-aware Web preset 暂缓实现；当前 row 归属由已发布的 [`dsh-web-app` bundle patch](../../../../packages/bundle/web-app/cordis.patch.yml)负责记录。

## 边界

Web UI 不提供 mailbox timeline、worktree 或 Git control、teammate creation、rename、deletion、interrupt 或自动 merge。它不会从 task ownership 或 write scope 推断文件系统权限。导航到 teammate 后的人类 continuation 是普通 addressed-child prompt，不是 Team mailbox message。

## 考虑过的替代方案

**扩展 legacy API Proxy Team RPC map。** 拒绝，因为这会把实验性 domain 放入稳定 wire package，并重复生成式 Remote vocabulary 与 validation。

**引入独立的浏览器 Remote service。** 拒绝，因为这些 method 没有区别于 `ctx.agentTeams` 的状态、lifecycle 或 policy owner；第二个 Cordis service 会重复 Team injection，并要求另一个 package 提供同一个 Typert namespace。

**向稳定 Subagent address 与 prompt routing 添加 Team metadata。** 拒绝，因为普通 child navigation 已经标识会话；Team tag 会让稳定 Client 与 Subagent contract 耦合实验性 mailbox policy。

**在稳定 Web bundle 中加入 Team row（当时这些 package 仍属实验性）。** 当时拒绝，因为即使是禁用 row 也会产生 release 依赖，并让实验性 package 成为随附 composition 的一部分。Promotion 已取代该结论：三行 row 及其依赖现在都是 release 成员，且每个 id 在每个 composition 中仍只保留一个归属。

## 测试

Team service 单元测试、生成流程与 plain-Node built-artifact smoke 校验直接 Remote method、error mapping 与导出 descriptor。Client typecheck 与浏览器 component test 覆盖挂载 namespace、Lead routing、原始生成式 result、所有 task action、独立 pending operation、完整 task board reload、成功及失败的 conflict reload、陈旧 async result、navigation、dispose 与状态或错误呈现。Web 端到端测试先断言已发布 Web bundle 对每个 Team row id 只声明一次，再运行真实 Host Remote flow。

## 后果

Team service 是 domain state 与公开选定 Team value 的 Remote operation 的唯一 Cordis owner。稳定 API Proxy、Session Controller 与稳定 Client UI package 不承担任何 Team contract——没有 Team wire method、type 或 slot 进入它们；只有交付的 Web bundle composition 挂载 Team row。已晋升的 `@deepseek-ai/dsh-web-app` bundle 挂载全部三行 row，因此标准 Web profile 无需添加任何层即可获得 Agent Teams，而 base-backed profile 则改为添加有序的 `@saturnai` Host 层。Promotion 会重命名 npm package，但不要求新的生成式 namespace。
