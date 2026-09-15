/**
 * The fleet route surface: one quiet, fact-derived line per delegated worker,
 * beneath the composer card in the conversation it belongs to.
 *
 * The product's posture is that it delegates by default, so a parallel fan-out
 * must be readable at a glance and must never read as losing control of your own
 * session. Each line is one route: the worker's label, its one state word, and
 * the colour dot that state already owns elsewhere in the product. The header
 * counts working and attention routes. Each route retains one status, with no
 * estimated percentage, elapsed time, or second row metric.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Session standard seats (useSessions, pending interaction).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: merges the `goal` projection value read off each list row.
import type {} from '@deepseek-ai/dsh-goal/client'
import { deriveFleet, fleetRoster, type FleetLine } from './fleet.ts'
import type { FleetInjected } from './index.ts'
import { NS } from './locales.ts'
import css from './FleetRoute.module.css'

/** Full props for the fleet route surface. */
export type FleetRouteProps =
  PropsRuntime<'conversation.composer.dock'> & InjectFace<FleetInjected> & PropsLocale<typeof NS>

/**
 * The dot each state wears. These are the product's own four state semantics
 * (`ui-primitives/StateDot`): amber is the attention the sidebar already gives
 * a pending interaction, red is a stop something went wrong at, the animated
 * matrix is live work, green is settled.
 */
const DOT: Record<FleetLine['status'], StateDotState> = {
  'waiting-for-you': 'warning',
  blocked: 'error',
  running: 'ongoing',
  done: 'done',
}

/** Closed-union exhaustiveness fence for the four statuses. */
/* v8 ignore next 3 -- closed-status backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled fleet status: ${JSON.stringify(value)}`)
}

/**
 * The pending need in the product's own words. The three dedicated kinds are
 * the ones the sidebar names (`ui-workspace/src/client/tree.ts`); any other kind
 * is still a human waiting, so it takes the generic word rather than silence.
 */
function needText(need: string, t: TranslateNS<typeof NS>): string {
  switch (need) {
    case 'approval': return t('need.approval')
    case 'plan-review': return t('need.planReview')
    case 'question': return t('need.question')
    default: return t('status.waiting')
  }
}

/** One line's state, as the single word a reader can act on. */
function lineText(line: FleetLine, t: TranslateNS<typeof NS>): string {
  switch (line.status) {
    case 'waiting-for-you': return needText(line.need, t)
    case 'blocked': return t('status.blocked', { blocker: line.blocker })
    case 'running': return t('status.running')
    case 'done': return t('status.done')
    /* v8 ignore next -- closed status union */
    default: return assertNever(line)
  }
}

/**
 * Fleet route surface: the delegated subtree of this conversation, one line per
 * non-settled worker, with an expandable three-route preview. Rows are ordinary buttons — Enter and Space activate
 * them, the skin's white focus ring shows where they are, and the accessible
 * name carries the same words the row paints. Nothing here opens a menu, so
 * there is no Escape to handle.
 * @param props - runtime slot currency, the injected navigation face, translator.
 * @returns the route list, or the designed empty line when nothing is delegated.
 */
export function FleetRoute({
  sessionId, useSessions, useSessionPendingInteraction, openWorker, t,
}: FleetRouteProps) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setExpanded(false) }, [sessionId])
  const byId = useSessions(state => state.byId)
  const jobs = useSessions(state => state.jobsBySession)
  const pending = useSessionPendingInteraction(state => state)
  const lines = useMemo(
    () => deriveFleet(sessionId, fleetRoster(byId, jobs, pending)),
    [sessionId, byId, jobs, pending],
  )
  const attention = lines.filter(line => line.status === 'waiting-for-you' || line.status === 'blocked').length
  const running = lines.filter(line => line.status === 'running').length
  const visibleLines = expanded ? lines : lines.slice(0, 3)

  if (lines.length === 0) {
    return (
      <div className={css.root} data-fleet="empty">
        <span className={css.empty}>{t('empty')}</span>
      </div>
    )
  }

  return (
    <div className={css.root} data-fleet="routes">
      <div className={css.heading}>
        <span>{t('heading')}</span>
        {running > 0 && <span>{t('summary.running', { count: running })}</span>}
        {attention > 0 && <span className={css.attention}>{t('summary.attention', { count: attention })}</span>}
      </div>
      <div className={css.list} role="group" aria-label={t('list.aria')}>
        {visibleLines.map((line) => {
          const text = lineText(line, t)
          return (
            <button
              key={line.id}
              type="button"
              className={css.row}
              data-status={line.status}
              aria-label={`${line.label}. ${text}. ${t('row.open')}`}
              onClick={() => { openWorker(line.id) }}
            >
              <StateDot state={DOT[line.status]} className={css.dot} />
              <span className={css.label} title={line.label}>{line.label}</span>
              <span className={css.status} title={text}>{text}</span>
            </button>
          )
        })}
      </div>
      {lines.length > 3 && <button type="button" className={css.expand} aria-expanded={expanded} onClick={() => { setExpanded(current => !current) }}>
        {expanded ? t('collapse') : t('expand', { count: lines.length - 3 })}
      </button>}
    </div>
  )
}
