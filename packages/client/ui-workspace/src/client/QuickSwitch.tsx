/** Keyboard-first navigation over the same sessions and workspaces as the sidebar. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import clsx from 'clsx'
import { IconSearchOutline16, Modal, SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import { quickDestinations } from './quick-switch.ts'
import css from './QuickSwitch.module.css'

type QuickSwitchProps = Pick<WorkspaceBrowserProps,
  'wide' | 'useSessions' | 'useWorkspaces' | 'useSessionPendingInteraction' | 'startSession' | 'open' | 't'>

type PanelProps = Omit<QuickSwitchProps, 'wide'> & { onClose: () => void }

/** A mounted palette owns focus until dismissed, then restores the invoking control. */
function QuickSwitchPanel({ useSessions, useWorkspaces, useSessionPendingInteraction, startSession, open, t, onClose }: PanelProps) {
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const pending = useSessionPendingInteraction(state => state)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  // Keep keyboard navigation and the mounted list bounded even in a long-lived harness home.
  const destinations = useMemo(() => quickDestinations(sessions, workspaces, query).slice(0, 30), [sessions, workspaces, query])
  const newTitle = t('jump.new')
  const includeNew = query.trim() === '' || newTitle.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const count = destinations.length + (includeNew ? 1 : 0)
  const active = Math.min(selection, Math.max(0, count - 1))

  useEffect(() => {
    const previous = document.activeElement
    input.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (index: number): void => {
    if (includeNew && index === 0) { onClose(); startSession(); return }
    const row = destinations[index - (includeNew ? 1 : 0)]
    if (row === undefined) return
    onClose()
    if (row.kind === 'session') open(row.id)
    else startSession(row.id)
  }
  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count > 0) setSelection((active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Tab') {
      // This listbox has one tab stop; arrows select and Enter opens a destination.
      event.preventDefault()
      input.current?.focus()
    }
  }

  return (
    <Modal open headless title={t('jump.title')} onClose={onClose} className={clsx(css.dialog)}>
      <div onKeyDown={onKeyDown}>
        <div className={css.search}>
          <IconSearchOutline16 size={20} />
          <input
            ref={input} role="combobox" aria-expanded="true" aria-autocomplete="list"
            aria-controls={listId} aria-activedescendant={count > 0 ? `${listId}-${active}` : undefined}
            aria-label={t('jump.title')} placeholder={t('jump.placeholder')}
            value={query} maxLength={500}
            onChange={(event) => { setQuery(event.target.value); setSelection(0) }}
          />
          <span className={css.escape} aria-hidden="true">{t('jump.escape')}</span>
        </div>
        <div className={css.section}>{query.trim() === '' ? t('jump.recent') : t('jump.results')}</div>
        <div ref={list} id={listId} role="listbox" aria-label={t('jump.results')} className={css.results}>
          {includeNew && (
            <div
              id={`${listId}-0`} role="option" aria-selected={active === 0} data-index={0}
              className={css.option} onMouseMove={() => { setSelection(0) }} onClick={() => { choose(0) }}
            >
              <span className={css.icon}><SaturnLogo size={21} /></span>
              <span className={css.copy}><strong>{newTitle}</strong><small>{t('jump.newDetail')}</small></span>
              <span className={css.kind}>{t('jump.action')}</span>
            </div>
          )}
          {destinations.map((row, offset) => {
            const index = offset + (includeNew ? 1 : 0)
            const awaiting = row.kind === 'session' && pending.has(row.id)
            const status = row.kind === 'workspace' ? t('jump.workspace') : awaiting ? t('jump.waiting')
              : row.running ? t('status.running') : row.completed ? t('status.completed') : t('jump.session')
            return (
              <div
                key={`${row.kind}:${row.id}`} id={`${listId}-${index}`} role="option"
                aria-selected={active === index} data-index={index} className={css.option}
                onMouseMove={() => { setSelection(index) }} onClick={() => { choose(index) }}
              >
                <span className={css.icon} data-kind={row.kind} aria-hidden="true">
                  {row.kind === 'workspace' ? <svg viewBox="0 0 24 24"><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H10l2 3h7.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" /></svg>
                    : <svg viewBox="0 0 24 24"><path d="M5 18.5 3 21v-6A9 9 0 1 1 5 18.5Z" /></svg>}
                </span>
                <span className={css.copy}><strong>{row.title}</strong><small>{row.detail}</small></span>
                <span className={css.kind} data-attention={awaiting || undefined} data-running={row.kind === 'session' && row.running || undefined}>{status}</span>
              </div>
            )
          })}
          {count === 0 && <div className={css.empty} role="status"><strong>{t('jump.empty')}</strong><span>{t('jump.emptyDetail')}</span></div>}
        </div>
        <div className={css.footer}><span>{t('jump.navigate')}</span><span>{t('jump.open')}</span><span>{t('jump.local')}</span></div>
      </div>
    </Modal>
  )
}

/**
 * Register Ctrl/Cmd+K while the workspace browser is mounted; the same control works in the rail.
 * @param props - Sidebar width, framework snapshot hooks, host navigation, and localized copy.
 * @returns The launcher and, while open, a body-portaled navigation palette.
 */
export function QuickSwitch({ wide, ...props }: QuickSwitchProps) {
  const [isOpen, setOpen] = useState(false)
  const close = useCallback(() => { setOpen(false) }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat || event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'k') return
      // Other modal workflows retain their keyboard scope.
      if (!isOpen && document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return
      event.preventDefault()
      setOpen(value => !value)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [isOpen])
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return <>
    <button type="button" className={css.launcher} data-wide={wide} onClick={() => { setOpen(true) }} aria-label={props.t('jump.title')} aria-keyshortcuts="Control+K Meta+K" title={props.t('jump.title')}>
      <IconSearchOutline16 size={16} />
      {wide && <><span>{props.t('jump.launcher')}</span><kbd>{props.t(mac ? 'jump.shortcutMac' : 'jump.shortcut')}</kbd></>}
    </button>
    {isOpen && <QuickSwitchPanel {...props} onClose={close} />}
  </>
}
