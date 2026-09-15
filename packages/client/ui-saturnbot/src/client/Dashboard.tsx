/** SaturnBot's agent-centric conversation workspace and live execution inspector. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotConfig, BotMessage, BotRole, BotSnapshot } from '@saturnai/dsh-saturnbot/client'
import type { DashboardProps, BotPage } from './contracts.ts'
import { Avatar } from './Avatar.tsx'
import { Configuration, Connections, RoleConfiguration } from './Configuration.tsx'
import { Activity, Approvals, Memory, ReportBody, Runs } from './History.tsx'
import { ExecutionCanvas } from './ExecutionCanvas.tsx'
import { StatusStrip } from './StatusStrip.tsx'
import { FirstRunWizard, type SaturnBotWizardStep } from './Wizard.tsx'
import { allCycles, BranchCard, Empty, PanelHeading, Status, timeLabel, type BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'

const ROLES: readonly BotRole[] = ['orchestrator', 'developer', 'growth', 'operations', 'finance']
type Surface = 'conversation' | Exclude<BotPage, 'overview'>

/** Select role-specific execution state from the current authoritative cycle. */
function roleStatus(snapshot: BotSnapshot, role: BotRole): string {
  if (role === 'orchestrator') return snapshot.status
  const branches = snapshot.activeCycle?.branches.filter(branch => branch.task.role === role) ?? []
  if (branches.some(branch => branch.status === 'awaiting-approval')) return 'awaiting-approval'
  if (branches.some(branch => branch.status === 'running' || branch.status === 'planning')) return 'running'
  if (!snapshot.config.roles[role].enabled) return 'disabled'
  return 'idle'
}

/** Latest published text is a preview, never an invented activity indicator. */
function rolePreview(snapshot: BotSnapshot, role: BotRole, t: BotTranslate): string {
  return [...snapshot.messages].reverse().find(message => message.role === role)?.content ?? t(`role.${role}.detail`)
}

/** A journal-backed message bubble. The runtime supplies explicit sender identity. */
function Message({ message, t }: { message: BotMessage; t: BotTranslate }) {
  return <article className={css.message} data-sender={message.sender}>
    <div className={css.messageMeta}>{message.sender === 'user' ? t('chat.you') : message.sender === 'system' ? t('chat.system') : t(`role.${message.role}`)}<time dateTime={message.at}>{timeLabel(message.at, t)}</time></div>
    <div className={css.messageBubble}>{message.content}</div>
  </article>
}

