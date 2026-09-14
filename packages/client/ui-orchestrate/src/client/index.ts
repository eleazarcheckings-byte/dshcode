/**
 * Multi-task toggle plugin, browser half: occupies the composer's left control
 * list (`conversation.input.left`, the declared list seat next to the permission
 * trigger) with a two-state toggle. State rides the host `orchestrate`
 * projection through the standard-kit `useProjection`; the click executes
 * `/orchestrate on|off` through `command.execute`, so the control and the slash
 * command share one logged event and one result line — zero client-side mode
 * state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@saturnai/dsh-orchestrate/client'
import { OrchestrateToggle } from './OrchestrateToggle.tsx'
import { en, zh, type OrchestrateKey } from './locales.ts'

export type { OrchestrateKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer multi-task toggle's copy. */
    orchestrate: OrchestrateKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'orchestrate'

/** Injected business face of the composer multi-task seat. */
export interface OrchestrateToggleInjected {
  /**
   * Set multi-task mode by executing /orchestrate on|off.
   * @param active - the state to put the session in.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  toggle: (active: boolean) => Promise<string | null>
}

/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the multi-task toggle over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestrate: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'multi-task',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): OrchestrateToggleInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      toggle: async (active) => {
        const result = await ctx.remote.commands.execute(
          sessionId,
          `/orchestrate ${active ? 'on' : 'off'}`,
          [],
        )
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /orchestrate'
        return null
      },
    }),
  }, OrchestrateToggle))
}
