/** Optional design tool connection, managed after setup from Models settings. */
import { useEffect, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesignBrainView } from './design-brain.ts'
import type { ModelsKey } from './locales.ts'
import css from './DesignBrainCard.module.css'

/** Registrant-owned state and connection commands. */
export interface DesignBrainInjected {
  hooks: { designBrain: SnapshotStore<DesignBrainView> }
  refresh: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  t: (key: ModelsKey) => string
}

type Props = PropsRuntime<'settings.models.footer'> & InjectFace<DesignBrainInjected>

/** Render only verified Host state; a failed refresh clears stale availability. */
export function DesignBrainCard({ useDesignBrain, refresh, connect, disconnect, t }: Props): ReactNode {
  const { snapshot, busy, error } = useDesignBrain(value => value)
  useEffect(() => { void refresh() }, [refresh])
  const connected = snapshot?.state === 'connected'
  const profile = snapshot?.source === 'profile'
  const status = error ? 'designBrainUnavailable' : snapshot === null ? 'firstLightChecking'
    : connected ? 'firstLightBrainVerified'
      : snapshot.issue === 'incomplete-tools' ? 'designBrainPartial'
        : snapshot.state === 'disabled' ? 'designBrainOff'
          : snapshot.state === 'connecting' ? 'firstLightChecking' : 'designBrainUnavailable'
  return (
    <section className={css.card} aria-label={t('firstLightBrainTitle')} aria-busy={busy}>
      <h3 className={css.title}>{t('firstLightBrainTitle')}</h3>
      <p className={css.copy}>{t('firstLightBrainBody')}</p>
      <p className={css.status} role="status">{t(status)}</p>
      {snapshot?.endpoint == null ? null : <p className={css.endpoint}>{snapshot.endpoint}</p>}
      {connected ? <p className={css.copy}>{snapshot.tools.join(', ')}</p> : null}
      {profile ? <p className={css.copy}>{t('designBrainProfile')}</p> : null}
      <div className={css.actions}>
        <Button variant="outline" disabled={busy} onClick={() => { void refresh() }}>{t('designBrainRefresh')}</Button>
        {profile ? null : <Button variant="outline" disabled={busy || snapshot === null} onClick={() => { void (connected ? disconnect() : connect()) }}>{t(connected ? 'designBrainDisconnect' : 'designBrainConnect')}</Button>}
        {!profile && !connected && snapshot?.enabled === true ? <Button variant="outline" disabled={busy} onClick={() => { void disconnect() }}>{t('designBrainDisconnect')}</Button> : null}
      </div>
    </section>
  )
}
