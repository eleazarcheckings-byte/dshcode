/**
 * Saturn Premium skin — the cinematic deep-space identity, dark-only.
 *
 * ## The polarity rule (read this before changing any value)
 *
 * Upstream defines its `--dsw-static-*` scales **mode-independently**: index 00
 * is the lightest value in both palettes and index 1000 the darkest, for every
 * family. All light/dark switching happens one level up, in the `--dsw-alias-*`
 * indirection, which points at a different index per mode:
 *
 * | alias | light -> | dark -> |
 * | --- | --- | --- |
 * | `bg-base` | `neutral-bluish-00` (white) | `neutral-bluish-950` (near-black) |
 * | `label-primary` | `neutral-bluish-1000` (black) | `neutral-bluish-50` (near-white) |
 * | `state-warn-tertiary` | `amber-100` (pale) | `amber-900` (deep) |
 *
 * So a skin that fills these scales must keep **descending lightness**: a lower
 * index is always lighter than a higher one. Authoring them ascending inverts
 * the product — in dark mode `bg-base` then resolves to a near-white and the
 * whole UI renders white while every setting still says "dark". That is exactly
 * the defect this file was rewritten to correct, so preserve the ordering; the
 * monotonicity of every scale here is asserted by
 * `tests/palette-polarity.spec.ts`.
 *
 * ## Why dark-only
 *
 * There is no light token block. Upstream keys its palette on `body` for light
 * and `body[data-ds-dark-theme]` for dark, so a skin shipping a light default
 * renders a white product whenever the dark attribute is missing. Forcing the
 * attribute (see {@link apply}) removes that entire class of failure.
 *
 * ## Design rules the values encode
 *
 * - **Space is luminance, not gradient.** Depth is a five-step surface ladder
 *   plus hairline strokes — never shadow, blur, or a gradient.
 * - **Cold, not charcoal.** Surfaces sit on a faint blue-violet cast, which is
 *   what reads as space rather than as a grey developer tool.
 * - **Gold is earned.** Saturn gold is the only saturated accent, and only for
 *   brand, focus, selection, and warning. No gold washes or gradients.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Saturn gold — the single saturated accent. */
const GOLD = '#dda43a'

/** The frame colour, pinned to what the Electron shell paints around the page. */
const VOID = '#0a0a0c'

/** Body attribute selecting the dark alias set upstream. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Every scale descends in lightness: index 00 lightest, 1000 darkest. */
const DARK: Record<string, string> = {
  'amber-100': '#faf3dd', 'amber-400': '#eec04d', 'amber-500': GOLD, 'amber-600': '#c48b2a', 'amber-900': '#241b08',
  'blue-50': '#f2f5f8', 'blue-50p': '#eef2f6', 'blue-75': '#e7edf3', 'blue-100': '#dde6ee', 'blue-300': '#aec2d4',
  'blue-400': '#7fa8cc', 'blue-450': '#6e97bd', 'blue-500': '#5d819f', 'blue-600': '#4a6b87', 'blue-800': '#1d3049', 'blue-950': '#0a0f16',
  'deepseek-50': '#f2f5f8', 'deepseek-100': '#dde6ee', 'deepseek-200': '#cfdbe6', 'deepseek-300': '#aec2d4', 'deepseek-400': '#7fa8cc',
  'deepseek-450': '#6e97bd', 'deepseek-500': '#5d819f', 'deepseek-600': '#4a6b87', 'deepseek-700-delete': '#365268', 'deepseek-800': '#1d3049', 'deepseek-900': '#14232e',
  'green-100': '#e3efe6', 'green-400': '#5cab70', 'green-500': '#358a50', 'green-900': '#0e2116',
  'neutral-00': '#ffffff', 'neutral-50': '#fafafb', 'neutral-100': '#f5f5f7', 'neutral-150': '#f0f0f3', 'neutral-200': '#e8e8ec',
  'neutral-250': '#e0e0e5', 'neutral-300': '#d4d4da', 'neutral-400': '#a9a9b2', 'neutral-500': '#7d7d88', 'neutral-550': '#6a6a75',
  'neutral-600': '#5a5a63', 'neutral-700': '#43434c', 'neutral-800': '#2b2b33', 'neutral-850': '#23232b', 'neutral-900': '#191920', 'neutral-1000': '#0f0f14',
  'neutral-bluish-00': '#ffffff', 'neutral-bluish-50': '#e7e7ec', 'neutral-bluish-60': '#dfdfe7', 'neutral-bluish-75': '#d5d5de',
  'neutral-bluish-100': '#c9c9d1', 'neutral-bluish-150': '#bcbcc7', 'neutral-bluish-200': '#b4b4c1', 'neutral-bluish-250': '#aeacbb',
  'neutral-bluish-300': '#a8a8b8', 'neutral-bluish-400': '#9a9aa9', 'neutral-bluish-500': '#8e8e9d', 'neutral-bluish-600': '#80808f',
  'neutral-bluish-700': '#2e2e3a', 'neutral-bluish-750': '#262631', 'neutral-bluish-800': '#1f1f28', 'neutral-bluish-850': '#191921',
  'neutral-bluish-875': '#14141b', 'neutral-bluish-900': '#101016', 'neutral-bluish-950': VOID, 'neutral-bluish-1000': '#07070a',
  'red-50': '#fdf1ef', 'red-100': '#fae4e1', 'red-400': '#e0685f', 'red-500': '#c84439', 'red-600': '#b1352b', 'red-900': '#5c1e18',
}

