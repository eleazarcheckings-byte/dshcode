/** Pure projections for the Team overview and dependency map. */
import type { TeamMemberView, TeamTaskView, TeamView } from '@saturnai/dsh-agent-team/client'

/** User-selected task subset; filters never mutate task state. */
export type TaskFilter = 'all' | 'active' | 'attention' | 'completed'

/** Whether a task carries an unresolved dependency or a write-scope warning.
 * @param task - Authoritative task snapshot.
 * @returns true when the task needs inspection before work can proceed safely.
 */
export function taskNeedsAttention(task: TeamTaskView): boolean {
  return task.status !== 'completed' && task.status !== 'deleted'
    && ((task.status === 'pending' && !task.ready) || task.writeScopeWarnings.length > 0)
}

/** Select a board view without changing authoritative ordering.
 * @param tasks - Current Team task snapshots.
 * @param filter - Visible board subset.
 * @returns matching non-deleted tasks in their original order.
 */
export function filterTasks(tasks: readonly TeamTaskView[], filter: TaskFilter): TeamTaskView[] {
  return tasks.filter((task) => {
    if (task.status === 'deleted') return false
    switch (filter) {
      case 'all': return true
      case 'active': return task.status === 'pending' || task.status === 'in_progress'
      case 'attention': return taskNeedsAttention(task)
      case 'completed': return task.status === 'completed'
    }
  })
}

/** Real work totals shown in the mission overview.
 * @param view - Current Team roster and task snapshots.
 * @returns exact totals without estimated task progress.
 */
export function missionSummary(view: TeamView): { running: number; total: number; completed: number; attention: number } {
  const tasks = filterTasks(view.tasks, 'all')
  return {
    running: view.members.filter(member => member.status === 'running').length,
    total: tasks.length,
    completed: tasks.filter(task => task.status === 'completed').length,
    attention: tasks.filter(taskNeedsAttention).length,
  }
}

/** Stable normalized position for one roster member. */
export interface MissionNode {
  readonly member: TeamMemberView
  readonly x: number
  readonly y: number
  readonly tasks: number
}

/** A task dependency between two distinct roster members. */
export interface MissionEdge {
  readonly from: string
  readonly to: string
}

/** Lay out the actual roster and project assigned task dependencies.
 * @param view - Current roster and task board.
 * @returns deterministic positions, lead membership, and distinct dependency edges.
 */
export function missionGraph(view: TeamView): { nodes: MissionNode[]; edges: MissionEdge[] } {
  const members = [...view.members].sort((a, b) => a.id.localeCompare(b.id))
  const peers = members.filter(member => member.role !== 'lead')
  const nodes = members.map((member) => {
    const angle = -Math.PI / 2 + peers.findIndex(peer => peer.id === member.id) * Math.PI * 2 / Math.max(peers.length, 1)
    return {
      member,
      x: member.role === 'lead' ? 0.5 : 0.5 + Math.cos(angle) * 0.36,
      y: member.role === 'lead' ? 0.5 : 0.5 + Math.sin(angle) * 0.32,
      tasks: view.tasks.filter(task => task.ownerName === member.name && task.status !== 'completed' && task.status !== 'deleted').length,
    }
  })
  const memberByName = new Map(members.map(member => [member.name, member.id]))
  const taskById = new Map(view.tasks.map(task => [task.id, task]))
  const pairs = new Map<string, MissionEdge>()
  for (const task of view.tasks) {
    if (task.status === 'completed' || task.status === 'deleted' || task.ownerName === undefined) continue
    const to = memberByName.get(task.ownerName)
    if (to === undefined) continue
    for (const id of task.blockedBy) {
      const blocker = taskById.get(id)
      if (blocker === undefined || blocker.ownerName === undefined || blocker.status === 'completed') continue
      const from = memberByName.get(blocker.ownerName)
      if (from === undefined || from === to) continue
      pairs.set(`${from}:${to}`, { from, to })
    }
  }
  return { nodes, edges: [...pairs.values()] }
}
