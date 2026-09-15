/** Run, approval, and durable briefing views over the actual runtime journal. */
import { useMemo, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotApproval, BotEvent, BotId, BotReport, BotSnapshot } from '@saturnai/dsh-saturnbot/client'
import { allCycles, BranchCard, Empty, PanelHeading, Status, timeLabel, type BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'
import type { SaturnBotViewState } from './contracts.ts'

/** One event's operator-facing text, leaving model and tool text verbatim. */
function eventTitle(event: BotEvent, t: BotTranslate): string {
  return event.type === 'trace' ? t(`trace.${event.trace.kind}`) : t(`event.${event.type}`)
}

/** A bounded journal list with expandable tool payloads and failures. */
export function Activity({ events, t, empty }: { events: readonly BotEvent[]; t: BotTranslate; empty?: string }) {
  if (events.length === 0) return <p className={css.emptyInline}>{empty ?? t('overview.noActivity')}</p>
  return <ol className={css.activity}>{[...events].reverse().map(event => (
    <li key={event.seq} data-error={event.type === 'trace' && event.trace.kind === 'tool-error' || undefined}>
      <span className={css.activityDot} aria-hidden="true" />
      <div className={css.activityBody}>
        <div className={css.activityHeader}>
          <strong>{eventTitle(event, t)}</strong><time dateTime={event.at}>{timeLabel(event.at, t)}</time>
        </div>
        {event.type === 'trace' && <>
          {event.trace.tool && <code className={css.toolName}>{event.trace.tool}</code>}
          <p>{event.trace.summary}</p>
          {event.trace.data !== undefined && <details className={css.disclosure}><summary>{t('runs.payload')}</summary><pre>{JSON.stringify(event.trace.data, null, 2)}</pre></details>}
        </>}
        {event.type === 'alert' && <p>{event.alert.message}</p>}
        {event.type === 'report' && <p>{event.report.title}</p>}
        {event.type === 'approval' && <p><code>{event.approval.tool}</code> · <Status value={event.approval.status} t={t} /></p>}
      </div>
    </li>
  ))}</ol>
}

/** Run selection preserves all recorded specialist statuses and inspectable payloads. */
export function Runs({ snapshot, events, t }: { snapshot: BotSnapshot; events: readonly BotEvent[]; t: BotTranslate }) {
  const cycles = allCycles(snapshot)
  const [selected, setSelected] = useState<BotId | null>(null)
  const current = cycles.find(cycle => cycle.id === selected) ?? cycles[0]
  if (current === undefined) return <Empty title={t('runs.empty')} detail={t('runs.emptyBody')} />
  const trace = events.filter(event => event.type === 'trace' && event.trace.cycleId === current.id)
  return <div className={css.historyLayout}>
    <div className={css.runList} aria-label={t('nav.runs')}>{cycles.map(cycle => (
      <button key={cycle.id} className={css.runChoice} aria-pressed={cycle.id === current.id} onClick={() => { setSelected(cycle.id) }}>
        <span>{timeLabel(cycle.startedAt, t)}</span><Status value={cycle.status} t={t} /><code>{cycle.id.slice(0, 12)}</code>
      </button>
    ))}</div>
    <div className={css.historyDetail}>
      <div className={css.runDetailHeader}><div><span className={css.eyebrow}>{t('runs.started')}</span><h2>{timeLabel(current.startedAt, t)}</h2></div><Status value={current.status} t={t} /></div>
      <dl className={css.facts}><dt>{t('runs.finished')}</dt><dd>{timeLabel(current.finishedAt, t)}</dd></dl>
      {current.plan && <section className={css.panel}><PanelHeading title={t('runs.plan')} /><p className={css.planText}>{current.plan}</p></section>}
      <section><PanelHeading title={t('runs.branches')} /><div className={css.branchGrid}>{current.branches.map(branch => <BranchCard key={branch.id} branch={branch} t={t} expanded />)}</div>{current.branches.length === 0 && <p className={css.emptyInline}>{t('runs.noBranches')}</p>}</section>
      <section className={css.panel}><PanelHeading title={t('runs.trace')} /><p className={css.muted}>{t('runs.recentTrace')}</p><Activity events={trace} t={t} empty={t('runs.noTrace')} /></section>
    </div>
  </div>
}

/** Exact approval payload, stage, and one-action decision controls. */
function ApprovalCard({ approval, busy, decide, t }: {
  approval: BotApproval
  busy: boolean
  decide: (id: BotId, allowed: boolean) => void
  t: BotTranslate
}) {
  return <article className={css.approvalCard}>
    <div className={css.branchTop}><code className={css.approvalTool}>{approval.tool}</code><Status value={approval.status} t={t} /></div>
    <p className={css.meta}>{t('approvals.created')}: {timeLabel(approval.createdAt, t)}</p>
    <dl className={css.facts}><dt>{t('approvals.branch')}</dt><dd><code>{approval.branchId}</code></dd>
      {approval.stage ? <><dt>{t('runs.stage')}</dt><dd><code>{approval.stage.path}</code></dd><dt>{t('runs.revision')}</dt><dd><code>{approval.stage.revision}</code></dd></> : <><dt>{t('runs.stage')}</dt><dd>{t('approvals.noStage')}</dd></>}
    </dl>
    <details className={css.disclosure} open><summary>{t('approvals.input')}</summary><pre>{JSON.stringify(approval.input, null, 2)}</pre></details>
    {approval.status === 'pending' && <div className={css.approvalFooter}><p>{t('approvals.exact')}</p><div className={css.actions}><button disabled={busy} className={css.button} onClick={() => { decide(approval.id, false) }}>{t('action.reject')}</button><button disabled={busy} className={css.primary} onClick={() => { decide(approval.id, true) }}>{t('action.approve')}</button></div></div>}
  </article>
}

/** Pending and settled approvals remain separate, with authoritative server status. */
export function Approvals({ snapshot, busy, decide, t }: {
  snapshot: BotSnapshot
  busy: boolean
  decide: (id: BotId, allowed: boolean) => void
  t: BotTranslate
}) {
  const pending = snapshot.approvals.filter(approval => approval.status === 'pending')
  const history = snapshot.approvals.filter(approval => approval.status !== 'pending')
  return <div className={css.pageStack}>
    {pending.length === 0 ? <Empty title={t('approvals.empty')} detail={t('approvals.emptyBody')} /> : <section><PanelHeading title={t('approvals.pending')} /><div className={css.approvalGrid}>{pending.map(approval => <ApprovalCard key={approval.id} approval={approval} busy={busy} decide={decide} t={t} />)}</div></section>}
    {history.length > 0 && <section><PanelHeading title={t('approvals.history')} /><div className={css.approvalGrid}>{history.map(approval => <ApprovalCard key={approval.id} approval={approval} busy={busy} decide={decide} t={t} />)}</div></section>}
  </div>
}

/** Markdown briefings use the shared untrusted-document renderer. */
export function ReportBody({ report, t }: { report: BotReport; t: BotTranslate }) {
  const labels = useMemo(() => ({ code: { copyLabel: t('action.copy'), copiedLabel: t('action.copied') }, footnotes: t('memory.footnotes') }), [t])
  return <article className={css.reportBody}><header><span className={css.eyebrow}>{report.date}</span><h2>{report.title}</h2><p className={css.meta}>{t('memory.channel')}: {report.channel}</p></header><MarkdownText text={report.markdown} labels={labels} /></article>
}

/** Durable report inbox and alerts; no inferred long-term agent memory is presented. */
export function Memory({ snapshot, records, search, t }: { snapshot: BotSnapshot; records: Pick<SaturnBotViewState, 'memory' | 'tickets' | 'webhooks' | 'recordsLoading'>; search: (query: string) => void; t: BotTranslate }) {
  const [selected, setSelected] = useState<BotId | null>(null)
  const [query, setQuery] = useState('')
  const reports = snapshot.reports
  const current = reports.find(report => report.id === selected) ?? reports[0]
  return <div className={css.pageStack}>
    <section className={css.panel}><PanelHeading title={t('memory.facts')} /><form className={css.memorySearch} onSubmit={(event) => { event.preventDefault(); search(query) }}><input aria-label={t('memory.search')} placeholder={t('memory.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} /><button className={css.button} disabled={records.recordsLoading}>{t('memory.searchAction')}</button></form>
      {records.recordsLoading ? <p role="status" className={css.muted}>{t('state.loading')}</p> : records.memory.length === 0 ? <p className={css.emptyInline}>{t('memory.noFacts')}</p> : <ul className={css.alertList}>{records.memory.map(record => <li key={record.key}><code className={css.toolName}>{record.key}</code><p>{record.value}</p><time dateTime={record.updatedAt}>{timeLabel(record.updatedAt, t)}</time></li>)}</ul>}
    </section>
    {current ? <div className={css.historyLayout}><div className={css.runList}><PanelHeading title={t('memory.reports')} />{reports.map(report => <button key={report.id} className={css.runChoice} aria-pressed={report.id === current.id} onClick={() => { setSelected(report.id) }}><span>{report.title}</span><span className={css.meta}>{report.date}</span></button>)}</div><ReportBody report={current} t={t} /></div> : <Empty title={t('memory.empty')} detail={t('memory.emptyBody')} />}
    {snapshot.alerts.length > 0 && <section className={css.panel}><PanelHeading title={t('memory.alerts')} /><ul className={css.alertList}>{snapshot.alerts.map(alert => <li key={alert.id}><p>{alert.message}</p><time dateTime={alert.createdAt}>{timeLabel(alert.createdAt, t)}</time></li>)}</ul></section>}
    {records.tickets.length > 0 && <section className={css.panel}><PanelHeading title={t('memory.tickets')} /><ul className={css.alertList}>{records.tickets.map(ticket => <li key={ticket.id}><div className={css.branchTop}><strong>{ticket.subject}</strong><Status value={ticket.status} t={t} /></div><p>{ticket.body}</p><time dateTime={ticket.updatedAt}>{timeLabel(ticket.updatedAt, t)}</time></li>)}</ul></section>}
    {records.webhooks.length > 0 && <section className={css.panel}><PanelHeading title={t('memory.webhooks')} />{records.webhooks.map(webhook => <details key={webhook.deliveryId} className={css.disclosure}><summary>{webhook.source} · {timeLabel(webhook.receivedAt, t)}</summary><pre>{JSON.stringify(webhook.payload, null, 2)}</pre></details>)}</section>}
  </div>
}
