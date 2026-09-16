import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `orchestrate` SessionProjectionMap merge for useProjection.
import type {} from '@saturnai/dsh-orchestrate/client'
import type { OrchestrateToggleInjected } from './index.ts'
import css from './OrchestrateToggle.module.css'

/** Full toggle-seat component props: runtime share (standard kit) & injected share & the locale seat. */
export type OrchestrateToggleProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<OrchestrateToggleInjected> & PropsLocale<'orchestrate'>

/**
 * Multi-task mode over the host-computed `orchestrate` projection. The button
 * renders both states — the mode is off by default, so a control that appears
 * only while active would hide the switch that turns it on — and executes
 * /orchestrate on|off through `command.execute`, so the click and the slash
 * command are one path with one logged result. `aria-pressed` reports the
 * state in force (never the queued target).
 */
export function OrchestrateToggle({ useProjection, toggle, t }: OrchestrateToggleProps) {
  const orchestrate = useProjection('orchestrate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Capability absence (the host row not composed) is the key's absence, never a value.
  if (orchestrate === undefined) return null
  const active = orchestrate.active
  // The chip always reports the state in force (`active`); a queued selection is
  // shown by the dotted label, never by painting the target as if it were already
  // the mode. `target` is only the state a click moves to.
  const target = orchestrate.pending ? !active : active

  const flip = (next: boolean): void => {
    setBusy(true)
    setError(null)
    void toggle(next).then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const className = [
    css.chip,
    active ? css.on : '',
    orchestrate.pending ? css.pending : '',
  ].filter(part => part !== '').join(' ')

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={className}
        aria-pressed={active}
        aria-label={orchestrate.pending
          ? t('toggle.pending.aria')
          : active ? t('toggle.on.aria') : t('toggle.off.aria')}
        title={orchestrate.pending
          ? t('toggle.pending.title')
          : active ? t('toggle.on.title') : t('toggle.off.title')}
        disabled={busy}
        // Keep the caret in the draft: the toggle is not a focus destination.
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { flip(target) }}
      >
        <span className={css.icon} aria-hidden>
          <IconBranchOutline16 size={14} />
        </span>
        <span className={css.label}>{t('toggle.label')}</span>
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('toggle.failed')}</span>}
    </span>
  )
}