/** One CSS custom-property per token in the given set. */
function tokenBlock(set: Record<string, string>): string {
  return Object.entries(set).map(([key, value]) => `--dsw-static-${key}:${value}`).join(';')
}

/**
 * The selector that owns the palette.
 *
 * The attribute is repeated on purpose. Upstream defines the same names on
 * `body[data-ds-dark-theme]` at specificity (0,1,1), so a plain
 * `body[data-dsh-saturn]` would tie it and win only on stylesheet order — not
 * guaranteed, because this sheet is appended at plugin load. Repeating the
 * attribute raises the palette to (0,2,1) so it wins outright. Do not
 * "simplify" it away.
 */
const PALETTE_SCOPE = 'body[data-dsh-saturn][data-dsh-saturn]'

const SKIN_CSS = [
  // ── the frame ──────────────────────────────────────────────────────────
  `${PALETTE_SCOPE}{color:#e7e7ec;background-color:${VOID};color-scheme:dark}`,
  `${PALETTE_SCOPE}{${tokenBlock(DARK)}}`,
  // ── typography rendering ───────────────────────────────────────────────
  `${PALETTE_SCOPE}{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-variant-ligatures:contextual common-ligatures}`,
  // ── selection: the gold, stated once and quietly ───────────────────────
  `${PALETTE_SCOPE} ::selection{background-color:${GOLD};color:${VOID}}`,
  // ── focus: the ring, in gold, on every keyboard target ────────────────
  `${PALETTE_SCOPE} :focus-visible{outline:2px solid ${GOLD};outline-offset:2px;border-radius:4px}`,
  // ── scrollbars: hairline, cold, never a default chrome bar ────────────
  `${PALETTE_SCOPE} ::-webkit-scrollbar{width:10px;height:10px}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-track{background:transparent}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-thumb{background-color:var(--dsw-static-neutral-bluish-750,#262631);border:3px solid transparent;background-clip:content-box;border-radius:999px}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-thumb:hover{background-color:var(--dsw-static-neutral-bluish-600,#80808f)}`,
  // ── the reduced-motion contract: this skin ships no motion of its own, and
  //    it also tightens anything underneath that would animate ────────────
  `@media (prefers-reduced-motion: reduce){${PALETTE_SCOPE} *,${PALETTE_SCOPE} *::before,${PALETTE_SCOPE} *::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important}}`,
].join('\n')

const SKIN_TAG_ID = '@saturnai/dsh-client-ui-skin-saturn/saturn-premium.css'

if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(SKIN_TAG_ID) + ']') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@saturnai/dsh-client-ui-skin-saturn'
  tag.dataset.pluginCss = SKIN_TAG_ID
  tag.textContent = SKIN_CSS
  document.head.appendChild(tag)
}

/**
 * The Saturn mark as an SVG favicon: a solid planet with a thin ring tilted 18
 * degrees, gold on transparent. Kept in sync with the glyph in
 * `ui-brand-saturn` by geometry rather than by import — the two packages ship
 * independently and must not take a runtime dependency on each other.
 */
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><defs><clipPath id="f"><rect x="0" y="33" width="64" height="31"/></clipPath></defs><g stroke="' + GOLD + '" stroke-width="4.5" stroke-linecap="round"><ellipse cx="32" cy="32" rx="27" ry="9.5" transform="rotate(-18 32 32)"/></g><circle cx="32" cy="32" r="15" fill="' + GOLD + '"/><g stroke="' + GOLD + '" stroke-width="4.5" stroke-linecap="round" clip-path="url(#f)"><ellipse cx="32" cy="32" rx="27" ry="9.5" transform="rotate(-18 32 32)"/></g></svg>'
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG)

/**
 * Apply the Saturn Premium skin: the body attribute scoping the palette, the
 * dark alias set and colour scheme held against theme flips, and the gold
 * favicon. The effect disposer retracts every write.
 *
 * Two values are *held* rather than merely set, because ThemePresenter rewrites
 * both when the harness resolves light: the body's dark attribute (which
 * selects the alias set, and whose absence alone is enough to repaint the whole
 * product white) and the root colour scheme (an inline declaration that
 * outranks any stylesheet, so native scrollbars and form controls would
 * otherwise follow the OS). Each holder rewrites only when the value actually
 * differs, so neither can loop against its own write.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const body = document.body
  const root = document.documentElement
  body.dataset.dshSaturn = ''
  const priorScheme = root.style.colorScheme
  const priorHadDark = body.hasAttribute(DARK_ATTRIBUTE)
  const holdDark = (): void => {
    if (!body.hasAttribute(DARK_ATTRIBUTE)) body.setAttribute(DARK_ATTRIBUTE, '')
    if (root.style.colorScheme !== 'dark') root.style.colorScheme = 'dark'
  }
  holdDark()
  const observer = new MutationObserver(holdDark)
  observer.observe(body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
  observer.observe(root, { attributes: true, attributeFilter: ['style'] })
  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.type = 'image/svg+xml'
  favicon.href = FAVICON
  document.head.append(favicon)
  ctx.effect(() => () => {
    observer.disconnect()
    delete body.dataset.dshSaturn
    if (!priorHadDark) body.removeAttribute(DARK_ATTRIBUTE)
    root.style.colorScheme = priorScheme
    favicon.remove()
  }, 'ui-skin-saturn: cinematic palette')
}
