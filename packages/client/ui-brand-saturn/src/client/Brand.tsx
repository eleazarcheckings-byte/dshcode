/**
 * Saturn AI brand presentation components. The glyph draws inline with
 * `currentColor`, with the skin's monochrome accent; the wordmark
 * stylesheet rides a plugin-tagged style element injected at load.
 */
import { useId } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en } from './locales.ts'

// The accent owns brand contrast; the semantic label remains the fallback
// for compositions that provide no Saturn skin.
const WORDMARK_CSS = [
  '.saturn-brand-wordmark{display:inline-flex;align-items:baseline;gap:.45em;font-weight:680;letter-spacing:-.02em;font-size:15px;line-height:1;color:var(--saturn-accent,var(--dsw-alias-label-primary,currentColor));white-space:nowrap}',
  '.saturn-brand-wordmark .saturn-brand-ai{font-weight:520;opacity:.6;font-size:.9em}',
].join('\n')

const WORDMARK_TAG_ID = '@saturnai/dsh-client-ui-brand-saturn/wordmark.css'

if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(WORDMARK_TAG_ID) + ']') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@saturnai/dsh-client-ui-brand-saturn'
  tag.dataset.pluginCss = WORDMARK_TAG_ID
  tag.textContent = WORDMARK_CSS
  document.head.appendChild(tag)
}

/**
 * The Saturn glyph: a solid planet with a thin ring tilted 18 degrees, passing
 * behind the planet's top and in front of its bottom.
 * @param props - Host-supplied mark presentation.
 * @returns the currentColor glyph.
 */
export function SaturnGlyph({ size }: SidebarBrandMarkOwnerProps) {
  const clipId = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ color: 'var(--saturn-accent, currentColor)' }} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={33} width={64} height={31} />
        </clipPath>
      </defs>
      <g stroke="currentColor" strokeWidth={4.5} strokeLinecap="round">
        <ellipse cx={32} cy={32} rx={27} ry={9.5} transform="rotate(-18 32 32)" />
      </g>
      <circle cx={32} cy={32} r={15} fill="currentColor" />
      <g stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" clipPath={`url(#${clipId})`}>
        <ellipse cx={32} cy={32} rx={27} ry={9.5} transform="rotate(-18 32 32)" />
      </g>
    </svg>
  )
}

/**
 * Render the conversation hero brand mark. The host class is spread onto the
 * wrapper so the surrounding mark geometry is preserved.
 * @param props - Hero slot presentation (size and host class).
 * @returns the wrapped glyph.
 */
export function SaturnHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <span className={className}>
      <SaturnGlyph size={size} />
    </span>
  )
}

/** Render the sidebar name occupant: text wordmark, no artwork asset. */
export function SaturnName() {
  return (
    <span className="saturn-brand-wordmark">
      <span>{en.name}</span>
      <span className="saturn-brand-ai">{en.ai}</span>
    </span>
  )
}
