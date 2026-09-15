/** Mission summaries and links contain only authoritative Team facts. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamTaskId, TeamTaskView, TeamView } from '@saturnai/dsh-agent-team/client'
import { filterTasks, missionGraph, missionSummary } from '../src/client/mission.ts'

const task = (id: string, ownerName: string, overrides: Partial<TeamTaskView> = {}): TeamTaskView => ({
  id: id as TeamTaskId, revision: 1, subject: id, description: id, ownerName,
  status: 'in_progress', blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [],
  ...overrides,
})
const view: TeamView = {
  members: [
    { id: 'lead' as SessionId, name: 'lead', role: 'lead', status: 'running', diagnostics: [] },
    { id: 'writer' as SessionId, name: 'Writer', role: 'teammate', status: 'idle', diagnostics: [] },
    { id: 'reviewer' as SessionId, name: 'Reviewer', role: 'teammate', status: 'running', diagnostics: [] },
  ],
  tasks: [
    task('design', 'Writer'),
    task('build', 'Reviewer', { status: 'pending', blockedBy: ['design' as TeamTaskId] }),
    task('test', 'Reviewer', { status: 'pending', blockedBy: ['design' as TeamTaskId] }),
    task('done', 'lead', { status: 'completed' }),
    task('removed', 'lead', { status: 'deleted' }),
  ],
}

describe('mission projections', () => {
  it('counts finished tasks without pretending open tasks are partly complete', () => {
    expect(missionSummary(view)).toEqual({ running: 2, total: 4, completed: 1, attention: 2 })
    expect(filterTasks(view.tasks, 'all').map(item => item.id)).toEqual(['design', 'build', 'test', 'done'])
    expect(filterTasks(view.tasks, 'active').map(item => item.id)).toEqual(['design', 'build', 'test'])
    expect(filterTasks(view.tasks, 'attention').map(item => item.id)).toEqual(['build', 'test'])
    expect(filterTasks(view.tasks, 'completed').map(item => item.id)).toEqual(['done'])
  })

  it('includes write conflicts in attention without treating a ready task as blocked', () => {
    const tasks = [
      task('ready', 'Writer', { status: 'pending', ready: true }),
      task('conflict', 'Reviewer', { writeScopeWarnings: ['overlap'] }),
      task('settled', 'Reviewer', { status: 'completed', writeScopeWarnings: ['old warning'] }),
    ]
    expect(filterTasks(tasks, 'attention').map(item => item.id)).toEqual(['conflict'])
  })

  it('keeps coordinates stable across roster ordering and deduplicates real dependency edges', () => {
    const graph = missionGraph(view)
    expect(missionGraph({ ...view, members: [...view.members].reverse() })).toEqual(graph)
    expect(graph.edges).toEqual([{ from: 'writer', to: 'reviewer' }])
    expect(graph.nodes.map(node => ({ name: node.member.name, tasks: node.tasks }))).toEqual([
      { name: 'lead', tasks: 0 }, { name: 'Reviewer', tasks: 2 }, { name: 'Writer', tasks: 1 },
    ])
    expect(graph.nodes.find(node => node.member.role === 'lead')).toMatchObject({ x: 0.5, y: 0.5 })
  })

  it('does not draw self, unassigned, missing-member, or completed dependency links', () => {
    const altered: TeamView = {
      ...view,
      tasks: [
        task('ready', 'Writer', { status: 'completed' }),
        task('outside', 'unknown'),
        { ...task('unassigned', 'Writer'), ownerName: undefined } as unknown as TeamTaskView,
        task('self', 'Reviewer'),
        task('build', 'Reviewer', { blockedBy: ['ready', 'outside', 'unassigned', 'self', 'missing'] as TeamTaskId[] }),
      ],
    }
    expect(missionGraph(altered).edges).toEqual([])
    expect(missionGraph({ members: [], tasks: [] })).toEqual({ nodes: [], edges: [] })
  })
})
