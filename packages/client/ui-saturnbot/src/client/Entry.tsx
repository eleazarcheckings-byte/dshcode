/** Shell launcher and separate-window SaturnBot surface. */
import { useEffect, useRef, useState } from 'react'
import { SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SaturnBotEntryProps } from './contracts.ts'
import { Dashboard } from './Dashboard.tsx'
import css from './Entry.module.css'

/** Mount one dashboard in its own window, or a top-right launcher in the main harness. */
export function SaturnBotEntry({
  useBot, useWorkspaces, standalone, openWindow, t,
  refresh, configure, runNow, pause, cancel, approve, message, loadMoreEvents, loadRecords,
}: SaturnBotEntryProps) {
  const state = useBot(value => value)
  const workspaces = useWorkspaces(value => value.items)
  const [launchFailure, setLaunchFailure] = useState<'blocked' | 'unavailable' | null>(null)
  const [opening, setOpening] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!standalone) return
    const previous = document.title
    document.title = t('brand')
    return () => { document.title = previous }
  }, [standalone, t])
  useEffect(() => {
    if (root.current === null) return
    const overlay = root.current.closest('[data-shell-overlay]')
    const frame = overlay?.parentElement
    if (!standalone && frame !== null && frame !== undefined) {
      const previous = frame.style.getPropertyValue('--dsh-shell-trailing-inset')
      frame.style.setProperty('--dsh-shell-trailing-inset', '134px')
      return () => {
        if (previous) frame.style.setProperty('--dsh-shell-trailing-inset', previous)
        else frame.style.removeProperty('--dsh-shell-trailing-inset')
      }
    }
    const siblings = [...(overlay?.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay,
    )
    const previous = siblings.map(element => element.inert)
    siblings.forEach((element) => { element.inert = true })
    root.current.focus({ preventScroll: true })
    return () => { siblings.forEach((element, index) => { element.inert = previous[index] ?? false }) }
  }, [standalone])
  const actions = { refresh, configure, runNow, pause, cancel, approve, message, loadMoreEvents, loadRecords }
  const launch = async (): Promise<void> => {
    setOpening(true)
    setLaunchFailure(null)
    try {
      if (!await openWindow()) setLaunchFailure('blocked')
    } catch {
      // A desktop transport failure is distinct from a browser blocking window.open.
      setLaunchFailure('unavailable')
    } finally { setOpening(false) }
  }
  if (standalone) return <div ref={root} className={css.window} tabIndex={-1}>
    <Dashboard state={state} workspaces={workspaces} actions={actions} t={t} />
  </div>
  return <div ref={root} className={css.launcherSeat}><button type="button" className={css.launcher} aria-label={t('launch.label')} disabled={opening} aria-busy={opening} onClick={() => { void launch() }}><SaturnLogo size={18} /><span>{t('brand')}</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><path d="M6 3H3v10h10v-3M8 3h5v5M7 9l6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{launchFailure !== null && <p className={css.blocked} role="alert">{t(launchFailure === 'blocked' ? 'launch.blocked' : 'launch.unavailable')}</p>}</div>
}
