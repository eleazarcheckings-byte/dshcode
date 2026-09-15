/** Global decorative sky and its shared, always-available main-window motion control. */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '../contract/slots.ts'
import type { AmbientMotionInjected } from './ambient-motion.ts'
import type { OrbitalState } from './orbital-field.ts'
import { OrbitalCanvas } from './OrbitalCanvas.tsx'
import css from './AmbientSky.module.css'

/** Background receives the optional current session's standard input hook. */
export type AmbientSkyProps = PropsRuntime<'shell.background'> & InjectFace<AmbientMotionInjected>

/** Root overlay control reads the same preference without depending on session selection. */
export type AmbientMotionControlProps = PropsRuntime<'shell.overlay'> & PropsLocale<'conversation'> & InjectFace<AmbientMotionInjected>

function isSaturnBotWindow(): boolean {
  return new URLSearchParams(window.location.search).get('saturnbot') === '1'
}

function focusState(): OrbitalState {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return 'idle'
  if (active.closest('[data-composer-input]') !== null) return 'focused'
  if (active instanceof HTMLTextAreaElement && !active.readOnly) return 'drafting'
  if (active instanceof HTMLInputElement && !active.readOnly
    && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(active.type)) {
    return 'drafting'
  }
  if (active.isContentEditable) return 'drafting'
  return 'idle'
}

/**
 * Render one sky whose writing state comes from actual drafts, attachments, and focused editors.
 * @param props - Background standard session hooks and the shared motion preference.
 * @returns Decorative canvas for the main harness, or nothing in the independent SaturnBot window.
 */
export function AmbientSky({ useInput, useAmbientMotion }: AmbientSkyProps) {
  const motion = useAmbientMotion(value => value)
  const hasDraft = useInput(input => input.draft !== '' || input.imageIds.length > 0) ?? false
  const [focus, setFocus] = useState<OrbitalState>(focusState)
  const [standalone] = useState(isSaturnBotWindow)
  useEffect(() => {
    if (standalone) return
    let disposed = false
    const sync = (): void => { if (!disposed) setFocus(focusState()) }
    // focusout precedes the browser's new activeElement; defer only that observation.
    const afterBlur = (): void => { queueMicrotask(sync) }
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', afterBlur)
    window.addEventListener('focus', sync)
    sync()
    return () => {
      disposed = true
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', afterBlur)
      window.removeEventListener('focus', sync)
    }
  }, [standalone])
  if (standalone) return null
  return <OrbitalCanvas motion={motion} state={hasDraft ? 'drafting' : focus} />
}

/**
 * Render the global preference control, using the same persisted source as the background.
 * @param props - Root overlay runtime, Conversation locale, and shared preference action.
 * @returns Quiet bottom-right motion control for the main harness only.
 */
export function AmbientMotionControl({ useAmbientMotion, setAmbientMotion, t }: AmbientMotionControlProps) {
  const motion = useAmbientMotion(value => value)
  const [standalone] = useState(isSaturnBotWindow)
  if (standalone) return null
  return <button
    type="button"
    className={css.motion}
    aria-label={t('hero.motionLabel')}
    aria-pressed={motion}
    title={t('hero.motionHint')}
    onClick={() => { setAmbientMotion(!motion) }}
  >
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      {motion
        ? <path d="M5.5 4v8M10.5 4v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        : <path d="m6 4 5.5 4L6 12V4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
    </svg>
    {t('hero.motion')}
  </button>
}
