/** Team membership, continuable-child provisioning, and roster-owned teardown. */

import { randomUUID } from 'node:crypto'
import { relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { ContinuableStart } from '@deepseek-ai/dsh-subagent'
import { errorMessage, TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import type { TeamRuntimeLifecycle } from './lifecycle.ts'
import type { TeamState } from './projection.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId } from './types.ts'
import type {
  MergeTeammateRequest,
  MergeTeammateResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberSnapshot,
  TeamMemberView,
  TeamMergeConflict,
} from './types.ts'
import { requiredText } from './validation.ts'
import type { WorktreeManager, WorktreeRecord } from './worktree.ts'

/**
 * The claim ledger as this roster needs it. Enforced claims are an optional
 * neighbour, not a dependency: a deployment without them merges unguarded, and
 * one with them refuses to land a diff over a surface a peer owns.
 */
interface ClaimsGuard {
  conflictsFor(request: {
    workspace: string
    paths: readonly string[]
    ignoreSessionIds?: readonly string[]
  }): Promise<readonly { path: string; holder: string; lane: string; claimId: string }[]>
}

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Caller identity inside one implicit Team. */
export interface TeamMembership {
  readonly root: Agent
  readonly id: TeamId
  readonly role: 'lead' | 'teammate'
  readonly name: string
}

/**
 * Resolve one active Team member by model-facing name, including the Lead pseudo-row.
 * @param root - exact live Team Lead.
 * @param state - current Team state.
 * @param rawName - candidate member name.
 * @returns resolved durable id and normalized name.
 */
export function resolveActiveMember(
  root: Agent,
  state: TeamState,
  rawName: string,
): { id: SessionId; name: string } {
  const name = rawName.trim()
  if (name === 'lead') return { id: root.id, name }
  const member = state.members.find(candidate => candidate.name === name)
  if (member === undefined || member.phase !== 'active') {
    throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
  }
  return { id: member.id, name }
}

/** Owns Team identities and the lifecycle of rostered continuable children. */
export class TeamRoster {
  private readonly inFlightCreations = new Set<Promise<unknown>>()

  /**
   * @param ctx - Team service context with Agent, Session, persistence, and subagent services.
   * @param journal - authoritative Lead-log transaction owner.
   * @param lifecycle - shared Team runtime admission cutoff.
   * @param maxMembers - maximum immutable roster entries per Team.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: TeamJournal,
    private readonly lifecycle: TeamRuntimeLifecycle,
    private readonly maxMembers: number,
    private readonly worktrees: WorktreeManager,
  ) {}

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    const membership = this.tryMembership(agent)
    if (membership === undefined) {
      throw new TeamError(`agent "${agent.id}" is not a member of an active Agent Team`, 'TEAM_NOT_MEMBER')
    }
    return membership
  }

  /**
   * Resolve a caller without throwing for scoped installation and lifecycle observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    if (this.ctx.agents.get(agent.id) !== agent) return undefined
    try {
      const parentId = agent.session.header.parentSession
      if (parentId !== undefined) {
        const root = this.ctx.agents.get(parentId)
        if (root !== undefined) {
          const member = this.journal.state(root).members.find(candidate => candidate.id === agent.id)
          if (member?.phase === 'active' || member?.phase === 'provisioning') {
            return { root, id: TeamId(root.id), role: 'teammate', name: member.name }
          }
          // A direct child outside the durable roster is not a teammate. Ordinary
          // host forks are independent roots; subagent descriptors distinguish
          // provider-owned workers that must not receive a nested Team identity.
          if (this.subagentDescriptor(agent)) return undefined
          return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
        }
      }
      // A continuation can briefly outlive its parent during child-first teardown.
      // Do not reinterpret that durable child as a new implicit root Team. A host-
      // resumed ordinary fork has no descriptor in its own suffix and remains a
      // valid new root whose inherited Team records stay outside its projected Team state.
      if (this.subagentDescriptor(agent)) return undefined
      return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
    } catch {
      // This method is used by lifecycle observers and teardown discovery. A
      // malformed durable stream is surfaced by authoritative Team operations;
      // the non-throwing probe must not veto unrelated Agent lifecycle edges.
      return undefined
    }
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param membership - exact caller membership resolved by this roster.
   * @returns Lead and teammate rows in creation order.
   */
  list(membership: TeamMembership): TeamMemberView[] {
    const { root } = membership
    const state = this.journal.state(root)
    const result: TeamMemberView[] = [{
      id: root.id,
      name: 'lead',
      role: 'lead',
      status: root.status,
      isolation: 'shared',
      ...root.options.model === undefined ? {} : { model: root.options.model },
      diagnostics: [],
    }]
    for (const member of state.members) {
      const live = this.ctx.agents.get(member.id)
      const model = live?.options.model ?? root.options.model
      result.push({
        id: member.id,
        name: member.name,
        role: 'teammate',
        status: member.phase === 'failed'
          ? 'failed'
          : member.phase === 'provisioning'
            ? 'provisioning'
            : live?.status ?? 'inactive',
        description: member.description,
        provider: member.provider,
        context: member.context,
        isolation: member.isolation ?? 'shared',
        ...member.worktree === undefined ? {} : { worktree: member.worktree },
        ...model === undefined ? {} : { model },
        diagnostics: member.error === undefined ? [] : [member.error],
      })
    }
    return result
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawn(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const operation = this.spawnAdmitted(caller, request)
    this.inFlightCreations.add(operation)
    try {
      return await operation
    } finally {
      this.inFlightCreations.delete(operation)
    }
  }

  /**
   * Return admitted creation operations captured for ordered disposal.
   * @returns detached snapshot ordered only by Set insertion.
   */
  pendingCreations(): readonly Promise<unknown>[] {
    return [...this.inFlightCreations]
  }

  /**
   * Reconcile provisioning state when one Team member Session starts.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.tryMembership(agent)
    if (membership?.role === 'lead') await this.reconcileProvisioning(membership.root, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can interrupt teammates', 'TEAM_LEAD_REQUIRED')
    const state = this.journal.state(membership.root)
    const target = resolveActiveMember(membership.root, state, targetName)
    if (target.id === membership.root.id) throw new TeamError('the Team Lead cannot interrupt itself', 'TEAM_INVALID_TARGET')
    const live = this.ctx.agents.get(target.id)
    if (live === undefined) return { previousStatus: 'inactive' }
    const previousStatus = live.status
    this.ctx.subagents.interrupt(target.id, { kind: 'ancestor', agent: caller })
    return { previousStatus }
  }

  /**
   * Group exact live roster children by their current Lead for runtime teardown.
   * @returns each live Lead and the roster child ids currently in the Agent registry.
   */
  liveChildrenByRoot(): Map<Agent, SessionId[]> {
    const teams = new Map<Agent, SessionId[]>()
    for (const agent of this.ctx.agents.list()) {
      const rootId = agent.session.header.parentSession
      if (rootId === undefined) continue
      const root = this.ctx.agents.get(rootId)
      if (root === undefined
        || !this.journal.state(root).members.some(member => member.id === agent.id)) continue
      const children = teams.get(root) ?? []
      children.push(agent.id)
      teams.set(root, children)
    }
    return teams
  }

  /**
   * Release exact teammate Activations through the continuation lifecycle owner.
   * @param root - exact live Team Lead authorizing release.
   * @param childIds - selected roster child ids.
   */
  async stopTeammates(root: Agent, childIds: readonly SessionId[]): Promise<void> {
    await this.lifecycle.withTimeout(this.ctx.subagents.drainContinuableChildren(root, childIds))
  }

  /**
   * Apply one isolated teammate's work into the Lead workspace, whole or not
   * at all.
   *
   * The merge is the moment the coordination that isolation deferred comes
   * due, so it is also the moment a claim must be consulted: the Lead is about
   * to write files a peer may own. Every path in the diff is checked before the
   * first byte lands, and a single owned path refuses the whole patch — a
   * half-applied merge would leave the Lead workspace in a state neither member
   * produced, which is worse than either diff alone.
   * @param caller - exact live Lead Agent.
   * @param request - target teammate, dry-run flag, and cancellation.
   * @returns what was applied, or what refused it.
   */
  async merge(caller: Agent, request: MergeTeammateRequest): Promise<MergeTeammateResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can merge teammate work', 'TEAM_LEAD_REQUIRED')
    }
    const root = membership.root
    const workspace = this.workspaceOf(root)
    const state = this.journal.state(root)
    const target = resolveActiveMember(root, state, request.target)
    const member = state.members.find(candidate => candidate.id === target.id)
    if (member?.worktree === undefined) {
      throw new TeamError(
        `teammate "${target.name}" works in the shared Lead workspace, so its work is already here and there is nothing to merge`,
        'TEAM_NOT_ISOLATED',
      )
    }
    const change = await this.worktrees.collect(member.worktree.path, request.signal)
    if (change.paths.length === 0) {
      return { target: member.name, status: 'unchanged', files: [], conflicts: [] }
    }
    const files = await this.workspaceRelative(workspace, change.paths, request.signal)
    const conflicts = await this.claimConflicts(workspace, files, [root.id, member.id])
    if (conflicts.length > 0) {
      return { target: member.name, status: 'denied', files, conflicts }
    }
    if (request.dryRun === true) return { target: member.name, status: 'previewed', files, conflicts: [] }
    await this.worktrees.apply(workspace, change.patch, request.signal)
    return { target: member.name, status: 'merged', files, conflicts: [] }
  }

  /**
   * Remove every isolated checkout this Team created.
   *
   * Driven from the durable roster rather than from memory, so a Lead resumed
   * in a later process still cleans up the checkouts of the members it finds.
   */
  async removeWorktrees(): Promise<void> {
    for (const agent of this.ctx.agents.list()) {
      const membership = this.tryMembership(agent)
      if (membership?.role !== 'lead') continue
      const workspace = agent.session.header.cwd
      if (workspace === undefined || workspace === '') continue
      for (const member of this.journal.state(agent).members) {
        if (member.worktree === undefined) continue
        try {
          await this.worktrees.remove(workspace, member.worktree.path, this.lifecycle.signal)
        } catch (error: unknown) {
          this.ctx.logger.warn(`removing the isolated checkout of "${member.name}" failed: ${errorMessage(error)}`)
        }
      }
    }
  }

  /** The Lead workspace, which every isolation and merge operation needs. */
  private workspaceOf(root: Agent): string {
    const workspace = root.session.header.cwd
    if (workspace === undefined || workspace === '') {
      throw new TeamError('this operation needs the Team Lead session to have a workspace', 'TEAM_WORKTREE_UNAVAILABLE')
    }
    return workspace
  }

  /** The Lead workspace, proved able to host an isolated checkout. */
  private async isolatedWorkspace(root: Agent, signal: AbortSignal): Promise<string> {
    const workspace = this.workspaceOf(root)
    if (!await this.worktrees.isRepository(workspace, signal)) {
      throw new TeamError(
        `worktree isolation needs a git repository with at least one commit at "${workspace}"; spawn this teammate with shared isolation instead`,
        'TEAM_WORKTREE_UNAVAILABLE',
      )
    }
    return workspace
  }

  /** Restate repository-relative diff paths against the Lead workspace. */
  private async workspaceRelative(
    workspace: string,
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> {
    const repository = await this.worktrees.repositoryRoot(workspace, signal)
    const files = paths.map(path => relative(workspace, resolve(repository, path)).replace(/\\/gu, '/'))
    const outside = files.filter(file => file === '' || file.startsWith('../'))
    if (outside.length > 0) {
      // Ownership is recorded per workspace, so a diff reaching above this one
      // cannot be checked against it. Refusing is the honest answer; applying
      // it blind is the one that loses somebody's work.
      throw new TeamError(
        `the teammate diff changes files outside the Lead workspace (${outside.join(', ')}), where ownership cannot be checked`,
        'TEAM_MERGE_OUT_OF_SCOPE',
      )
    }
    return files
  }

  /** Ask the claim ledger which of these paths a peer already owns. */
  private async claimConflicts(
    workspace: string,
    paths: readonly string[],
    ignoreSessionIds: readonly string[],
  ): Promise<TeamMergeConflict[]> {
    const claims = this.ctx.get('claims') as unknown as ClaimsGuard | undefined
    if (typeof claims?.conflictsFor !== 'function') return []
    const conflicts = await claims.conflictsFor({ workspace, paths, ignoreSessionIds })
    return conflicts.map(conflict => ({
      path: conflict.path,
      holder: conflict.holder,
      lane: conflict.lane,
      claimId: conflict.claimId,
    }))
  }

  /** Perform one creation admitted before the Team runtime disposal cutoff. */
  private async spawnAdmitted(
    caller: Agent,
    request: SpawnTeammateRequest,
  ): Promise<SpawnTeammateResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    }
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    signal.throwIfAborted()
    const root = membership.root
    const name = this.memberName(request.name)
    const description = requiredText(request.description, 'description', 200)
    const provider = requiredText(request.provider, 'provider', 200)
    const childId = brandString<SessionId>(randomUUID())
    const isolation = request.isolation ?? 'worktree'
    // Proved before anything durable is written: a workspace that cannot host a
    // checkout must leave the Team exactly as it was, with the name still free.
    const workspace = isolation === 'worktree' ? await this.isolatedWorkspace(root, signal) : undefined
    const member: TeamMemberSnapshot = {
      id: childId,
      name,
      description,
      provider,
      context: request.context,
      phase: 'provisioning',
      isolation,
    }

    await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      if (state.members.some(member => member.name === name)) {
        throw new TeamError(`teammate name "${name}" was already used in this Team`, 'TEAM_MEMBER_NAME_TAKEN')
      }
      if (state.members.length >= this.maxMembers) {
        throw new TeamError(`Team member limit ${this.maxMembers} reached`, 'TEAM_MEMBER_LIMIT')
      }
      await this.journal.appendAndFlush(root, 'team/member', { version: 1, teamId: TeamId(root.id), member })
    })

    let started: ContinuableStart
    let worktree: WorktreeRecord | undefined
    let childWorkspace: string | undefined
    try {
      if (workspace !== undefined) {
        worktree = await this.worktrees.create(workspace, root.id, name, signal)
        // The checkout is the whole repository, but the teammate stands where
        // its Lead stands inside it. Handing it the checkout root when the Lead
        // works in a subdirectory would file its claims against the repository
        // while the Lead asks about them against the subdirectory, and a lease
        // nobody can see is worse than no lease at all.
        childWorkspace = await this.worktrees.checkoutWorkspace(workspace, worktree.path, signal)
      }
      started = await this.ctx.subagents.startContinuable({
        childId,
        provider: request.provider,
        label: description,
        request: {
          prompt: request.prompt,
          parent: root,
        },
        ...childWorkspace === undefined ? {} : { cwd: childWorkspace },
        signal,
      })
      await this.checkpointInitialPrompt(childId, started.messageId, signal)
    } catch (error: unknown) {
      const failed: TeamMemberSnapshot = {
        ...member,
        phase: 'failed',
        error: errorMessage(error),
      }
      try {
        const phase = await this.settleProvisioning(root, failed)
        await this.stopTeammates(root, [childId])
        if (workspace !== undefined && worktree !== undefined) {
          await this.worktrees.remove(workspace, worktree.path, this.lifecycle.signal)
        }
        if (phase === 'active') {
          throw new TeamError(
            `teammate "${name}" became active while its creator reported failure`,
            'TEAM_PROVISIONING_CONFLICT',
            { cause: error },
          )
        }
      } catch (recordError: unknown) {
        throw new AggregateError([error, recordError], 'teammate creation and durable failure recording both failed')
      }
      throw error
    }
    const active = {
      ...member,
      phase: 'active' as const,
      ...worktree === undefined ? {} : { worktree },
    } satisfies TeamMemberSnapshot
    // Once the continuation accepted its first prompt, it is a real child. If
    // this checkpoint fails, keep the in-memory active edge instead of inventing
    // an impossible active -> failed transition; restart reconciliation covers
    // the provisioning-only durable prefix.
    const settledPhase = await this.settleProvisioning(root, active)
    if (settledPhase === 'failed') {
      const conflict = new TeamError(
        `teammate "${name}" was reconciled as failed while creation was in progress`,
        'TEAM_PROVISIONING_CONFLICT',
      )
      try {
        await this.stopTeammates(root, [childId])
      } catch (cleanupError: unknown) {
        /* v8 ignore next -- requires the independently tested HMR settlement conflict and cleanup failure together. */
        throw new AggregateError([conflict, cleanupError], 'provisioning conflict cleanup failed')
      }
      throw conflict
    }
    return { member: this.memberView(active) }
  }

  /** Flush the accepted initial inbox item before the Lead can commit `active`. */
  private async checkpointInitialPrompt(
    childId: SessionId,
    messageId: MessageId,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      signal.throwIfAborted()
      const session = this.ctx.sessions.get(childId)
      if (session === undefined) {
        const stored = await this.ctx.sessionPersistence.inspect(childId, signal)
        const suffix = stored.events.slice(stored.inheritedEventCount)
        if (messageAccepted(suffix, message => message.id === messageId)) return
        throw new TeamError(
          `teammate "${childId}" initial prompt was not durably accepted`,
          'TEAM_PROVISIONING_CONFLICT',
        )
      }

      const progress = Promise.withResolvers<void>()
      // Abort can win while the durability flush is still pending; mark the
      // later-awaited rejection handled without changing its eventual result.
      void progress.promise.catch(() => undefined)
      const stopEvent = this.ctx.on('session/event', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const stopDisposed = this.ctx.on('session/disposed', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const onAbort = (): void => {
        const reason: unknown = signal.reason
        progress.reject(reason instanceof Error
          ? reason
          : new TeamError(`teammate creation aborted: ${errorMessage(reason)}`, 'TEAM_DISPOSED'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        await this.ctx.sessions.flush(session)
        const suffix = session.ownEvents()
        if (messageAccepted(suffix, message => message.id === messageId)) return
        if (this.ctx.sessions.get(childId) !== session) continue
        await progress.promise
      } finally {
        signal.removeEventListener('abort', onAbort)
        stopDisposed()
        stopEvent()
      }
    }
  }

  /** Settle provisioning-only members from their independently durable child Sessions. */
  private async reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void> {
    const provisioning = this.journal.state(root).members.filter(member => member.phase === 'provisioning')
    for (const member of provisioning) {
      signal.throwIfAborted()
      // A live child means creation is still completing in this process. Its
      // creator owns the terminal member edge.
      if (this.ctx.agents.get(member.id) !== undefined) continue
      let phase: 'active' | 'failed' = 'failed'
      let failure = 'provisioning did not leave a resumable child Session'
      try {
        const loaded = await this.ctx.sessionPersistence.inspect(member.id, signal)
        const suffix = loaded.events.slice(loaded.inheritedEventCount)
        const descriptor = foldSubagentDescriptor(suffix)
        const acceptedInitialPrompt = messageAccepted(suffix, message => message.source.kind === 'user')
        if (loaded.meta.parentSession === root.id
          && descriptor?.mode === 'continuable'
          && descriptor.provider === member.provider
          && acceptedInitialPrompt) {
          phase = 'active'
        } else {
          failure = 'persisted child Session does not match the provisioned continuation'
        }
      } catch (error: unknown) {
        failure = `child Session recovery failed: ${errorMessage(error)}`
      }
      signal.throwIfAborted()
      await this.journal.transact(root.id, async () => {
        signal.throwIfAborted()
        const current = this.journal.state(root).members.find(candidate => candidate.id === member.id)
        if (current?.phase !== 'provisioning') return
        const settled: TeamMemberSnapshot = {
          ...current,
          phase,
          ...phase === 'failed' ? { error: failure } : {},
        }
        await this.journal.appendAndFlush(root, 'team/member', {
          version: 1,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    }
  }

  /** Build one runtime member row after successful creation. */
  private memberView(member: TeamMemberSnapshot & { readonly phase: 'active' }): TeamMemberView {
    const live = this.ctx.agents.get(member.id)
    return {
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: live?.status ?? 'inactive',
      description: member.description,
      provider: member.provider,
      context: member.context,
      isolation: member.isolation ?? 'shared',
      ...member.worktree === undefined ? {} : { worktree: member.worktree },
      ...live?.options.model === undefined ? {} : { model: live.options.model },
      diagnostics: [],
    }
  }

  /** Validate a never-reused model-facing teammate name. */
  private memberName(value: string): string {
    if (!MEMBER_NAME.test(value) || value.length > 64 || value === 'lead') {
      throw new TeamError(
        'teammate name must be lower-kebab-case, at most 64 characters, and not "lead"',
        'TEAM_INVALID_MEMBER_NAME',
      )
    }
    return value
  }

  /** Append one terminal provisioning edge unless recovery already settled it. */
  private async settleProvisioning(
    root: Agent,
    terminal: TeamMemberSnapshot,
  ): Promise<'active' | 'failed'> {
    return this.journal.transact(root.id, async () => {
      const current = this.journal.state(root).members.find(member => member.id === terminal.id)
      /* v8 ignore next 3 -- the append-only provisioning event is committed by this operation before settlement. */
      if (current === undefined) {
        throw new TeamError(`provisioned teammate "${terminal.id}" disappeared`, 'TEAM_PROVISIONING_CONFLICT')
      }
      if (current.phase !== 'provisioning') return current.phase
      await this.journal.appendAndFlush(root, 'team/member', {
        version: 1,
        teamId: TeamId(root.id),
        member: terminal,
      })
      return terminal.phase === 'active' ? 'active' : 'failed'
    })
  }

  /** Whether a Session's own suffix identifies a provider-owned subagent child. */
  private subagentDescriptor(agent: Agent): boolean {
    return foldSubagentDescriptor(agent.session.ownEvents()) !== undefined
  }
}
