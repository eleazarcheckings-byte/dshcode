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
 *
 * Three visually distinct states (izzy, 2026-09-16: "make sure the button
 * indicates when its on /off it always looks like the same right now"),
 * none of them color-only: OFF is a hairline outline with a muted "OFF" mono
 * tag; ON is filled with the accent and an accent-ink "ON" tag; PENDING
 * layers a dotted ring, colored by `target`, over whichever of the two the
 * chip is currently painting, with a title that says the change applies
 * next turn. See `OrchestrateToggle.module.css` for the `off`/`on`/`pending`
 * contract and the package README's "State contract" section.
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

  // Off is its own class (not merely the absence of `.on`): the chip must
  // paint two genuinely different rules, never the same base tinted by one
  // modifier — the OFF and ON tag text below carries the same distinction in
  // words, so neither state ever depends on color alone.
  const className = [
    css.chip,
    active ? css.on : css.off,
    orchestrate.pending ? css.pending : '',
  ].filter(part => part !== '').join(' ')

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={className}
        aria-pressed={active}
        // The queued target, for the pending ring's color only — never read
        // by aria-pressed, which always names the state in force.
        data-target={target ? 'on' : 'off'}
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
        <span className={css.tag}>{t(active ? 'toggle.tag.on' : 'toggle.tag.off')}</span>
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('toggle.failed')}</span>}
    </span>
  )
}
