/** First-run guided setup: goal, workspace, model, connections, then schedule. */
import { useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BotConfig } from '@saturnai/dsh-saturnbot/client'
import type { SaturnBotSnapshot } from './contracts.ts'
import { IntegrationConnectForms, parseIntegrationsResult } from './ConnectForms.tsx'
import { PanelHeading, type BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'

/** Ordered wizard steps; `schedule` is last because it is optional to enabling a first run. */
const STEPS = ['goal', 'workspace', 'model', 'connections', 'schedule'] as const
export type SaturnBotWizardStep = typeof STEPS[number]

/**
 * Curated, keyless provider identifiers offered as quick picks (SPEC §3 C6's own
 * default profile list). This is static reference data, not a live directory: the
 * harness's actual configured-provider directory is not yet reachable from this
 * package (see the Agent Note); the field stays freeform so any provider still works.
 */
const PROVIDER_PRESETS = ['deepseek', 'anthropic', 'openai', 'google', 'xai', 'moonshotai', 'zai', 'ollama', 'lmstudio'] as const

/** Resume at the first incomplete step, matching how `firstRun` (when present) already reports things. */
export function resumeWizardStep(snapshot: SaturnBotSnapshot): SaturnBotWizardStep {
  const goal = snapshot.firstRun?.goal ?? snapshot.config.goal
  const workspace = snapshot.firstRun?.workspace ?? snapshot.config.workspace
  const provider = snapshot.firstRun?.provider ?? snapshot.config.provider
  if (goal.trim() === '') return 'goal'
  if (workspace.trim() === '') return 'workspace'
  if (provider.trim() === '' || snapshot.config.model.trim() === '') return 'model'
  return 'connections'
}

/**
 * Guided setup driven by `snapshot.firstRun`/`snapshot.integrationCatalog` (SPEC §3
 * C8b). Each step's Continue persists just that step so closing mid-setup keeps
 * progress; Skip and Back never lose an unsaved draft.
 */
export function FirstRunWizard({ snapshot, workspaces, save, busy, pickDirectory, t, onExit, initialStep }: {
  snapshot: SaturnBotSnapshot
  workspaces: readonly WorkspaceView[]
  save: (patch: Partial<BotConfig>) => Promise<void>
  busy: boolean
  /** Opens the Host-native directory picker for the workspace step's Browse button. */
  pickDirectory: () => Promise<string | null>
  t: BotTranslate
  onExit: () => void
  initialStep?: SaturnBotWizardStep | undefined
}) {
  const [step, setStep] = useState<SaturnBotWizardStep>(() => initialStep ?? resumeWizardStep(snapshot))
  const [goal, setGoal] = useState(snapshot.config.goal)
  const [workspace, setWorkspace] = useState(snapshot.config.workspace)
  const [provider, setProvider] = useState(snapshot.config.provider)
  const [model, setModel] = useState(snapshot.config.model)
  const [integrations, setIntegrations] = useState(() => JSON.stringify(snapshot.config.integrations, null, 2))
  const [scheduleEnabled, setScheduleEnabled] = useState(snapshot.config.enabled)
  const [intervalMinutes, setIntervalMinutes] = useState(snapshot.config.intervalMinutes)
  const [error, setError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const index = STEPS.indexOf(step)
  const integrationsResult = parseIntegrationsResult(integrations)
  const parsedIntegrations = integrationsResult.ok ? integrationsResult.value : {}
  const catalog = snapshot.integrationCatalog ?? []
  const browse = (): void => {
    setBrowsing(true)
    void pickDirectory().then((picked) => { if (picked !== null) setWorkspace(picked) }).catch(() => {
      /* No native chooser is available (e.g. a browser-only build); the manual path stays editable. */
    }).finally(() => { setBrowsing(false) })
  }
  const ready: Record<SaturnBotWizardStep, boolean> = {
    goal: goal.trim() !== '',
    workspace: workspace.trim() !== '',
    model: provider.trim() !== '' && model.trim() !== '',
    connections: true,
    schedule: true,
  }

  const commit = (patch: Partial<BotConfig>, after: () => void): void => {
    setError(null)
    void save(patch).then(after).catch(() => { setError(t('wizard.saveError')) })
  }
  const advance = (): void => {
    if (!ready[step]) return
    const at = index
    const patch: Partial<BotConfig> = step === 'goal' ? { goal }
      : step === 'workspace' ? { workspace }
        : step === 'model' ? { provider, model }
          : step === 'connections' ? { integrations: parsedIntegrations }
            : {}
    commit(patch, () => { const upcoming = STEPS[at + 1]; if (upcoming !== undefined) setStep(upcoming) })
  }
  const retreat = (): void => { const previous = STEPS[index - 1]; if (previous !== undefined) setStep(previous) }
  const finish = (): void => { commit({ enabled: scheduleEnabled, intervalMinutes }, onExit) }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (step === 'schedule') finish(); else advance()
  }

  return <form className={css.configForm} onSubmit={submit} aria-label={t('wizard.title')}>
    <p className={css.muted}>{t('wizard.subtitle')}</p>
    <ol className={css.wizardSteps} aria-label={t('wizard.stepsLabel')}>
      {STEPS.map((candidate, position) => <li key={candidate}>
        <button type="button" className={css.wizardStepButton} aria-current={candidate === step || undefined} disabled={busy} onClick={() => { setStep(candidate) }}>
          <span className={css.wizardStepNumber}>{position + 1}</span>{t(`wizard.step.${candidate}`)}
        </button>
      </li>)}
    </ol>
    {error && <p className={css.error} role="alert">{error}</p>}
    {step === 'goal' && <section className={css.panel}><PanelHeading title={t('wizard.step.goal')} /><p className={css.muted}>{t('wizard.step.goal.detail')}</p>
      <label className={css.field}>{t('settings.goal')}<textarea rows={4} value={goal} placeholder={t('settings.goalPlaceholder')} onChange={(event) => { setGoal(event.target.value) }} /><small>{t('settings.goalHint')}</small></label>
    </section>}
    {step === 'workspace' && <section className={css.panel}><PanelHeading title={t('wizard.step.workspace')} /><p className={css.muted}>{t('wizard.step.workspace.detail')}</p>
      <label className={css.field}>{t('settings.workspace')}<select value={workspaces.some(candidate => candidate.path === workspace) ? workspace : ''} onChange={(event) => { setWorkspace(event.target.value) }}><option value="">{t('settings.chooseWorkspace')}</option>{workspaces.map(candidate => <option key={candidate.workspaceId} value={candidate.path}>{candidate.title}</option>)}</select></label>
      <label className={css.field}>{t('settings.workspacePath')}<div className={css.fieldRow}><input value={workspace} onChange={(event) => { setWorkspace(event.target.value) }} /><button type="button" className={css.button} disabled={browsing} aria-label={t('settings.workspaceBrowseLabel')} onClick={browse}>{t('settings.workspaceBrowse')}</button></div></label>
    </section>}
    {step === 'model' && <section className={css.panel}><PanelHeading title={t('wizard.step.model')} /><p className={css.muted}>{t('wizard.step.model.detail')}</p>
      <div className={css.formGrid}>
        <label className={css.field}>{t('settings.provider')}<input value={provider} onChange={(event) => { setProvider(event.target.value) }} list="saturnbot-wizard-providers" /></label>
        <label className={css.field}>{t('settings.model')}<input value={model} onChange={(event) => { setModel(event.target.value) }} /></label>
      </div>
      <datalist id="saturnbot-wizard-providers">{PROVIDER_PRESETS.map(preset => <option key={preset} value={preset} />)}</datalist>
    </section>}
    {step === 'connections' && <section className={css.pageStack}>
      <div><PanelHeading title={t('wizard.step.connections')} /><p className={css.muted}>{t('wizard.step.connections.detail')}</p></div>
      {!integrationsResult.ok && <p className={css.error} role="alert">{t('connect.fixJsonFirst')}</p>}
      <IntegrationConnectForms
        catalog={catalog}
        values={parsedIntegrations}
        onChange={(next) => { setIntegrations(JSON.stringify(next, null, 2)) }}
        envPath={snapshot.firstRun?.envPath}
        disabled={!integrationsResult.ok}
        t={t}
      />
    </section>}
    {step === 'schedule' && <section className={css.panel}><PanelHeading title={t('wizard.step.schedule')} /><p className={css.muted}>{t('wizard.step.schedule.detail')}</p>
      <label className={css.check}><input type="checkbox" checked={scheduleEnabled} onChange={(event) => { setScheduleEnabled(event.target.checked) }} />{t('settings.enabled')}</label>
      <label className={css.field}>{t('settings.interval')}<input type="number" min="1" value={intervalMinutes} onChange={(event) => { setIntervalMinutes(event.target.valueAsNumber) }} /></label>
    </section>}
    <div className={css.formFooter} data-wizard-footer="">
      <button type="button" className={css.linkButton} onClick={onExit}>{t('wizard.skip')}</button>
      <div className={css.actions}>
        {index > 0 && <button type="button" className={css.button} disabled={busy} onClick={retreat}>{t('wizard.back')}</button>}
        <button type="submit" className={css.primary} disabled={busy || !ready[step]}>{t(step === 'schedule' ? 'wizard.finish' : 'wizard.next')}</button>
      </div>
    </div>
  </form>
}
