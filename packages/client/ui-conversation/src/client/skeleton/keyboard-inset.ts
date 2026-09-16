/**
 * Keeps the docked composer above an open on-screen keyboard (SPEC §8 M2).
 *
 * iOS does not shrink the layout viewport when the keyboard opens — the page
 * keeps its full height and the keyboard is simply drawn over the bottom of
 * it — so a composer docked at the viewport floor ends up underneath the keys
 * the user is typing on. The visual viewport is the only surface that reports
 * the covered band, so the shell publishes it as one custom property and the
 * mobile sheet spends it as the composer seat's bottom padding.
 *
 * A pure measurement plus a plain installer, not a hook: this subscribes to a
 * browser surface rather than to any framework source, and business
 * components carry no subscription machinery (packages/client/AGENTS.md).
 */

/** Custom property the measurement is published as; ui-theme's mobile.css reads it. */
export const KEYBOARD_INSET_PROPERTY = '--saturn-keyboard-inset'

/** The two visual-viewport facts the measurement needs. */
interface ViewportMetrics {
  /** Height of the visual viewport in CSS px. */
  height: number
  /** Distance from the layout viewport's top to the visual viewport's. */
  offsetTop: number
}

/**
 * Height of the band the keyboard covers at the bottom of the layout viewport.
 * @param layoutHeight - the layout viewport height (`window.innerHeight`).
 * @param viewport - the visual viewport's metrics, or undefined on an engine
 * without one (the inset is then zero: nothing reports a keyboard, and
 * padding the composer on a guess would move it for no reason).
 * @returns the covered band in whole px, never negative.
 */
export function keyboardInset(layoutHeight: number, viewport: ViewportMetrics | undefined): number {
  if (viewport === undefined) return 0
  // offsetTop is the part of the layout viewport scrolled off the TOP by a
  // pinch or by the focus scroll; it is already outside the visible box, so
  // it must not be counted again as keyboard.
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop))
}

/**
 * Publish the keyboard inset on an element and keep it current.
 * @param target - element the property is written to (the shell uses the
 * document element, so every mobile rule can read it).
 * @param view - the window whose viewports are measured; injectable for tests.
 * @returns idempotent disposer that unsubscribes and clears the property.
 */
export function installKeyboardInset(target: HTMLElement, view: Window = window): () => void {
  const viewport = view.visualViewport ?? undefined
  const publish = (): void => {
    target.style.setProperty(KEYBOARD_INSET_PROPERTY, `${keyboardInset(view.innerHeight, viewport)}px`)
  }
  publish()
  // Both events matter: `resize` is the keyboard opening and closing, `scroll`
  // is the browser scrolling the visual viewport to keep the focused field in
  // sight, which moves offsetTop without changing the height.
  viewport?.addEventListener('resize', publish)
  viewport?.addEventListener('scroll', publish)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    viewport?.removeEventListener('resize', publish)
    viewport?.removeEventListener('scroll', publish)
    target.style.removeProperty(KEYBOARD_INSET_PROPERTY)
  }
}
