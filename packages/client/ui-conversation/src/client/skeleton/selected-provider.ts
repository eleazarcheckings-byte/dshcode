/**
 * Current session's selected model-engine id, for chrome that is
 * engine-capacity rather than Saturn identity (the DeepSeek peak lamp).
 */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Official DeepSeek adapter route. Capacity chrome keys off this id only. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official'

/**
 * Whether the selected engine is DeepSeek's official adapter.
 * @param provider - session model-selection provider id, or absent.
 */
export function isDeepSeekProvider(provider: string | null | undefined): boolean {
  return provider === DEEPSEEK_PROVIDER_ID
}

/**
 * Read the next-request provider, falling back to the last used route.
 * Unknown or empty snapshots are not DeepSeek.
 * @param value - `modelSelection` projection snapshot, or absent.
 */
export function providerFromModelSelection(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== 'object') return null
  const record = value as {
    next?: { provider?: unknown } | null
    lastUsed?: { provider?: unknown } | null
  }
  const next = record.next?.provider
  if (typeof next === 'string' && next.length > 0) return next
  const last = record.lastUsed?.provider
  if (typeof last === 'string' && last.length > 0) return last
  return null
}

/**
 * Keep a store pointed at the current session's selected provider.
 * @param sessions - client sessions face (list + binding only).
 * @param store - destination for the provider id, or null when unknown.
 * @returns disposer that drops both the list and projection subscriptions.
 */
export function watchSelectedProvider(
  sessions: Pick<ISessions, 'list' | 'binding'>,
  store: SnapshotStore<string | null>,
): () => void {
  let unsubProjection: (() => void) | undefined
  const attach = (): void => {
    unsubProjection?.()
    unsubProjection = undefined
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId === undefined) {
      store.set(null)
      return
    }
    const face = sessions.binding(sessionId)?.session.projections.faceOf('modelSelection')
    if (face === undefined) {
      store.set(null)
      return
    }
    const publish = (): void => {
      store.set(providerFromModelSelection(face.getSnapshot()))
    }
    publish()
    unsubProjection = face.subscribe(publish)
  }
  const unsubList = sessions.list.subscribe(attach)
  attach()
  return () => {
    unsubList()
    unsubProjection?.()
  }
}
