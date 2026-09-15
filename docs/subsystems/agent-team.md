# Agent Teams

English | [中文](agent-team.zh.md)

Types shared by the experimental implicit-root Team domain, model tools, and host adapters. The [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns identity, mailbox, task, and shared-checkout decisions; this page records the literal durable forms from [`packages/saturn/agent-team/src/types.ts`](../../packages/saturn/agent-team/src/types.ts).

## Identity and roster

SaturnBot adds a separate role-bound operating team through `ctx.saturnbot`: an orchestrator,
developer, growth, operations, and finance role. Its [package reference](../../packages/saturn/saturnbot/README.md)
owns scheduled cycles, isolated Git stages, typed tools, approvals, and the append-only execution journal.
The top-right SaturnBot launcher opens its management window. The Team types below describe the
shared interactive coding team; SaturnBot's business-cycle types are owned by its package.

`TeamId` is the root `SessionId` under a distinct [brand](core.md#branded-ids). `TeamTaskId` is Team-local and monotonically allocated as `task-<n>`; `TeamMessageId` is globally random. A teammate's Session id remains its persistent identity, while `name` is an immutable model/UI label.

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
}
```

Every member starts in `provisioning` and reaches exactly one terminal roster phase, `active` or `failed`. Runtime `running`/`idle`/`inactive` status is derived separately and never rewrites this record.

## Durable mailbox

The Lead Session first stores the complete queued message. A target receipt is acknowledged only after its pending inbox item or recorded user message is durable, leaving queued-minus-delivered as the recovery mailbox.

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

The target Session keeps message identity and sender attribution on both the pending inbox item and the eventual user message. Folding that source across inbox and history is the target-side de-duplication key; the model-visible framing repeats the id and sender.

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

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

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

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views add owner name, readiness, and write-scope overlap warnings without changing the durable snapshot.

## Replay

`foldTeam()` replays one root Session into the roster, task board, and queued-minus-delivered mailbox that every Team operation reads. It selects records by `TeamId`, so events inherited by an ordinary fork retain the ancestor id and never enter the new root's state. Session event `seq` and `time` remain the ordering and timing record; Team snapshots do not duplicate them. Roster and task reads reach callers as views; pending mail stays internal to delivery and recovery. The package [README](../../packages/saturn/agent-team/README.md) owns operation, authorization, recovery, and limit behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

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

Types: [BotConfig](../../packages/saturn/saturnbot/README.md) · [BotEventPage](../../packages/saturn/saturnbot/README.md) · [BotId](../../packages/saturn/saturnbot/README.md) · [BotMemoryRecord](../../packages/saturn/saturnbot/README.md) · [BotRole](../../packages/saturn/saturnbot/README.md) · [BotSnapshot](../../packages/saturn/saturnbot/README.md) · [BotTicketRecord](../../packages/saturn/saturnbot/README.md) · [BotWebhookRecord](../../packages/saturn/saturnbot/README.md)

Source: [`packages/saturn/saturnbot/src/index.ts`](../../packages/saturn/saturnbot/src/index.ts)
<!-- END GENERATED cordis-surface -->
