/** Explicit workspace, schedule, action policy, and specialist configuration forms. */
import { useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BotConfig, BotRole, BotSnapshot } from '@saturnai/dsh-saturnbot/client'
import { Avatar } from './Avatar.tsx'
import { PanelHeading, Status, type BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'

/** Parse editable JSON at the user-input boundary without accepting non-string command arguments. */
export function parseAdvanced(commandsText: string, integrationsText: string): Pick<BotConfig, 'validationCommands' | 'integrations'> {
  const commands: unknown = JSON.parse(commandsText)
  const integrations: unknown = JSON.parse(integrationsText)
  if (!Array.isArray(commands) || !commands.every(command => Array.isArray(command) && command.length > 0 && command.every(arg => typeof arg === 'string'))) throw new Error('commands')
  if (integrations === null || typeof integrations !== 'object' || Array.isArray(integrations)) throw new Error('integrations')
  const rows: BotConfig['integrations'] = {}
  for (const [key, value] of Object.entries(integrations as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('integration')
    const entry: BotConfig['integrations'][string] = {}
    for (const [field, part] of Object.entries(value)) {
      if (!['endpoint', 'credentialEnv', 'resource'].includes(field) || typeof part !== 'string') throw new Error('integration field')
      if (field === 'endpoint') entry.endpoint = part
      if (field === 'credentialEnv') entry.credentialEnv = part
      if (field === 'resource') entry.resource = part
    }
    rows[key] = entry
  }
  return { validationCommands: commands as string[][], integrations: rows }
}

/** User-edited draft state stays local until one configure command succeeds. */
export function Configuration({ snapshot, workspaces, save, busy, t }: {
  snapshot: BotSnapshot
  workspaces: readonly WorkspaceView[]
  save: (patch: Partial<BotConfig>) => Promise<void>
  busy: boolean
  t: BotTranslate
}) {
  const [draft, setDraft] = useState(snapshot.config)
  const [commands, setCommands] = useState(() => JSON.stringify(snapshot.config.validationCommands, null, 2))
  const [integrations, setIntegrations] = useState(() => JSON.stringify(snapshot.config.integrations, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const update = <K extends keyof BotConfig>(key: K, value: BotConfig[K]): void => {
    setDraft(current => ({ ...current, [key]: value })); setSaved(false)
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!draft.goal.trim() || !draft.workspace.trim()) { setError(t('settings.required')); return }
    let advanced: ReturnType<typeof parseAdvanced>
    try { advanced = parseAdvanced(commands, integrations) } catch { setError(t('settings.jsonError')); return }
    setError(null)
    void save({ ...draft, ...advanced }).then(() => { setSaved(true) }).catch(() => {
      /* The owning dashboard renders the command failure. */
    })
  }
  return <form className={css.configForm} onSubmit={submit}>
    <p className={css.muted}>{t('settings.description')}</p>
    <section className={css.panel}><PanelHeading title={t('overview.goal')} />
      <label className={css.field}>{t('settings.workspace')}<select value={workspaces.some(workspace => workspace.path === draft.workspace) ? draft.workspace : ''} onChange={(event) => { update('workspace', event.target.value) }}><option value="">{t('settings.chooseWorkspace')}</option>{workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.path}>{workspace.title}</option>)}</select></label>
      <label className={css.field}>{t('settings.workspacePath')}<input value={draft.workspace} onChange={(event) => { update('workspace', event.target.value) }} required /></label>
      <label className={css.field}>{t('settings.goal')}<textarea rows={4} value={draft.goal} placeholder={t('settings.goalPlaceholder')} onChange={(event) => { update('goal', event.target.value) }} required /><small>{t('settings.goalHint')}</small></label>
    </section>
    <section className={css.panel}><PanelHeading title={t('settings.schedule')} /><label className={css.check}><input type="checkbox" checked={draft.enabled} onChange={(event) => { update('enabled', event.target.checked) }} />{t('settings.enabled')}</label>
      <div className={css.formGrid}><label className={css.field}>{t('settings.interval')}<input type="number" min="1" value={draft.intervalMinutes} onChange={(event) => { update('intervalMinutes', event.target.valueAsNumber) }} required /></label><label className={css.field}>{t('settings.reportChannel')}<input value={draft.reportChannel} onChange={(event) => { update('reportChannel', event.target.value) }} /></label></div>
    </section>
    <section className={css.panel}><PanelHeading title={t('connections.model')} /><div className={css.formGrid}><label className={css.field}>{t('settings.provider')}<input value={draft.provider} onChange={(event) => { update('provider', event.target.value) }} required /></label><label className={css.field}>{t('settings.model')}<input value={draft.model} onChange={(event) => { update('model', event.target.value) }} required /></label></div></section>
    <section className={css.panel}><PanelHeading title={t('settings.policy')} />
      {([['requireWriteApproval', 'settings.writeApproval'], ['requirePrApproval', 'settings.prApproval'], ['requireDeployApproval', 'settings.deployApproval'], ['autoDispatchEmail', 'settings.emailDispatch']] as const).map(([key, label]) => <label key={key} className={css.check}><input type="checkbox" checked={draft[key]} onChange={(event) => { update(key, event.target.checked) }} />{t(label)}</label>)}
    </section>
    <details className={css.panel}><summary className={css.configSummary}>{t('settings.advanced')}</summary><div className={css.formGrid}>
      {([['maxTasks', 'settings.maxTasks'], ['maxActionsPerTask', 'settings.maxActions'], ['toolTimeoutMs', 'settings.toolTimeout'], ['modelTimeoutMs', 'settings.modelTimeout'], ['maxInputBytes', 'settings.maxInput'], ['maxOutputTokens', 'settings.maxOutput']] as const).map(([key, label]) => <label key={key} className={css.field}>{t(label)}<input type="number" min="1" value={key.endsWith('Ms') ? draft[key] / 1000 : draft[key]} onChange={(event) => { update(key, event.target.valueAsNumber * (key.endsWith('Ms') ? 1000 : 1)) }} required /></label>)}
    </div>
    <label className={css.field}>{t('settings.tools')}<textarea className={css.codeInput} rows={5} value={draft.allowedTools.join('\n')} onChange={(event) => { update('allowedTools', [...new Set(event.target.value.split('\n').map(name => name.trim()).filter(Boolean))]) }} /><small>{t('settings.toolsHint')}</small></label>
    <label className={css.field}>{t('settings.validation')}<textarea className={css.codeInput} rows={4} value={commands} onChange={(event) => { setCommands(event.target.value); setSaved(false) }} /><small>{t('settings.validationHint')}</small></label>
    <label className={css.field}>{t('settings.integrations')}<textarea className={css.codeInput} rows={6} value={integrations} onChange={(event) => { setIntegrations(event.target.value); setSaved(false) }} /><small>{t('settings.integrationsHint')}</small></label>
    </details>
    {error && <p className={css.error} role="alert">{error}</p>}{saved && <p role="status" className={css.success}>{t('state.saved')}</p>}
    <div className={css.formFooter}><button type="submit" disabled={busy} className={css.primary}>{busy ? t('action.saving') : t('action.save')}</button></div>
  </form>
}

/** Edit one specialist's admitted instructions and exact tool allowlist. */
export function RoleConfiguration({ role, snapshot, save, busy, t }: {
  role: BotRole
  snapshot: BotSnapshot
  save: (patch: Partial<BotConfig>) => Promise<void>
  busy: boolean
  t: BotTranslate
}) {
  const [draft, setDraft] = useState(snapshot.config.roles[role])
  const [saved, setSaved] = useState(false)
  const tools = snapshot.tools.filter(tool => tool.roles.includes(role))
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void save({ roles: { ...snapshot.config.roles, [role]: draft } }).then(() => { setSaved(true) }).catch(() => {
      /* Owning dashboard displays failure. */
    })
  }
  return <form className={css.configForm} onSubmit={submit}>
    <header className={css.roleConfigHeader}><Avatar role={role} large /><div><h2>{t(`role.${role}`)}</h2><p>{t(`role.${role}.detail`)}</p></div></header>
    <label className={css.check}><input type="checkbox" checked={draft.enabled} onChange={(event) => { setDraft(current => ({ ...current, enabled: event.target.checked })); setSaved(false) }} />{t('settings.roleEnabled')}</label>
    <label className={css.field}>{t('settings.roleInstructions')}<textarea rows={6} value={draft.instructions} onChange={(event) => { setDraft(current => ({ ...current, instructions: event.target.value })); setSaved(false) }} /></label>
    <section className={css.panel}><PanelHeading title={t('agents.bindings')} /><p className={css.muted}>{t('settings.roleToolsHint')}</p><div className={css.toolChoices}>{tools.map(tool => <label key={tool.name} className={css.toolChoice}><input type="checkbox" checked={draft.tools.includes(tool.name)} disabled={!tool.enabled || !snapshot.config.allowedTools.includes(tool.name)} onChange={(event) => { setDraft(current => ({ ...current, tools: event.target.checked ? [...current.tools, tool.name] : current.tools.filter(name => name !== tool.name) })); setSaved(false) }} /><span><code>{tool.name}</code><small>{tool.description}</small></span></label>)}</div>{tools.length === 0 && <p className={css.emptyInline}>{t('agents.noTools')}</p>}</section>
    {saved && <p role="status" className={css.success}>{t('state.saved')}</p>}<button disabled={busy} className={css.primary}>{t('settings.roleSave')}</button>
  </form>
}

