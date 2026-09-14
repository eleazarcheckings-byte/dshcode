/** Saturn AI occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SaturnGlyph, SaturnName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set.
 * Unlike the official brand package there is no build-profile gate: this
 * deployment is always Saturn AI.
 *
 * The conversation hero slot (`conversation.hero.brand.mark`) is deliberately
 * left unoccupied. Its declaring package (`ui-conversation`) already renders
 * the Saturn mark as the fallback, and upstream's official-brand package never
 * fills it — registering it here throws "slot is not declared (a parent
 * entry's children table must declare it)" during boot, which aborts the root
 * render and leaves the window on its near-black backdrop.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, SaturnGlyph)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, SaturnName)
    }))
}
