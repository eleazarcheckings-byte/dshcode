/**
 * Settings → Models, Hugging Face row: token onboarding, then a searchable
 * group of every model the router currently serves live, a routing-policy
 * choice, and a typed model id. Choosing a model pins it — with its routing
 * suffix — into the route's `models`, which lead every picker; the live list
 * itself reaches the composer picker without pinning.
 *
 * The token is stored through the credentials operation only; it is never
 * logged, never placed in a URL, and the field is cleared once stored.
 */

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  HF_BILLING_URL, HF_ROUTE, HF_ROUTER_URL, HF_TOKEN_REF, HF_TOKEN_URL,
  huggingFaceErrorKey, isRoutableModelId, ROUTING_POLICIES, withRoutingSuffix,
} from './huggingface.ts'
import type { RoutingPolicy } from './huggingface.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link HuggingFaceCard}. */
export interface HuggingFaceCardProps {
  /** Host operations. */
  operations: ModelsOperations
  /** The `llm-pi-ai` namespace view, for the pinned models and the write fence. */
  namespace: SettingsNamespaceView | undefined
  /** Whether a token is stored under `HF_TOKEN`. */
  keyConfigured: boolean
  /** The page cannot write. */
  readOnly: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** A token or pin was saved; the page reloads. */
  onChanged: () => void
}

