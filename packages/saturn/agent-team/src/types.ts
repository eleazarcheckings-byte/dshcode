/** Public Agent Teams identities, durable records, and service request values. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/**
 * Where a teammate's files live. `worktree` (the default) is a git checkout of
 * the Lead's HEAD that only that member can see, whose work reaches the Lead
 * through a merge. `shared` is opt-in: the Lead's own workspace, which every
 * member sees at once.
 */
export type TeamIsolation = 'shared' | 'worktree'

/** One member's isolated checkout, recorded so it survives a restart. */
export interface TeamWorktreeSnapshot {
  /** Absolute path of the checkout. */
  readonly path: string
  /** The exact commit it was created from. */
  readonly baseRevision: string
}

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
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

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  /** Where this member works; the Lead row is always shared. */
  readonly isolation?: TeamIsolation
  /** The member's isolated checkout, when it has one. */
  readonly worktree?: TeamWorktreeSnapshot
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** Point-in-time roster and task-board projection returned to browser clients. */
export interface TeamView {
  readonly members: TeamMemberView[]
  readonly tasks: TeamTaskView[]
}

/** One peer message retained until its target Session records it. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}

/** Source retained by the target Session for durable mailbox de-duplication. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. Defaults to 4. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum queued-minus-delivered messages for one target member. */
  readonly maxPendingMessagesPerMember?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds allowed for Team-owned runtime disposal. */
  readonly disposalTimeoutMs?: number
  /**
   * Directory holding isolated teammate checkouts. Defaults to
   * `<DSH_HOME>/worktrees`; deliberately outside every workspace, so a checkout
   * can never appear in the repository it was taken from.
   */
  readonly worktreeRoot?: string
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  /** Where the teammate works. Defaults to `worktree`; `shared` is opt-in. */
  readonly isolation?: TeamIsolation
  readonly signal: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for merging one isolated teammate's work into the Lead workspace. */
export interface MergeTeammateRequest {
  /** Durable teammate name. */
  readonly target: string
  /** Report what would be merged, and what owns it, without changing a file. */
  readonly dryRun?: boolean
  /** Caller cancellation. */
  readonly signal: AbortSignal
}

/** One path in a teammate's diff that a peer's live claim owns. */
export interface TeamMergeConflict {
  /** The workspace-relative path the diff would change. */
  readonly path: string
  /** Who holds it. */
  readonly holder: string
  /** The holding claim's lane. */
  readonly lane: string
  /** The holding claim's id. */
  readonly claimId: string
}

/** What one merge attempt did, or refused to do. */
export interface MergeTeammateResult {
  /** The teammate whose work this is. */
  readonly target: string
  /**
   * `merged` applied the whole diff, `unchanged` found nothing to apply,
   * `denied` applied nothing because a peer owns part of the surface, and
   * `previewed` answered a dry run.
   */
  readonly status: 'merged' | 'unchanged' | 'denied' | 'previewed'
  /** Every workspace-relative path in the teammate's diff, sorted. */
  readonly files: string[]
  /** The owned paths that refused the merge; empty unless the status is `denied`. */
  readonly conflicts: TeamMergeConflict[]
}

/** Input for one durable peer message. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly delivery: 'quiet' | 'wakeup'
  readonly signal: AbortSignal
}

/** Result after a peer message enters the durable mailbox. */
export interface SendTeamMessageResult {
  readonly messageId: TeamMessageId
  readonly status: 'accepted' | 'queued'
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Browser task mutation result with stale revisions kept distinct from other Team rejections. */
export type TeamTaskMutationResult =
  | { readonly ok: true; readonly value: TeamTaskView }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'team-task-conflict' | 'team-rejected'
      readonly message: string
    }
  }

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot }
    /** Durable mailbox enqueue, stored before delivery is attempted. */
    'team/message/queued': { version: 1; teamId: TeamId; message: TeamMessageSnapshot }
    /** Durable acknowledgement that the target Session recorded the message. */
    'team/message/delivered': {
      version: 1
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
