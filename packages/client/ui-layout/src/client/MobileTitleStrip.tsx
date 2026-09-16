/**
 * The phone shell's top strip (SPEC §8 M2). On a desktop frame the sidebar IS
 * the navigation; on a phone it is an overlay, so the strip carries the one
 * control that reaches it plus the name of what is currently open.
 *
 * The control is the signature ring (SPEC §2): the same -18° hairline ellipse
 * the favicon and the active session row draw, tilting to a full stop as the
 * drawer opens — one of the surface's two intentional motions, on the named
 * motion system, cancelled under reduced motion. Pure presentation: every
 * fact arrives as a prop from AppFrame.
 */
import type { RefObject } from 'react'
import css from './MobileTitleStrip.module.css'

/** What the strip needs from the frame. */
export interface MobileTitleStripProps {
  /** Name of the open session, or the product title when none is open. */
  title: string
  /** Accessible name of the drawer control, already localized for its state. */
  menuLabel: string
  /** Id of the drawer panel this control owns. */
  drawerId: string
  /** Whether the drawer is currently open. */
  open: boolean
  /** Flip the drawer. */
  onToggle: () => void
  /** The frame holds this control so the closing drawer can hand focus back to it. */
  buttonRef: RefObject<HTMLButtonElement>
}

/**
 * Render the phone title strip.
 * @param props - the frame's strip state (see {@link MobileTitleStripProps}).
 * @returns the strip element.
 */
export function MobileTitleStrip({ title, menuLabel, drawerId, open, onToggle, buttonRef }: MobileTitleStripProps) {
  return (
    <header className={css.strip} data-mobile-strip="">
      <button
        ref={buttonRef}
        type="button"
        className={css.menu}
        data-mobile-menu=""
        aria-label={menuLabel}
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={onToggle}
      >
        <span className={css.ring} aria-hidden="true" />
      </button>
      <span className={css.title}>{title}</span>
    </header>
  )
}
