# Agent Teams

[English](agent-team.md) | 中文

实验性隐式 Root Team 领域、模型工具与宿主适配器共享的类型。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责身份、mailbox、task 与共享 checkout 决策；本页记录 [`packages/saturn/agent-team/src/types.ts`](../../packages/saturn/agent-team/src/types.ts) 中的字面持久形式。

## 身份与 roster

SaturnBot 通过 `ctx.saturnbot` 提供具有角色约束的独立运营团队，包括编排、开发、增长、运营和财务角色。其[包参考](../../packages/saturn/saturnbot/README.zh.md)负责说明定时周期、隔离的 Git 暂存工作区、类型化工具、审批以及只追加的执行日志。右上角的 SaturnBot 按钮会打开管理窗口。下文的 Team 类型描述共享的交互式编码团队；SaturnBot 的业务执行周期类型由其包拥有。

`TeamId` 是具有独立[品牌](core.zh.md#branded-ids)的 Root `SessionId`。`TeamTaskId` 在 Team 内按 `task-<n>` 单调分配；`TeamMessageId` 是全局随机值。teammate 的 Session id 始终是持久身份，而 `name` 是不可变的模型／UI 标签。

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
  /** Absent on rows written before isolation existed, which were all shared. */
  readonly isolation?: TeamIsolation
  /** Present only for a member whose isolation is `worktree`. */
  readonly worktree?: TeamWorktreeSnapshot
}
```

每个 member 都从 `provisioning` 开始，并且只到达一个终态 roster phase：`active` 或 `failed`。运行时 `running`／`idle`／`inactive` 状态单独派生，绝不会重写该记录。

member 的 `isolation` 决定其文件位置。默认的 `shared` 即 Lead 自身的工作目录。`worktree` 会把 Lead 的 HEAD 检出到 `<DSH_HOME>/worktrees/<team>/<member>`，并把该检出中与 Lead 在仓库内深度相同的那个目录交给 teammate 作为其持久 workspace——Lead 位于仓库根时即检出根，Lead 位于 `<repo>/<sub>` 时即 `<checkout>/<sub>`，使双方指向同一个认领空间。其改动在 `merge_teammate` 之前对外不可见；merge 会收集该检出的 diff，拒绝任何被同伴 claim 占有的路径，并整体应用补丁，要么全部应用，要么完全不应用。

## 持久 mailbox

Lead Session 首先存储完整 queued message。只有 target 的 pending inbox 条目或已记录用户消息完成持久化，才会写入独立 acknowledgement event，queued-minus-delivered 因而构成恢复 mailbox。

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}
```

target Session 会在 pending inbox 条目和最终用户消息上保留消息身份与发送者归因。跨 inbox 与历史折叠该 source 构成 target 侧去重键；模型可见的 framing 会重复 id 和发送者。

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示尚未开始或已经释放，`in_progress` 携带 owner，`completed` 满足 blocker，`deleted` 是保留的 tombstone。view 会添加 owner name、readiness 和 write-scope 重叠警告，但不会改变持久快照。

## 回放

`foldTeam()` 把一个 Root Session 回放成每个 Team 操作所读取的 roster、任务板与 queued-minus-delivered mailbox。它按 `TeamId` 选取记录，因此普通 fork 继承的 event 保留 ancestor id，绝不会进入新 Root 的状态。Session event 的 `seq` 与 `time` 继续负责顺序和时间记录，Team snapshot 不再重复保存它们。roster 与 task 读取以 view 形式到达调用方，而 pending 邮件仅供投递与恢复内部使用。包 [README](../../packages/saturn/agent-team/README.zh.md)负责 operation、authorization、recovery 和限制行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, scheduling mode, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined

/**
 * Read the current roster and non-deleted task board through the generated Remote API.
 * @param agent - exact live Team member used as the authority credential.
 * @returns detached current roster and task views.
 */
@Remote('view') remoteView(agent: Agent): TeamView

