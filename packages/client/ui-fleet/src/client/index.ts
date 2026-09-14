/**
 * Fleet route surface plugin, browser half: occupies the composer's ambient
 * dock (`conversation.composer.dock` — "ambient entries below the composer
 * card", the declared list seat the stats line shares) with one fact-derived
 * route line per delegated worker.
 *
 * Every fact is read through a seat another layer already publishes: the list
 * rows, background jobs, and direct-child catalogs of `ctx.sessions`, and the
 * pending-interaction map of the session standard kit. This plugin adds no
 * state — it folds what is already there into the one surface where parallel
 * delegated work is legible.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { FleetRoute } from './FleetRoute.tsx'
import { en, NS, zh, type FleetKey } from './locales.ts'

export type { FleetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The fleet route surface's copy. */
    fleet: FleetKey
  }
}

/** Injected business face of the fleet seat. */
export interface FleetInjected {
  /**
   * Open one delegated worker in its parent context. The catalog address is
   * preferred because it is the addressed route the lineage header reads, and
   * the plain selection is the fallback for a worker whose direct-parent
   * address has not been discovered yet. Both are the sessions domain's own
   * navigation entry points; neither is invented here.
   * @param id - the worker session id, straight off its route line.
   */
  openWorker: (id: SessionId) => void
}

/** Required services: the session read models, the seat registry, and locale. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the fleet route surface over the published
 * session read models.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-fleet: dictionaries')

  const sessions = ctx.sessions
  const actions = (_sessionId: SessionId): FleetInjected => ({
    openWorker(id: SessionId) {
      const address = sessions.subagentAddress(id)
      if (address !== undefined) sessions.openSubagent(address)
      else sessions.open(id)
    },
  })

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'fleet',
    // After the stats line (0): appending below the shipped entry keeps the
    // stats line exactly where it is today, so nothing already on screen moves
    // when this seat mounts.
    order: 10,
    locale: NS,
    inject: actions,
  }, FleetRoute))
}
