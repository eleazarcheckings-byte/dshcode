/**
 * Definition-of-done strip plugin, browser half: occupies the composer's
 * context-stack dock (`conversation.input.dock`, the declared list seat shared
 * with the todo, goal, and queue cards) with the session's stated contract —
 * and, folded into that same card, the turn receipt joining the paths this turn
 * changed with the evidence that met the contract.
 * State rides the host `done` projection through the standard-kit
 * `useProjection`; the receipt's turn facts ride the Chat target's timeline
 * through the standard-kit `useConversation`. Every verb executes a `/done`
 * command through `remote.commands.execute`, so the strip and the slash command
 * share one logged event and one result line — zero client-side contract state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Chat target's view snapshot over the turn timeline.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the `deliverables` turn-data key the timeline is read through.
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the `done` SessionProjectionMap merge for useProjection.
import type {} from '@saturnai/dsh-done/client'
import { DefinitionOfDone } from './DefinitionOfDone.tsx'
import { en, zh, type DoneKey } from './locales.ts'

export type { DoneKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The definition-of-done strip's copy. */
    done: DoneKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'done'

/** Injected business face of the composer definition-of-done seat. */
export interface DoneDockInjected {
  /**
   * Set or amend the contract by executing /done -- <statement>.
   * @param statement - the one- or two-sentence definition of done.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  setStatement: (statement: string) => Promise<string | null>
  /**
   * Mark the contract proven by executing /done prove <evidence>.
   * @param evidence - the one line of evidence that met it.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  prove: (evidence: string) => Promise<string | null>
  /**
   * Remove the contract by executing /done clear.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  clear: () => Promise<string | null>
}

/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the definition-of-done strip over the command
 * channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-done: dictionaries')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    // Ahead of the goal card (10): both are contracts, and the outer one — what
    // this whole piece of work is for — frames the objective under it.
    id: 'definition-of-done',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): DoneDockInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      setStatement: async statement => await execute(ctx, sessionId, `/done -- ${statement}`),
      prove: async evidence => await execute(ctx, sessionId, `/done prove ${evidence}`),
      clear: async () => await execute(ctx, sessionId, '/done clear'),
    }),
  }, DefinitionOfDone))
}

/** Run one /done verb; a rejected or unanswered command becomes the strip's error line. */
async function execute(ctx: ClientContext, sessionId: SessionId, input: string): Promise<string | null> {
  const result = await ctx.remote.commands.execute(sessionId, input, [])
  if (!result.ok) return `${result.error.message} (${result.error.code})`
  if (result.value === undefined) return `unknown command: ${input}`
  return null
}
