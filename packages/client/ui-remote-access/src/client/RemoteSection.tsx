/**
 * Settings → Remote. One page that answers three questions in order: is this
 * open, what address and certificate does a device dial, and which devices
 * already hold a key. The pairing code is never on screen until it is asked
 * for, and the device token behind it is never rendered as text — the symbol
 * carries it and nothing else does.
 *
 * The page owns only viewing state. Every fact comes from the Host on mount
 * and after each mutation, so a failed call clears the view instead of leaving
 * a stale green light on a listener that is no longer open.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { QrCode } from './QrCode.tsx'
import type {
  RemoteAccessFace,
  RemoteMode,
  RemotePairingPayload,
  RemoteStatusView,
} from './contracts.ts'
import type { RemoteKey } from './locales.ts'
import css from './RemoteSection.module.css'

/** The Host operations this page calls. */
export type RemoteSectionInjected = RemoteAccessFace

/** Everything the page receives: the wire face, the dictionary, and the panel's close. */
export interface RemoteSectionProps extends RemoteSectionInjected {
  /** Translate one key of this page's dictionary. */
  t: (key: RemoteKey, values?: Record<string, string | number>) => string
  /** Close the Settings panel (unused here; the shell always supplies it). */
  close: () => void
}

type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly status: RemoteStatusView }

/** The signature mark: a hairline ellipse at the product's tilt, in `currentColor`. */
function Ring(): ReactNode {
  return (
    <svg className={css.ring} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <ellipse cx="20" cy="20" rx="18" ry="7.5" transform="rotate(-18 20 20)" pathLength={100} />
    </svg>
  )
}

function stateKey(status: RemoteStatusView): RemoteKey {
  if (status.state === 'on') return 'stateOn'
  if (status.state === 'starting') return 'stateStarting'
  return status.state === 'failed' ? 'stateFailed' : 'stateOff'
}

function issueKey(status: RemoteStatusView): RemoteKey | undefined {
  switch (status.issue) {
    case 'no-lan-address': return 'issueNoLan'
    case 'tunnel-missing': return 'tunnelMissing'
    case 'tunnel-failed': return 'issueTunnelFailed'
    case 'listen-failed': return 'issueListenFailed'
    default: return undefined
  }
}

/** Group a hex digest so a person can actually compare it against a phone. */
function groupDigest(digest: string): string {
  return (digest.match(/.{1,8}/gu) ?? []).join(' ')
}

function when(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString()
}

/**
 * Render the Remote settings page.
 * @param props - the Host face, the dictionary, and the shell's close.
 * @returns the page.
 */
