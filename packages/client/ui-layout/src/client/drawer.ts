/**
 * Modal-drawer keyboard contract for the phone shell (SPEC §8 M2): while the
 * sidebar is overlaid on the conversation it must behave like a dialog —
 * Escape dismisses it, Tab cannot walk out of it into the transcript
 * underneath, and the control that opened it gets focus back when it closes.
 *
 * A plain installer rather than a React hook: this subscribes to the DOM, not
 * to any framework source, and the four props shares are the only channel
 * business components use (packages/client/AGENTS.md). AppFrame drives it
 * from one effect, and the whole contract stays provable without a renderer.
 */

/** Selector for the controls a drawer can hand focus to. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',')

/** What the trap needs from its owner. */
export interface DrawerTrapOptions {
  /** Called when the drawer asks to be dismissed (Escape). */
  onClose: () => void
  /**
   * Whether the viewer has asked for reduced motion. The panel then has no
   * slide to start, so focus moves in the same task instead of waiting a
   * frame for the transform to be under way — the JS half of the §2
   * reduced-motion contract, whose CSS half lives in ui-theme's mobile.css.
   */
  reducedMotion: boolean
  /**
   * Where focus goes when the drawer closes. Supplied by a shell that knows
   * its own opener (the title strip's control), because "whatever was focused
   * when it opened" is only right when a focused control opened it — the
   * drawer can also be opened from `ctx.layout`, from a pointer press that
   * moved no focus, or from the column's own toggle inside the panel.
   * Omitted, the trap falls back to the element that held focus at install.
   */
  restoreFocusTo?: HTMLElement | null
}

/**
 * The focusable controls inside a container, in document order.
 * @param container - drawer panel element.
 * @returns every enabled, rendered control the drawer can focus.
 */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.hidden) return false
    // The closed drawer is both off-canvas and `visibility: hidden`, and
    // visibility inherits — so this one read also excludes every control of a
    // drawer that is merely parked, without depending on layout being
    // measured (offsetParent is unusable outside a real engine).
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    return style === undefined || (style.display !== 'none' && style.visibility !== 'hidden')
  })
}

/**
 * Trap keyboard focus inside an open drawer.
 * @param container - the drawer panel; the listener is installed on it, so it
 * only ever sees keys raised inside the drawer.
 * @param options - dismissal callback and the reduced-motion preference.
 * @returns idempotent disposer; it restores focus to whatever held it when
 * the drawer opened, provided that element is still in the document.
 */
export function installDrawerTrap(container: HTMLElement, options: DrawerTrapOptions): () => void {
  const opener = options.restoreFocusTo
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  let frame: number | null = null
  let disposed = false

  const takeFocus = (): void => {
    const first = focusableWithin(container)[0]
    if (first !== undefined) { first.focus(); return }
    // A drawer whose occupant has not rendered its controls yet still has to
    // hold focus, or Tab would immediately escape to the page behind it.
    container.tabIndex = -1
    container.focus()
  }
  if (options.reducedMotion) takeFocus()
  else frame = requestAnimationFrame(() => { frame = null; takeFocus() })

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      options.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const stops = focusableWithin(container)
    const first = stops.at(0)
    const last = stops.at(-1)
    if (first === undefined || last === undefined) return
    // Only the two ends are the trap's business: every interior Tab is the
    // browser's own, and preventing it would break the drawer's own order.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  container.addEventListener('keydown', onKeyDown)

  return () => {
    if (disposed) return
    disposed = true
    container.removeEventListener('keydown', onKeyDown)
    if (frame !== null) { cancelAnimationFrame(frame); frame = null }
    if (opener !== null && opener.isConnected) opener.focus()
  }
}