/**
 * Create one shared task through the generated Remote API.
 * @param agent - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task or a typed Team rejection.
 */
@Remote('createTask') remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * Apply one task mutation and preserve Team rejections as business results.
 * @param agent - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed task or a typed Team rejection.
 */
@Remote('updateTask') remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/saturn/agent-team/src/index.ts`](../../packages/saturn/agent-team/src/index.ts)

<a id="ctxsaturnbot--saturnbotservice"></a>

### `ctx.saturnbot` — `SaturnBotService`

Persistent scheduled automation with one engine and one authenticated RPC namespace per host.

```ts cordis-catalog
/** Read current configuration, cycles, approvals, messages, and reports.
 * @returns The authoritative bounded dashboard projection.
 */
@Remote async snapshot(): Promise<BotSnapshot>

/** Persist validated settings; changes never bypass role ceilings or existing approvals.
 * @param patch User-selected configuration changes.
 * @returns The saved configuration and current dashboard state.
 */
@Remote async configure(patch: Partial<BotConfig>): Promise<BotSnapshot>

/** Start one background cycle; returns as soon as its durable ownership is established.
 * @returns The durably accepted running cycle.
 */
@Remote async runNow(): Promise<BotSnapshot>

/** Pause future scheduled cycles without discarding active work.
 * @returns The current state with automatic scheduling disabled.
 */
@Remote async pause(): Promise<BotSnapshot>

/** Cancel the current cycle and wait for its owned work to settle.
 * @returns The settled state after cancellation.
 */
@Remote async cancel(): Promise<BotSnapshot>

/** Decide one exact pending action; duplicate or stale approvals are rejected.
 * @param id Exact pending approval identity.
 * @param allowed Whether the operator authorizes the recorded action.
 * @returns The saved decision and resumed or interrupted branch state.
 */
@Remote async approve(id: BotId, allowed: boolean): Promise<BotSnapshot>

/** Send a persisted instruction to the selected role without changing the standing business goal.
 * @param role The selected specialist or orchestrator.
 * @param content The operator's instruction, limited to 8000 characters.
 * @returns The accepted message and newly started cycle.
 */
@Remote async message(role: BotRole, content: string): Promise<BotSnapshot>

/** Read one bounded trace page after the supplied durable sequence number.
 * @param cursor Last event sequence already received, or zero for the start.
 * @returns The next bounded page of observable events.
 */
@Remote async events(cursor: number): Promise<BotEventPage>

/** Read durable long-term memory without triggering a model or tool invocation.
 * @param query Literal substring to match against keys and values.
 * @returns At most 100 matching memory records, newest first.
 */
@Remote async memory(query: string): Promise<BotMemoryRecord[]>

/** Read the latest authenticated delivery receipts.
 * @returns At most 50 signed webhook receipts, newest first.
 */
@Remote async webhooks(): Promise<BotWebhookRecord[]>

/** Read the open support tickets owned by this SaturnBot instance.
 * @returns At most 20 open tickets, newest first.
 */
@Remote async tickets(): Promise<BotTicketRecord[]>
```

Types: [BotConfig](../../packages/saturn/saturnbot/README.zh.md) · [BotEventPage](../../packages/saturn/saturnbot/README.zh.md) · [BotId](../../packages/saturn/saturnbot/README.zh.md) · [BotMemoryRecord](../../packages/saturn/saturnbot/README.zh.md) · [BotRole](../../packages/saturn/saturnbot/README.zh.md) · [BotSnapshot](../../packages/saturn/saturnbot/README.zh.md) · [BotTicketRecord](../../packages/saturn/saturnbot/README.zh.md) · [BotWebhookRecord](../../packages/saturn/saturnbot/README.zh.md)

Source: [`packages/saturn/saturnbot/src/index.ts`](../../packages/saturn/saturnbot/src/index.ts)
<!-- END GENERATED cordis-surface -->