export function RemoteSection(props: RemoteSectionProps): ReactNode {
  const { t, status, enable, disable, pairingCode, revoke } = props
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [mode, setMode] = useState<RemoteMode>('lan')
  const [pairing, setPairing] = useState<RemotePairingPayload | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const settle = useCallback((next: RemoteStatusView) => {
    if (!live.current) return
    setView({ kind: 'ready', status: next })
    setMode(next.mode)
  }, [])

  const run = useCallback(async (work: () => Promise<RemoteStatusView>) => {
    setBusy(true)
    try {
      settle(await work())
    } catch {
      if (live.current) setView({ kind: 'error' })
    } finally {
      if (live.current) setBusy(false)
    }
  }, [settle])

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

  const current = view.status
  const on = current.state === 'on'
  const issue = issueKey(current)

  return (
    <section className={css.page} aria-busy={busy}>
      <header className={css.head}>
        <span className={css.mark} data-on={on ? '' : undefined}><Ring /></span>
        <div className={css.headText}>
          <h3 className={css.title}>{t('title')}</h3>
          <p className={css.lede}>{t('lede')}</p>
        </div>
      </header>

      <p className={css.state} data-state={current.state} role="status">{t(stateKey(current))}</p>
      {issue === undefined ? null : <p className={css.issue}>{t(issue)}</p>}

      <div className={css.modes} role="group" aria-label={t('modeLabel')}>
        {(['lan', 'tunnel'] as const).map(candidate => (
          <label className={css.mode} key={candidate} data-selected={mode === candidate ? '' : undefined}>
            <input
              type="radio"
              name="saturn-remote-mode"
              value={candidate}
              checked={mode === candidate}
              disabled={busy}
              onChange={() => { setMode(candidate) }}
            />
            <span className={css.modeName}>{t(candidate === 'lan' ? 'modeLan' : 'modeTunnel')}</span>
            <span className={css.modeHint}>{t(candidate === 'lan' ? 'modeLanHint' : 'modeTunnelHint')}</span>
          </label>
        ))}
      </div>

      <div className={css.actions}>
        {on
          ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => { setPairing(undefined); void run(() => disable()) }}
            >
              {t('turnOff')}
            </Button>
          )
          : (
            <Button variant="outline" disabled={busy} onClick={() => { void run(() => enable(mode)) }}>
              {t('turnOn')}
            </Button>
          )}
        {on
          ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (pairing !== undefined) {
                  setPairing(undefined)
                  return
                }
                setBusy(true)
                void pairingCode().then(
                  (next) => { if (live.current) setPairing(next) },
                  () => { if (live.current) setView({ kind: 'error' }) },
                ).finally(() => { if (live.current) setBusy(false) })
              }}
            >
              {t(pairing === undefined ? 'showCode' : 'hideCode')}
            </Button>
          )
          : null}
      </div>

      {current.url === null ? null : (
        <dl className={css.facts}>
          <dt className={css.factName}>{t('addressLabel')}</dt>
          <dd className={css.factValue}><code className={css.mono}>{current.url}</code></dd>
          {current.fingerprint === null ? null : (
            <>
              <dt className={css.factName}>{t('fingerprintLabel')}</dt>
              <dd className={css.factValue}>
                <code className={css.mono}>{groupDigest(current.fingerprint)}</code>
                <span className={css.factHint}>{t('fingerprintHint')}</span>
              </dd>
            </>
          )}
        </dl>
      )}

      {pairing === undefined ? null : (
        <figure className={css.pairing}>
          <QrCode value={JSON.stringify(pairing)} label={t('pairingTitle')} />
          <figcaption className={css.pairingCaption}>
            <span className={css.pairingTitle}>{t('pairingTitle')}</span>
            <span className={css.pairingHint}>{t('pairingHint')}</span>
            <span className={css.pairingExpiry}>{t('pairingExpires', { time: when(pairing.expires) })}</span>
          </figcaption>
        </figure>
      )}

      <section className={css.devices}>
        <h4 className={css.subtitle}>{t('devicesTitle')}</h4>
        {current.devices.length === 0
          ? <p className={css.empty}>{t('devicesEmpty')}</p>
          : (
            <ul className={css.deviceList}>
              {current.devices.map(device => (
                <li className={css.device} key={device.id}>
                  <span className={css.deviceName}>{device.name}</span>
                  <span className={css.deviceMeta}>
                    {device.platform} · {t('devicePaired', { time: when(device.pairedAt) })} ·{' '}
                    {device.lastSeenAt === null
                      ? t('deviceNeverSeen')
                      : t('deviceLastSeen', { time: when(device.lastSeenAt) })}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    aria-label={t('revokeDevice', { name: device.name })}
                    onClick={() => { void run(() => revoke(device.id)) }}
                  >
                    {t('revokeDevice', { name: device.name })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </section>

      {current.journal.length === 0 ? null : (
        <section className={css.journal}>
          <h4 className={css.subtitle}>{t('journalTitle')}</h4>
          <ul className={css.journalList}>
            {current.journal.slice(-6).reverse().map(entry => (
              <li className={css.journalRow} key={`${entry.at}-${entry.action}`}>
                <code className={css.mono}>{entry.action}</code>
                <span className={css.journalDetail}>{entry.detail ?? ''}</span>
                <time className={css.journalTime} dateTime={entry.at}>{when(entry.at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