/** Compact token count: 131072 → `131K`. */
function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`
  return `${String(Math.round(tokens / 1000))}K`
}

/** The pinned `{ id }` entries the namespace's effective value carries for the route. */
function pinnedModels(namespace: SettingsNamespaceView | undefined): unknown[] {
  const value = namespace?.value as { providers?: Record<string, { models?: unknown }> } | undefined
  const models = value?.providers?.[HF_ROUTE]?.models
  return Array.isArray(models) ? models : []
}

/**
 * Render the Hugging Face card.
 * @param props - operations, namespace, key state, and copy.
 * @returns the card body.
 */
export function HuggingFaceCard({ operations, namespace, keyConfigured, readOnly, t, onChanged }: HuggingFaceCardProps): ReactNode {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [models, setModels] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [policy, setPolicy] = useState<RoutingPolicy>('fastest')
  const [typed, setTyped] = useState('')
  const [typedInvalid, setTypedInvalid] = useState(false)
  const [withTools, setWithTools] = useState<ReadonlySet<string>>(() => new Set())
  const id = useId()

  useEffect(() => {
    if (!keyConfigured) return
    let live = true
    void operations.discoverModels('llm-pi-ai', {
      provider: HF_ROUTE,
      api: 'openai-completions',
      baseURL: HF_ROUTER_URL,
    }).then((outcome) => {
      if (!live) return
      if (outcome.kind === 'found') {
        setModels(outcome.models)
        return
      }
      setFailure(outcome.message)
    })
    return () => { live = false }
  }, [keyConfigured, operations])

  // Tool support is a badge, not a gate: when the catalog cannot say, the
  // list renders without badges and no error is shown.
  useEffect(() => {
    if (!keyConfigured || operations.liveModelTools === undefined) return
    let live = true
    operations.liveModelTools(HF_ROUTE).then((tools) => {
      if (live) setWithTools(tools)
    }, () => { /* no tool facts; the list still renders */ })
    return () => { live = false }
  }, [keyConfigured, operations])

  const failureKey = huggingFaceErrorKey(failure)
  const failureView = failure === undefined
    ? null
    : (
      <p className={styles['error']} role="alert">
        <span>{failureKey === undefined ? failure : t(failureKey)}</span>
        {failureKey === 'hf.error.credits'
          ? <> <a href={HF_BILLING_URL} target="_blank" rel="noreferrer">{t('hf.billingLink')}</a></>
          : null}
      </p>
    )

  const saveToken = async (): Promise<void> => {
    const value = token.trim()
    if (value.length === 0) return
    setBusy(true)
    setFailure(undefined)
    try {
      const refused = await operations.storeCredential(HF_TOKEN_REF, value)
      if (refused !== undefined) {
        setFailure(refused)
        return
      }
      setToken('')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const pin = async (id: string): Promise<void> => {
    const existing = pinnedModels(namespace)
    if (existing.some(entry => (entry as { id?: unknown }).id === id)) return
    setBusy(true)
    setFailure(undefined)
    try {
      const written = await operations.writeSettings('llm-pi-ai', [{
        op: 'set',
        path: ['providers', HF_ROUTE, 'models'],
        value: [...existing, { id }] as never,
      }], namespace?.revision)
      if (written.kind !== 'written') {
        setFailure(written.message)
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (!keyConfigured) {
    return (
      <div className={styles['field']}>
        <p className={styles['notice']}>{t('hf.tokenIntro')}</p>
        <a href={HF_TOKEN_URL} target="_blank" rel="noreferrer">{t('hf.tokenLink')}</a>
        <label className={styles['fieldLabel']} htmlFor={`${id}-token`}>{t('hf.tokenLabel')}</label>
        <input
          id={`${id}-token`}
          className={styles['input']}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          disabled={readOnly || busy}
          onChange={(event) => { setToken(event.target.value) }}
        />
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={readOnly || busy || token.trim().length === 0}
          onClick={() => { void saveToken() }}
        >
          {t('hf.tokenSave')}
        </button>
        {failureView}
      </div>
    )
  }

  const needle = query.trim().toLowerCase()
  const visible = (models ?? []).filter(model =>
    model.id.toLowerCase().includes(needle) || (model.name ?? '').toLowerCase().includes(needle))

  return (
    <div className={styles['field']}>
      {failureView}
      <input
        type="search"
        className={styles['input']}
        aria-label={t('hf.search')}
        placeholder={t('hf.search')}
        value={query}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      <select
        className={`${styles['input']} ${styles['selectInput']}`}
        aria-label={t('hf.policy')}
        value={policy}
        onChange={(event) => { setPolicy(event.target.value as RoutingPolicy) }}
      >
        {ROUTING_POLICIES.map(choice => (
          <option key={choice} value={choice}>{t(`hf.policy.${choice}`)}</option>
        ))}
      </select>
      <section role="group" aria-labelledby={`${id}-group`}>
        <span className={styles['fieldLabel']} id={`${id}-group`}>{t('hf.group')}</span>
        {models === undefined && failure === undefined ? <p className={styles['notice']}>{t('hf.loading')}</p> : null}
        <ul className={styles['rows']}>
          {visible.map(model => (
            <li key={model.id}>
              <span>{model.id}</span>
              {model.contextWindow === undefined
                ? null
                : <span className={styles['rowTag']}>{`${compact(model.contextWindow)} ${t('hf.context')}`}</span>}
              {withTools.has(model.id) ? <span className={styles['rowTag']}>{t('hf.tools')}</span> : null}
              <button
                type="button"
                className={styles['secondaryButton']}
                aria-label={`${t('hf.add')} ${model.id}`}
                disabled={readOnly || busy}
                onClick={() => { void pin(withRoutingSuffix(model.id, policy)) }}
              >
                {t('hf.add')}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <input
        type="text"
        className={styles['input']}
        aria-label={t('hf.idLabel')}
        placeholder={t('hf.idLabel')}
        aria-invalid={typedInvalid}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value)
          setTypedInvalid(false)
        }}
      />
      <button
        type="button"
        className={styles['secondaryButton']}
        disabled={readOnly || busy}
        onClick={() => {
          const typedValue = typed.trim()
          if (!isRoutableModelId(typedValue)) {
            setTypedInvalid(true)
            return
          }
          void pin(typedValue).then(() => { setTyped('') })
        }}
      >
        {t('hf.idUse')}
      </button>
      {typedInvalid ? <p className={styles['error']}>{t('hf.idInvalid')}</p> : null}
    </div>
  )
}