/** The primary management surface follows the selected specialist while subviews remain nearby. */
export function Dashboard({ state, workspaces, actions, pickDirectory, t }: DashboardProps) {
  const [role, setRole] = useState<BotRole>('orchestrator')
  const [surface, setSurface] = useState<Surface>('conversation')
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Partial<Record<BotRole, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inspector, setInspector] = useState(() => window.innerWidth >= 1100)
  const [visualizationMotion, setVisualizationMotion] = useState(true)
  const [wizardOverride, setWizardOverride] = useState<boolean | null>(null)
  const [wizardStep, setWizardStep] = useState<SaturnBotWizardStep | undefined>(undefined)
  const timeline = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)
  const snapshot = state.snapshot
  const messages = snapshot?.messages.filter(message => message.role === role) ?? []
  const messageTail = messages.at(-1)?.id

  useEffect(() => {
    if (pinned.current && timeline.current !== null) timeline.current.scrollTop = timeline.current.scrollHeight
  }, [messageTail, role, surface])
  useEffect(() => {
    if (surface === 'memory') void actions.loadRecords('').catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }, [surface, actions.loadRecords])

  const perform = async (key: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(null)
    try {
      await operation()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('state.mutationError'))
      throw failure
    } finally { setBusy(null) }
  }
  const execute = (key: string, operation: () => Promise<void>): void => {
    void perform(key, operation).catch(() => { /* The message above is the operator-visible failure. */ })
  }
  const save = (patch: Partial<BotConfig>): Promise<void> => perform('configure', () => actions.configure(patch))
  const choose = (next: BotRole): void => { setRole(next); setSurface('conversation'); pinned.current = true }
  const draft = drafts[role] ?? ''
  const running = snapshot !== null && snapshot.activeCycle !== null
  const configured = snapshot !== null && snapshot.config.workspace !== '' && snapshot.config.provider !== '' && snapshot.config.model !== ''
  const readyToSchedule = configured && snapshot.config.goal.trim() !== '' && snapshot.status !== 'needs-setup'
  const wizardActive = wizardOverride ?? (snapshot !== null && snapshot.status === 'needs-setup')
  const goToWizardStep = (step: SaturnBotWizardStep): void => { setWizardOverride(true); setWizardStep(step); setSurface('settings') }
  const canSend = configured && !running && busy === null && draft.trim() !== '' && snapshot.config.roles[role].enabled
  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (!canSend) return
    const submittedRole = role, text = draft.trim()
    void perform('message', () => actions.message(submittedRole, text)).then(() => {
      setDrafts(current => current[submittedRole]?.trim() === text ? { ...current, [submittedRole]: '' } : current)
      pinned.current = true
      composer.current?.focus()
    }).catch(() => { /* Failed sends retain the draft; perform exposes the error. */ })
  }
  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  const pending = snapshot?.approvals.filter(approval => approval.status === 'pending') ?? []
  const inspectedCycle = snapshot === null ? undefined : allCycles(snapshot).find(cycle =>
    role === 'orchestrator' || cycle.branches.some(branch => branch.task.role === role),
  )
  const branchIds = new Set(inspectedCycle?.branches.filter(branch => role === 'orchestrator' || branch.task.role === role).map(branch => branch.id) ?? [])
  const approvals = pending.filter(approval => role === 'orchestrator' || branchIds.has(approval.branchId))
  const roleBranches = snapshot?.activeCycle?.branches.filter(branch => role === 'orchestrator' || branch.task.role === role) ?? []
  const roleEvents = state.events.filter(event => event.type === 'trace' && (role === 'orchestrator' || event.trace.branchId !== null && branchIds.has(event.trace.branchId)))
  const filteredRoles = ROLES.filter(candidate => `${t(`role.${candidate}`)} ${snapshot === null ? t(`role.${candidate}.detail`) : rolePreview(snapshot, candidate, t)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const reports = snapshot?.reports.filter(report => role === 'orchestrator' || allCycles(snapshot).some(cycle => cycle.id === report.cycleId && cycle.branches.some(branch => branch.task.role === role))) ?? []
  const latestReport = reports[0]

  return <div className={css.dashboard} data-inspector={inspector || undefined} data-saturnbot-dashboard="">
    <aside className={css.sidebar} aria-label={t('nav.label')}>
      <div className={css.sidebarBrand}><SaturnLogo size={22} /><span>{t('brand')}</span><svg className={css.brandVersion} viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.2" /></svg></div>
      <label className={css.search}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 4 4" /></svg><input aria-label={t('chat.searchLabel')} placeholder={t('chat.search')} value={search} onChange={(event) => { setSearch(event.target.value) }} /></label>
      {filteredRoles.includes('orchestrator') && <button className={css.chief} aria-label={t('chat.chief')} data-selected={role === 'orchestrator' && surface === 'conversation' || undefined} onClick={() => { choose('orchestrator') }}><Avatar role="orchestrator" large /><strong>{t('chat.chief')}</strong><span>{t('brand.caption')}</span>{snapshot && <Status value={roleStatus(snapshot, 'orchestrator')} t={t} />}</button>}
      <div className={css.rosterHeading}>{t('chat.roles')}</div>
      <nav className={css.roster}>{filteredRoles.filter(candidate => candidate !== 'orchestrator').map(candidate => <button key={candidate} className={css.agentChoice} aria-pressed={role === candidate && surface === 'conversation'} onClick={() => { choose(candidate) }}><Avatar role={candidate} /><span className={css.agentCopy}><strong>{t(`role.${candidate}`)}</strong><span>{snapshot ? rolePreview(snapshot, candidate, t) : t(`role.${candidate}.detail`)}</span></span>{snapshot && <span className={css.agentLamp} data-status={roleStatus(snapshot, candidate)} title={t(`status.${roleStatus(snapshot, candidate)}` as Parameters<BotTranslate>[0])} />}</button>)}</nav>
      {filteredRoles.length === 0 && <p className={css.emptyInline}>{t('chat.noAgents')}</p>}
      <div className={css.sidebarBottom}><div className={css.workspaceIdentity}><span className={css.eyebrow}>{t('nav.workspace')}</span><span title={snapshot?.config.workspace}>{workspaces.find(workspace => workspace.path === snapshot?.config.workspace)?.title ?? snapshot?.config.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? t('nav.noWorkspace')}</span></div>
        <div className={css.utilityNav}>{(['connections', 'settings'] as const).map(page => <button key={page} className={css.utilityButton} aria-pressed={surface === page} onClick={() => { setSurface(page) }}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">{page === 'connections' ? <><path d="M5 1v5M11 1v5M3 6h10v2a5 5 0 0 1-5 5v2M8 13v2" /></> : <><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5 13 13M13 3l-1.5 1.5M4.5 11.5 3 13" /></>}</svg>{t(`nav.${page}`)}</button>)}</div>
      </div>
    </aside>

    <main className={css.main}>
      <header className={css.mainHeader}><div className={css.selectedIdentity}><Avatar role={role} /><div><h1>{surface === 'conversation' ? t(`role.${role}`) : t(`nav.${surface}`)}</h1><span>{surface === 'conversation' ? t(`role.${role}.detail`) : t(`header.${surface}`)}</span></div></div><div className={css.headerActions}><button className={css.iconButton} disabled={busy !== null} title={t('action.refresh')} aria-label={t('action.refresh')} onClick={() => { execute('refresh', actions.refresh) }}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="M16 7a6 6 0 1 0 .2 5M16 3v4h-4" /></svg></button><button className={css.iconButton} title={t(inspector ? 'chat.hideInspector' : 'chat.showInspector')} aria-label={t(inspector ? 'chat.hideInspector' : 'chat.showInspector')} aria-expanded={inspector} onClick={() => { setInspector(current => !current) }}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M12 4v12" /></svg></button></div></header>
      {(state.error || error) && <div className={css.notice} role="alert">{error ?? state.error}</div>}
      {state.loading && snapshot === null ? <div className={css.loading} role="status">{t('state.loading')}</div> : snapshot === null ? <Empty title={t('state.error')}><button className={css.button} onClick={() => { execute('refresh', actions.refresh) }}>{t('action.refresh')}</button></Empty> : surface === 'conversation' ? <>
        <div ref={timeline} className={css.timeline} role="log" aria-label={t('chat.timeline', { role: t(`role.${role}`) })} aria-live="polite" onScroll={(event) => { const target = event.currentTarget; pinned.current = target.scrollHeight - target.scrollTop - target.clientHeight < 64 }}>
          {messages.length === 0 && <div className={css.conversationWelcome}><Avatar role={role} large /><h2>{t('chat.noMessages')}</h2><p>{t('chat.noMessagesBody', { role: t(`role.${role}`) })}</p></div>}
          {messages.map(message => <Message key={message.id} message={message} t={t} />)}
          {approvals.length > 0 && <div className={css.inlineApproval}><div className={css.branchTop}><span>{t('chat.approvals', { count: approvals.length })}</span><Status value="awaiting-approval" t={t} /></div><div className={css.inlineApprovalTools}>{approvals.map(approval => <code key={approval.id}>{approval.tool}</code>)}</div><button className={css.button} onClick={() => { setSurface('approvals') }}>{t('action.viewApprovals')}</button></div>}
          {latestReport && <details className={css.timelineReport}><summary><span className={css.eyebrow}>{t('overview.latestReport')}</span><strong>{latestReport.title}</strong><span>{latestReport.date}</span></summary><ReportBody report={latestReport} t={t} /></details>}
        </div>
        <form className={css.composer} onSubmit={submit}>{!configured ? <p className={css.composerNotice}>{t('chat.configure')} <button type="button" onClick={() => { setSurface('settings') }}>{t('action.setup')}</button></p> : running ? <p className={css.composerNotice}>{t('chat.busy')}</p> : null}<div className={css.composerCard}><textarea ref={composer} aria-label={t('chat.placeholder', { role: t(`role.${role}`) })} placeholder={t('chat.placeholder', { role: t(`role.${role}`) })} rows={2} maxLength={8000} value={draft} onChange={(event) => { setDrafts(current => ({ ...current, [role]: event.target.value })) }} onKeyDown={onComposerKey} disabled={!configured || busy === 'message'} /><div className={css.composerFooter}><span>{t('chat.hint')}</span><button type="submit" className={css.send} aria-label={t('chat.send')} disabled={!canSend}><svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true"><path d="M10 15V5M5 10l5-5 5 5" /></svg></button></div></div></form>
      </> : <div className={css.subview}><button className={css.backButton} onClick={() => { setSurface('conversation') }}>{t('chat.back')}</button>
        {surface === 'runs' && <><Runs snapshot={snapshot} events={state.events} t={t} /><button className={css.linkButton} disabled={busy !== null} onClick={() => { execute('events', actions.loadMoreEvents) }}>{t('action.loadMore')}</button></>}
        {surface === 'memory' && <Memory snapshot={snapshot} records={state} search={(query) => { execute('records', () => actions.loadRecords(query)) }} t={t} />}
        {surface === 'approvals' && <Approvals snapshot={snapshot} busy={busy !== null} decide={(id, allowed) => { execute(`approval:${id}`, () => actions.approve(id, allowed)) }} t={t} />}
        {surface === 'settings' && <div className={css.pageStack}>
          <StatusStrip snapshot={snapshot} t={t} onFix={goToWizardStep} />
          {wizardActive
            ? <FirstRunWizard key={wizardStep ?? 'resume'} snapshot={snapshot} workspaces={workspaces} save={save} busy={busy !== null} pickDirectory={pickDirectory} t={t} initialStep={wizardStep} onExit={() => { setWizardOverride(false); setWizardStep(undefined) }} />
            : <>
              <Configuration snapshot={snapshot} workspaces={workspaces} save={save} busy={busy !== null} t={t} />
              <button type="button" className={css.linkButton} onClick={() => { setWizardOverride(true); setWizardStep(undefined) }}>{t('wizard.restart')}</button>
            </>}
        </div>}
        {surface === 'agents' && <RoleConfiguration key={role} role={role} snapshot={snapshot} save={save} busy={busy !== null} t={t} />}
        {surface === 'connections' && <Connections snapshot={snapshot} t={t} />}
      </div>}
    </main>

    {inspector && <aside className={css.inspector} aria-label={t('chat.inspector')}><div className={css.inspectorHeading}><span>{t('chat.inspector')}</span>{snapshot && <div className={css.inspectorHeadingActions}><Status value={snapshot.status} t={t} /><button type="button" className={css.iconButton} aria-label={t(visualizationMotion ? 'canvas.pause' : 'canvas.resume')} title={t(visualizationMotion ? 'canvas.pauseHint' : 'canvas.resumeHint')} onClick={() => { setVisualizationMotion(current => !current) }}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">{visualizationMotion ? <path d="M7 5v10M13 5v10" /> : <path d="m7 5 8 5-8 5V5Z" />}</svg></button></div>}</div>
      {snapshot && <><ExecutionCanvas branches={snapshot.activeCycle?.branches ?? []} motion={visualizationMotion} /><div className={css.inspectorNav}>{(['runs', 'approvals', 'memory'] as const).map(page => <button key={page} aria-pressed={surface === page} onClick={() => { setSurface(page) }}>{t(`nav.${page}`)}{page === 'approvals' && pending.length > 0 && <span>{pending.length}</span>}</button>)}</div>
        <section className={css.inspectorSection}><PanelHeading title={t('chat.overview')} /><p className={css.objective}>{snapshot.config.goal || t('overview.noGoal')}</p><div className={css.actions}><button className={css.primary} disabled={busy !== null || running} onClick={() => { if (readyToSchedule) execute('run', actions.runNow); else setSurface('settings') }}>{t(readyToSchedule ? 'action.run' : 'action.setup')}</button>{running && <button className={css.button} disabled={busy !== null} onClick={() => { execute('cancel', actions.cancel) }}>{t('action.cancel')}</button>}</div></section>
        <section className={css.inspectorSection}><PanelHeading title={t('overview.active')} /><div className={css.inspectorBranches}>{roleBranches.length === 0 ? <div className={css.quietEmpty}><h3>{t('chat.noBranch')}</h3><p>{t('chat.noBranchBody')}</p></div> : roleBranches.map(branch => <BranchCard key={branch.id} branch={branch} t={t} expanded />)}</div></section>
        {roleEvents.length > 0 && <section className={css.inspectorSection}><PanelHeading title={t('runs.trace')} /><Activity events={roleEvents.slice(-8)} t={t} /></section>}
        <section className={css.inspectorSection}><PanelHeading title={t('chat.context')} /><dl className={css.contextFacts}><dt>{t('settings.workspace')}</dt><dd><code>{snapshot.config.workspace || t('nav.noWorkspace')}</code></dd><dt>{t('settings.model')}</dt><dd>{snapshot.config.model || t('status.unconfigured')}</dd><dt>{t('chat.schedule')}</dt><dd>{snapshot.config.enabled ? snapshot.nextRunAt === null ? t('time.interval', { minutes: snapshot.config.intervalMinutes }) : timeLabel(snapshot.nextRunAt, t) : t('status.disabled')}</dd></dl><button className={css.linkButton} disabled={busy !== null} onClick={() => { if (snapshot.config.enabled) execute('schedule', actions.pause); else if (readyToSchedule) execute('schedule', () => actions.configure({ enabled: true })); else setSurface('settings') }}>{t(snapshot.config.enabled ? 'action.pause' : readyToSchedule ? 'action.resume' : 'action.setup')}</button><button className={css.linkButton} onClick={() => { setSurface('agents') }}>{t('chat.agentSettings')}</button></section>
      </>}
    </aside>}
  </div>
}