/** Connection configuration is shown without inventing health-check results. */
export function Connections({ snapshot, t }: { snapshot: BotSnapshot; t: BotTranslate }) {
  return <div className={css.pageStack}><p className={css.muted}>{t('connections.description')}</p>
    <section className={css.panel}><PanelHeading title={t('connections.model')} /><div className={css.branchTop}><code>{snapshot.config.provider || t('status.unconfigured')} / {snapshot.config.model || t('status.unconfigured')}</code><Status value={snapshot.config.provider && snapshot.config.model ? 'configured' : 'unconfigured'} t={t} /></div></section>
    <section className={css.panel}><PanelHeading title={t('connections.host')} /><code className={css.wrapCode}>{snapshot.config.workspace || t('nav.noWorkspace')}</code><p className={css.muted}>{t('connections.hostBody')}</p></section>
    {snapshot.connections.map(connection => <section key={connection.id} className={css.panel}><div className={css.branchTop}><h2>{connection.id}</h2><Status value={connection.status} t={t} /></div><p className={css.muted}>{connection.detail}</p>{snapshot.config.integrations[connection.id] && <dl className={css.facts}>{Object.entries(snapshot.config.integrations[connection.id] ?? {}).map(([key, value]) => <div key={key}><dt>{key === 'endpoint' ? t('connections.endpoint') : key === 'credentialEnv' ? t('connections.credential') : t('connections.resource')}</dt><dd><code>{value}</code></dd></div>)}</dl>}</section>)}
    {snapshot.connections.length === 0 && <section className={css.panel}><PanelHeading title={t('connections.empty')} /><p className={css.muted}>{t('connections.emptyBody')}</p></section>}
  </div>
}
