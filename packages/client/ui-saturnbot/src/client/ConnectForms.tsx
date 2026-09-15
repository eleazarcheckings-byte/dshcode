/** Field-level connect forms generated from the runtime's integration catalog. */
import { useState } from 'react'
import type { BotConfig } from '@saturnai/dsh-saturnbot/client'
import type { SaturnBotIntegrationCatalogEntry, SaturnBotIntegrationFieldKey } from './contracts.ts'
import type { BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'

/** Parse an integrations JSON blob into the fixed record the runtime admits, tolerating a malformed draft. */
export function safeParseIntegrations(text: string): BotConfig['integrations'] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const rows: BotConfig['integrations'] = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const entry: BotConfig['integrations'][string] = {}
      for (const [field, part] of Object.entries(value as Record<string, unknown>)) {
        if (typeof part !== 'string') continue
        if (field === 'endpoint' || field === 'credentialEnv' || field === 'resource') entry[field] = part
      }
      rows[name] = entry
    }
    return rows
  } catch { return {} }
}

/**
 * Generated per-integration connect forms. Secret fields (`field.secret`) never carry
 * an editable value — the runtime already fixed the required environment variable
 * name, so the form names it and offers to copy it, never a place to type a secret.
 * Non-secret fields (an endpoint URL, a repository slug) are ordinary text inputs.
 */
export function IntegrationConnectForms({ catalog, values, onChange, envPath, t }: {
  catalog: readonly SaturnBotIntegrationCatalogEntry[]
  values: BotConfig['integrations']
  onChange: (next: BotConfig['integrations']) => void
  envPath?: string | undefined
  t: BotTranslate
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const setField = (name: string, key: SaturnBotIntegrationFieldKey, value: string): void => {
    onChange({ ...values, [name]: { ...values[name], [key]: value } })
  }
  const copy = (env: string): void => {
    void navigator.clipboard?.writeText(env).then(() => {
      setCopied(env)
      setTimeout(() => { setCopied(current => current === env ? null : current) }, 1500)
    }).catch(() => { /* Clipboard access can be denied; the env name remains visible to copy by hand. */ })
  }
  if (catalog.length === 0) return <p className={css.emptyInline}>{t('connect.empty')}</p>
  return <div className={css.pageStack}>{catalog.map((entry) => {
    const entryValues = values[entry.name] ?? {}
    return <section key={entry.name} className={css.panel} data-connect-entry={entry.name}>
      <div className={css.branchTop}><h3>{entry.label}</h3>{entry.docsUrl !== '' && <a href={entry.docsUrl} target="_blank" rel="noreferrer">{t('connect.docs')}</a>}</div>
      {entry.fields.map(field => field.secret
        ? <div key={field.key} className={css.field}>
          <span>{field.label}</span>
          <div className={css.envRow}><code>{field.env}</code><button type="button" className={css.linkButton} onClick={() => { copy(field.env) }}>{copied === field.env ? t('action.copied') : t('connect.copyEnv')}</button></div>
          <small>{t('connect.envHint', { env: field.env, path: envPath ?? t('connect.envPathFallback') })}</small>
        </div>
        : <label key={field.key} className={css.field}>{field.label}<input value={entryValues[field.key] ?? ''} onChange={(event) => { setField(entry.name, field.key, event.target.value) }} /></label>)}
    </section>
  })}</div>
}
