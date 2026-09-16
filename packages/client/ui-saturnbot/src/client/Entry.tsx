/** Shell launcher and separate-window SaturnBot surface. */
import { useEffect, useRef, useState } from 'react'
import { SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SaturnBotEntryProps } from './contracts.ts'
import { Dashboard } from './Dashboard.tsx'
import css from './Entry.module.css'

/** The frame custom property the Session header (and the pricing lamp's rail) read as their trailing inset. */
const TRAILING_INSET = '--dsh-shell-trailing-inset'
/** The seat's own `right` in Entry.module.css (`.launcherSeat`). */
const LAUNCHER_CORNER_INSET = 18
/** Breathing room between the launcher and whatever the frame places at the inset. */
const LAUNCHER_GAP = 12

/** Mount one dashboard in its own window, or a top-right launcher in the main harness. */
export function SaturnBotEntry({
  useBot, useWorkspaces, standalone, openWindow, pickDirectory, t,
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
      const seat = root.current
      const previous = frame.style.getPropertyValue(TRAILING_INSET)
      const release = () => {
        if (previous) frame.style.setProperty(TRAILING_INSET, previous)
        else frame.style.removeProperty(TRAILING_INSET)
      }
      // Publish the measured footprint, not a guess: the corner inset plus the
      // seat's own width (it follows the brand label's locale) plus a gap, so
      // whatever the frame places at this inset -- the Session header's
      // utilities, the pricing lamp -- stops short of the button. No box means
      // the phone sheet hid the launcher: reserve nothing.
      const reserve = () => {
        const width = Math.round(seat.getBoundingClientRect().width)
        if (width === 0) release()
        else frame.style.setProperty(TRAILING_INSET, `${LAUNCHER_CORNER_INSET + width + LAUNCHER_GAP}px`)
      }
      reserve()
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reserve)
      observer?.observe(seat)
      return () => {
        observer?.disconnect()
        release()
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
    <Dashboard state={state} workspaces={workspaces} actions={actions} pickDirectory={pickDirectory} t={t} />
  </div>
  return <div ref={root} className={css.launcherSeat} data-saturnbot-launcher=""><button type="button" className={css.launcher} aria-label={t('launch.label')} disabled={opening} aria-busy={opening} onClick={() => { void launch() }}><SaturnLogo size={18} /><span>{t('brand')}</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><path d="M6 3H3v10h10v-3M8 3h5v5M7 9l6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{launchFailure !== null && <p className={css.blocked} role="alert">{t(launchFailure === 'blocked' ? 'launch.blocked' : 'launch.unavailable')}</p>}</div>
}
