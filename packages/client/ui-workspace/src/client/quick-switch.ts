/** Local navigation results; no request, model turn, or repository scan is needed. */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A navigation destination projected from the current host snapshots. */
export type QuickDestination =
  | { kind: 'session'; id: SessionId; title: string; detail: string; running: boolean; completed: boolean }
  | { kind: 'workspace'; id: WorkspaceSnapshot['items'][number]['workspaceId']; title: string; detail: string }

/**
 * Rank title and path matches, preserving recent-session and workspace order on ties.
 * @param sessions - Current session list and selection.
 * @param workspaces - Current workspace registry and archive set.
 * @param query - Whitespace-separated title or path fragments.
 * @returns All matching destinations, with archived and blank conversations excluded.
 */
export function quickDestinations(
  sessions: SessionListState, workspaces: WorkspaceSnapshot, query: string,
): QuickDestination[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const archived = new Set(workspaces.archivedSessionIds)
  const workspaceBySession = new Map(workspaces.items.flatMap(workspace =>
    workspace.sessionIds.map(id => [id, workspace.title] as const)))
  const sessionRows: QuickDestination[] = sessions.ids
    .map(id => sessions.byId[id])
    .filter((row): row is SessionSummary => row !== undefined && !row.blank && !archived.has(row.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(row => ({
      kind: 'session', id: row.id, title: row.displayTitle,
      detail: workspaceBySession.get(row.id) ?? row.cwd ?? '',
      running: row.running, completed: row.completed === true,
    }))
  const workspaceRows: QuickDestination[] = workspaces.items.map(workspace => ({
    kind: 'workspace', id: workspace.workspaceId, title: workspace.title, detail: workspace.path,
  }))
  return [...sessionRows, ...workspaceRows]
    .map((row) => {
      const title = row.title.toLocaleLowerCase()
      const text = `${title} ${row.detail.toLocaleLowerCase()}`
      const match = words.every(word => text.includes(word))
      const rank = words.reduce((score, word) => score + (title.startsWith(word) ? 3 : title.includes(word) ? 2 : 0), 0)
      return { row, match, rank }
    })
    .filter(candidate => candidate.match)
    .sort((a, b) => b.rank - a.rank)
    .map(candidate => candidate.row)
}
