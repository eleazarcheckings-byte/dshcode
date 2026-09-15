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
 * `tests/palette-polarity.client.spec.ts`.
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
 * - Depth uses a five-step surface ladder and fine strokes. Canvas lighting
 *   belongs to the component that owns its state and animation lifecycle.
 * - Neutral black and gray surfaces establish depth without a color cast.
 * - White marks brand, focus, selection, and primary actions. Status
 *   colors keep their semantic meaning and are paired with readable text.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** White accent for the monochrome Saturn identity. */
const ACCENT = '#f5f5f5'

/** The frame colour, pinned to what the Electron shell paints around the page. */
const VOID = '#0a0a0a'

/** Body attribute selecting the dark alias set upstream. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Every scale descends in lightness: index 00 lightest, 1000 darkest. */
const DARK: Record<string, string> = {
  'amber-100': '#faf3dd', 'amber-400': '#eec04d', 'amber-500': '#dda43a', 'amber-600': '#c48b2a', 'amber-900': '#241b08',
  'blue-50': '#f2f5f8', 'blue-50p': '#eef2f6', 'blue-75': '#e7edf3', 'blue-100': '#dde6ee', 'blue-300': '#aec2d4',
  'blue-400': '#7fa8cc', 'blue-450': '#6e97bd', 'blue-500': '#5d819f', 'blue-600': '#4a6b87', 'blue-800': '#1d3049', 'blue-950': '#0a0f16',
  'deepseek-50': '#f5f5f5', 'deepseek-100': '#e6e6e6', 'deepseek-200': '#dbdbdb', 'deepseek-300': '#c1c1c1', 'deepseek-400': '#a6a6a6',
  'deepseek-450': '#969696', 'deepseek-500': '#7f7f7f', 'deepseek-600': '#696969', 'deepseek-700-delete': '#505050', 'deepseek-800': '#323232', 'deepseek-900': '#222222',
  'green-100': '#e3efe6', 'green-400': '#5cab70', 'green-500': '#358a50', 'green-900': '#0e2116',
  'neutral-00': '#ffffff', 'neutral-50': '#fafafa', 'neutral-100': '#f6f6f6', 'neutral-150': '#f1f1f1', 'neutral-200': '#e9e9e9',
  'neutral-250': '#e2e2e2', 'neutral-300': '#d6d6d6', 'neutral-400': '#acacac', 'neutral-500': '#818181', 'neutral-550': '#6e6e6e',
  'neutral-600': '#5d5d5d', 'neutral-700': '#464646', 'neutral-800': '#2e2e2e', 'neutral-850': '#262626', 'neutral-900': '#1b1b1b', 'neutral-1000': '#111111',
  'neutral-bluish-00': '#ffffff', 'neutral-bluish-50': '#e9e9e9', 'neutral-bluish-60': '#e2e2e2', 'neutral-bluish-75': '#d8d8d8',
  'neutral-bluish-100': '#cccccc', 'neutral-bluish-150': '#c0c0c0', 'neutral-bluish-200': '#b8b8b8', 'neutral-bluish-250': '#b2b2b2',
  'neutral-bluish-300': '#adadad', 'neutral-bluish-400': '#9f9f9f', 'neutral-bluish-500': '#939393', 'neutral-bluish-600': '#858585',
  'neutral-bluish-700': '#323232', 'neutral-bluish-750': '#2a2a2a', 'neutral-bluish-800': '#222222', 'neutral-bluish-850': '#1c1c1c',
  'neutral-bluish-875': '#161616', 'neutral-bluish-900': '#121212', 'neutral-bluish-950': VOID, 'neutral-bluish-1000': '#080808',
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
  `${PALETTE_SCOPE}{color:#e8e8e8;background-color:${VOID};color-scheme:dark}`,
  `${PALETTE_SCOPE}{${tokenBlock(DARK)}}`,
  // Shared application surfaces; semantic status colors stay in the upstream aliases.
  `${PALETTE_SCOPE}{--saturn-void:${VOID};--saturn-surface:#111111;--saturn-surface-raised:#181818;--saturn-surface-hover:#222222;--saturn-stroke:rgba(255,255,255,.085);--saturn-stroke-strong:rgba(255,255,255,.15);--saturn-ink:#efefef;--saturn-muted:#a0a0a0;--saturn-accent:${ACCENT};--saturn-accent-dim:rgba(255,255,255,.08);--saturn-accent-secondary:#c4c4c4;--saturn-ease:cubic-bezier(.22,1,.36,1);--saturn-duration:180ms}`,
  // ── typography rendering ───────────────────────────────────────────────
  `${PALETTE_SCOPE}{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-variant-ligatures:contextual common-ligatures}`,
  // Shared selection and keyboard focus treatments.
  `${PALETTE_SCOPE} ::selection{background-color:${ACCENT};color:${VOID}}`,
  `${PALETTE_SCOPE} :focus-visible{outline:2px solid ${ACCENT};outline-offset:2px;border-radius:4px}`,
  // Neutral hairline scrollbars.
  `${PALETTE_SCOPE} ::-webkit-scrollbar{width:10px;height:10px}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-track{background:transparent}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-thumb{background-color:var(--dsw-static-neutral-bluish-750,#292929);border:3px solid transparent;background-clip:content-box;border-radius:999px}`,
  `${PALETTE_SCOPE} ::-webkit-scrollbar-thumb:hover{background-color:var(--dsw-static-neutral-bluish-600,#858585)}`,
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
 * degrees, white on transparent. Kept in sync with the glyph in
 * `ui-brand-saturn` by geometry rather than by import — the two packages ship
 * independently and must not take a runtime dependency on each other.
 */
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><defs><clipPath id="f"><rect x="0" y="33" width="64" height="31"/></clipPath></defs><g stroke="' + ACCENT + '" stroke-width="4.5" stroke-linecap="round"><ellipse cx="32" cy="32" rx="27" ry="9.5" transform="rotate(-18 32 32)"/></g><circle cx="32" cy="32" r="15" fill="' + ACCENT + '"/><g stroke="' + ACCENT + '" stroke-width="4.5" stroke-linecap="round" clip-path="url(#f)"><ellipse cx="32" cy="32" rx="27" ry="9.5" transform="rotate(-18 32 32)"/></g></svg>'
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG)

/**
 * Apply the Saturn Premium skin: the body attribute scoping the palette, the
 * dark alias set and colour scheme held against theme flips, and the white
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
