/**
 * Settings → Account. Who this machine is, then what it is running.
 * A missing desktop bridge, a missing OAuth client, and a failed check are
 * all empty states — never a fabricated user, never a silent install.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AccountDisconnectReason,
  AccountFace,
  AccountStatus,
  UpdateCheck,
} from './contracts.ts'
import type { AccountKey } from './locales.ts'
import css from './AccountSection.module.css'

/** The Host operations this page calls. */
export type AccountSectionInjected = AccountFace

/** Everything the page receives: the wire face, the dictionary, and close. */
export interface AccountSectionProps extends AccountSectionInjected {
  /** Translate one key of this page's dictionary. */
  t: (key: AccountKey, values?: Record<string, string | number>) => string
  /** Close the Settings panel (unused here; the shell always supplies it). */
  close: () => void
}

type AccountView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly account: AccountStatus }

function Ring(): ReactNode {
  return (
    <svg className={css.ring} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <ellipse cx="20" cy="20" rx="18" ry="7.5" transform="rotate(-18 20 20)" pathLength={100} />
    </svg>
  )
}

function disconnectKey(reason: AccountDisconnectReason): AccountKey {
  if (reason === 'oauth-unavailable') return 'oauthUnavailable'
  if (reason === 'oauth-incomplete') return 'oauthIncomplete'
  if (reason === 'malformed') return 'malformed'
  return 'disconnected'
}

function disconnectReason(
  reason: AccountDisconnectReason,
  t: AccountSectionProps['t'],
): ReactNode {
  const key = disconnectKey(reason)
  if (key === 'disconnected') return null
  return <p className={css.reason}>{t(key)}</p>
}

function updateCopy(check: UpdateCheck, t: AccountSectionProps['t']): string {
  switch (check.status) {
    case 'current':
      return check.feed
        ? t('upToDate', { version: check.current })
        : t('upToDateNoFeed')
    case 'available':
      return t('available', { version: check.latest })
    case 'available-no-feed':
      return t('availableNoFeed', { version: check.latest })
    case 'empty':
      return t('emptyFeed')
    case 'error':
      return t('updateError')
  }
}

function releaseUrl(check: UpdateCheck): string | undefined {
  if (check.status === 'available' || check.status === 'available-no-feed') return check.releaseUrl
  return undefined
}

/**
 * Render the Account settings page.
 * @param props - the Host face, the dictionary, and the shell's close.
 * @returns the page.
 */
export function AccountSection(props: AccountSectionProps): ReactNode {
  const { t, status, signIn, signOut, checkUpdates, openRelease } = props
  const [view, setView] = useState<AccountView>({ kind: 'loading' })
  const [update, setUpdate] = useState<UpdateCheck | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const settle = useCallback((next: AccountStatus) => {
    if (!live.current) return
    setView({ kind: 'ready', account: next })
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        settle(await status())
      } catch {
        if (live.current) setView({ kind: 'error' })
      }
    })()
  }, [status, settle])

  if (view.kind === 'loading') return <section className={css.page} aria-busy="true" />
  if (view.kind === 'error') {
    return (
      <section className={css.page}>
        <p className={css.error} role="status">{t('loadError')}</p>
      </section>
    )
  }

  const account = view.account
  const connected = account.connected
  const href = update === undefined ? undefined : releaseUrl(update)

  return (
    <section className={css.page} aria-busy={busy}>
      <header className={css.head}>
        <span className={css.mark} data-on={connected ? '' : undefined}><Ring /></span>
        <div className={css.headText}>
          <h3 className={css.title}>{t('title')}</h3>
          <p className={css.lede}>{t('lede')}</p>
        </div>
      </header>

      {connected
        ? (
          <>
            <p className={css.state} data-on="" role="status">
              {t('connectedAs', { name: account.name ?? account.email ?? account.sub })}
            </p>
            {account.email === undefined ? null : <p className={css.identity}>{t('connectedEmail', { email: account.email })}</p>}
            <p className={css.mono}>{t('connectedSub', { sub: account.sub })}</p>
          </>
        )
        : (
          <>
            <p className={css.state} role="status">{t('disconnected')}</p>
            {disconnectReason(account.reason, t)}
          </>
        )}

      <div className={css.actions}>
        {connected
          ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signOut().then(settle, () => { if (live.current) setView({ kind: 'error' }) })
                  .finally(() => { if (live.current) setBusy(false) })
              }}
            >
              {t('signOut')}
            </Button>
          )
          : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signIn().then(settle, () => { if (live.current) setView({ kind: 'error' }) })
                  .finally(() => { if (live.current) setBusy(false) })
              }}
            >
              {t('signIn')}
            </Button>
          )}
      </div>

      <section className={css.install}>
        <h4 className={css.subtitle}>{t('installTitle')}</h4>
        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={busy || checking}
            onClick={() => {
              setChecking(true)
              void checkUpdates().then(
                (next) => { if (live.current) setUpdate(next) },
                () => { if (live.current) setView({ kind: 'error' }) },
              ).finally(() => { if (live.current) setChecking(false) })
            }}
          >
            {t(checking ? 'checking' : 'checkUpdates')}
          </Button>
        </div>
        {update === undefined
          ? null
          : (
            <>
              {update.current === '' ? null : (
                <p className={css.mono}>{t('installVersion', { version: update.current })}</p>
              )}
              <p className={css.reason} role="status">{updateCopy(update, t)}</p>
            </>
          )}
        {href === undefined ? null : (
          <div className={css.actions}>
            <Button variant="outline" onClick={() => { openRelease(href) }}>
              {t('openRelease')}
            </Button>
          </div>
        )}
      </section>
    </section>
  )
}
