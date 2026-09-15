/**
 * Definition-of-done plugin, browser half: occupies one Session-header utility
 * seat (`conversation.session.header.utilities`) with the session's stated
 * contract as a compact chip — ring, status, and the contract in one truncated
 * line. Clicking the chip opens a glass panel carrying the whole record: the
 * statement and its evidence, the editor, the turn receipt joining the paths
 * this turn changed, and the checkpoints a restore can put back. The header
 * keeps the record visible without spending transcript width on it.
 * State rides the host `done` projection through the standard-kit
 * `useProjection`; the receipt's turn facts ride the Chat target's timeline
 * through the standard-kit `useConversation`. Every verb executes a `/done`
 * command through `remote.commands.execute`, so the chip and the slash command
 * share one logged event and one result line — zero client-side contract state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the header utilities seat).
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
// Type-only: pulls the `checkpoints` SessionProjectionMap merge the restore row reads.
import type {} from '@saturnai/dsh-checkpoints/client'
import { DefinitionOfDone } from './DefinitionOfDone.tsx'
import { en, zh, type DoneKey } from './locales.ts'

export type { DoneKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The definition-of-done chip's copy. */
    done: DoneKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'done'

/** Injected business face of the definition-of-done header seat. */
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
  /**
   * Put one checkpoint's recorded bytes back by executing /checkpoint restore <id>.
   * The host verifies the whole plan before it writes anything, records the
   * current state first (so the restore is itself undoable), and refuses
   * wholesale rather than partially.
   * @param id - the checkpoint id to restore.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  restoreCheckpoint: (id: string) => Promise<string | null>
}

/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the definition-of-done chip over the command
 * channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-done: dictionaries')

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    /* The right-aligned Session utilities, after the header's own controls: the
       contract is a standing readout about this Session, not an action on it. */
    id: 'definition-of-done',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): DoneDockInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      setStatement: async statement => await execute(ctx, sessionId, `/done -- ${statement}`),
      prove: async evidence => await execute(ctx, sessionId, `/done prove ${evidence}`),
      clear: async () => await execute(ctx, sessionId, '/done clear'),
      restoreCheckpoint: async id => await execute(ctx, sessionId, `/checkpoint restore ${id}`),
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
