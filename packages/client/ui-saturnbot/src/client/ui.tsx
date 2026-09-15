/** Small presentational elements shared inside the SaturnBot dashboard. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotBranch, BotSnapshot } from '@saturnai/dsh-saturnbot/client'
import type { NS, SaturnBotKey } from './locales.ts'
import css from './Dashboard.module.css'

export type BotTranslate = TranslateNS<typeof NS>

/** Format a recorded host timestamp in the user's locale. */
export function timeLabel(time: string | null, t: BotTranslate): string {
  return time === null ? t('time.pending') : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time))
}

/** Status remains explicit text; color is supplementary. */
export function Status({ value, t }: { value: string; t: BotTranslate }) {
  return <span className={css.status} data-status={value}><i aria-hidden="true" />{t(`status.${value}` as SaturnBotKey)}</span>
}

/** A real empty state that explains where future records will come from. */
export function Empty({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className={css.empty}><svg className={css.emptyMark} viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" strokeWidth="1.2" /></svg><h3>{title}</h3>{detail && <p>{detail}</p>}{children}</div>
}

/** Internal panel heading, with an optional action. */
export function PanelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <div className={css.panelHeading}><h2>{title}</h2>{children}</div>
}

/** Exact branch progress from the admitted action index, with error and revision details. */
export function BranchCard({ branch, t, expanded = false }: { branch: BotBranch; t: BotTranslate; expanded?: boolean }) {
  return (
    <article className={css.branch} data-status={branch.status}>
      <div className={css.branchTop}><span className={css.eyebrow}>{t(`role.${branch.task.role}`)}</span><Status value={branch.status} t={t} /></div>
      <h3>{branch.task.title}</h3>
      {branch.summary && <p>{branch.summary}</p>}
      <div className={css.progress} aria-hidden="true"><span style={{ width: `${branch.actions.length === 0 ? 0 : Math.min(100, branch.nextAction / branch.actions.length * 100)}%` }} /></div>
      <span className={css.meta}>{t('runs.actions', { done: branch.nextAction, total: branch.actions.length })}</span>
      {branch.error && <div className={css.error} role="alert">{branch.error}</div>}
      {expanded && <>
        <details className={css.disclosure}><summary>{t('runs.instruction')}</summary><p>{branch.task.instruction}</p></details>
        {branch.stage && <dl className={css.facts}><dt>{t('runs.stage')}</dt><dd><code>{branch.stage.path}</code></dd><dt>{t('runs.revision')}</dt><dd><code>{branch.stage.revision}</code></dd></dl>}
        {branch.validatedRevision && <p className={css.meta}>{t('runs.validated')}: <code>{branch.validatedRevision}</code></p>}
      </>}
    </article>
  )
}

/** Combine the active run and retained run history without duplicating one run. */
export function allCycles(snapshot: BotSnapshot) {
  const rows = new Map(snapshot.cycles.map(cycle => [cycle.id, cycle]))
  if (snapshot.activeCycle !== null) rows.set(snapshot.activeCycle.id, snapshot.activeCycle)
  return [...rows.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
