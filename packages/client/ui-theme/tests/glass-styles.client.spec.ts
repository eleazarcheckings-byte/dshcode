/**
 * Glass-panel stylesheet contract, asserted against the CSS text on disk.
 * gradient-shadow-text.css declares the three glass tokens, each in exactly one
 * sheet; a glass surface takes the fill together with the blur in the same rule,
 * so a translucent fill is never left compositing with unblurred content, and
 * each fallback path resolves the surface opaque instead of leaving a washed-out
 * fill. The recipe a consumer writes for an elevated glass panel is:
 *
 *   border: 0;
 *   background: var(--dsw-glass-surface);
 *   backdrop-filter: var(--dsw-glass-filter);
 *   box-shadow: var(--dsw-glass-elevation);
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atRuleBlock, packageStylesheets, parseRules, varReferences } from './stylesheet-scan.ts'

const SURFACE = '--dsw-glass-surface'
const FILTER = '--dsw-glass-filter'
const GLASS_ELEVATION = '--dsw-glass-elevation'
const REDUCED_TRANSPARENCY = '@media (prefers-reduced-transparency: reduce)'
const NO_BACKDROP_FILTER = '@supports not (backdrop-filter: blur(1px))'

const sheetCss = readFileSync(
  fileURLToPath(new URL('../src/styles/gradient-shadow-text.css', import.meta.url)), 'utf8')

/** The at-rule preludes this sheet conditionally overrides glass tokens under. */
const FALLBACK_PRELUDES = [REDUCED_TRANSPARENCY, NO_BACKDROP_FILTER]

/**
 * Sheet text with the fallback at-rule blocks cut out. parseRules does not
 * handle nesting, so a `body` rule inside a media block flattens into an
 * ordinary `body` rule and would be read as a top-level declaration.
 * @param css - stylesheet text.
 * @returns the text outside the fallback preludes and their blocks.
 */
function withoutFallbacks(css: string): string {
  const spans = FALLBACK_PRELUDES.flatMap((prelude) => {
    const at = css.indexOf(prelude)
    const block = atRuleBlock(css, prelude)
    if (at === -1 || block === undefined) return []
    return [{ start: at, end: block.end + 1 }]
  }).sort((left, right) => left.start - right.start)
  let outside = ''
  let cursor = 0
  for (const span of spans) {
    outside += css.slice(cursor, span.start)
    cursor = span.end
  }
  return outside + css.slice(cursor)
}

/**
 * Alpha channel of a color value, 1 for anything fully opaque (including a
 * token reference, which this sheet only uses for opaque steps).
 * @param value - declaration value.
 * @returns the alpha channel.
 */
function alphaOf(value: string): number {
  if (!value.startsWith('rgba(')) return 1
  const parts = value.slice(5, -1).split(',')
  return Number((parts[parts.length - 1] ?? '').trim())
}

/**
 * Declarations of every rule whose selector list is exactly the given parts.
 * @param css - stylesheet text.
 * @param selectors - the exact selector list to match.
 * @returns the declarations, later rules winning.
 */
function declarationsFor(css: string, selectors: string[]): Map<string, string> {
  return new Map(parseRules(css)
    .filter(rule => rule.selectors.length === selectors.length
      && rule.selectors.every((selector, index) => selector === selectors[index]))
    .flatMap(rule => rule.declarations))
}

describe('glass tokens', () => {
  const topLevel = withoutFallbacks(sheetCss)
  const light = declarationsFor(topLevel, ['body'])
  const dark = declarationsFor(topLevel, ['body[data-ds-dark-theme]'])
  const perElement = new Map(parseRules(topLevel)
    .filter(rule => rule.selectors.includes('body *'))
    .flatMap(rule => rule.declarations))

  it('fills a panel from a translucent surface in both themes', () => {
    const lightFill = light.get(SURFACE) ?? ''
    const darkFill = dark.get(SURFACE) ?? ''
    for (const [name, fill] of [['light', lightFill], ['dark', darkFill]] as const) {
      expect(fill, name).toMatch(/^rgba\(/)
      expect(alphaOf(fill), name).toBeGreaterThan(0)
      expect(alphaOf(fill), name).toBeLessThan(1)
    }
    // Parallel values: one alpha for both themes, so a converted surface reads
    // at the same weight in either theme.
    expect(alphaOf(lightFill)).toBe(alphaOf(darkFill))
    expect(darkFill).not.toBe(lightFill)
  })

  it('carries the blur and the saturate in one filter token', () => {
    const filter = light.get(FILTER) ?? ''
    expect(filter).toMatch(/^blur\(/)
    expect(filter).toContain('saturate(')
    expect(dark.has(FILTER)).toBe(false)
  })

  it('declares the glass elevation per element so a stroke rebind reaches it', () => {
    expect(perElement.get(GLASS_ELEVATION))
      .toBe('var(--dsw-elevation-stroke), 0 6px 20px 0 rgba(0, 0, 0, 0.06), 0 0 16px 0 rgba(0, 0, 0, 0.02)')
    // Declared on body alone it would bake in body's stroke color, making a
    // surface's --dsw-elevation-stroke-color rebind a no-op.
    expect(light.has(GLASS_ELEVATION)).toBe(false)
    expect(perElement.get(GLASS_ELEVATION)).toMatch(/^var\(--dsw-elevation-stroke\), 0 /)
  })
})

describe('glass fallbacks keep the surface and drop the translucency', () => {
  /**
   * The fallback block for one prelude.
   * @param prelude - at-rule prelude to locate.
   * @returns the block's CSS text.
   */
  function fallbackCss(prelude: string): string {
    const block = atRuleBlock(sheetCss, prelude)
    expect(block, prelude).toBeDefined()
    return sheetCss.slice(block?.start ?? 0, block?.end ?? 0)
  }

  it('resolves the fill opaque in both themes under reduced transparency', () => {
    const css = fallbackCss(REDUCED_TRANSPARENCY)
    const light = declarationsFor(css, ['body'])
    const dark = declarationsFor(css, ['body[data-ds-dark-theme]'])
    for (const [name, fill] of [['light', light.get(SURFACE) ?? ''], ['dark', dark.get(SURFACE) ?? '']] as const) {
      expect(alphaOf(fill), name).toBe(1)
      expect(fill, name).toMatch(/^var\(--dsw-static-neutral-bluish-\d+\)$/)
    }
    // The dark override repeats the dark selector: a bare `body` rule loses to
    // the `body[data-ds-dark-theme]` fill, so without this pair the dark theme
    // would keep its translucent fill under reduced transparency.
    expect(dark.get(SURFACE)).not.toBe(light.get(SURFACE))
  })

  it('drops the blur but leaves the elevation stroke standing', () => {
    const css = fallbackCss(REDUCED_TRANSPARENCY)
    const light = declarationsFor(css, ['body'])
    expect(light.get(FILTER)).toBe('none')
    // Reduced transparency removes the translucency, not the surface: the
    // outline and soft layers an untouched --dsw-glass-elevation supplies stay.
    expect(css.includes(GLASS_ELEVATION)).toBe(false)
  })

  it('resolves the fill opaque where backdrop-filter is unsupported', () => {
    const css = fallbackCss(NO_BACKDROP_FILTER)
    const light = declarationsFor(css, ['body'])
    const dark = declarationsFor(css, ['body[data-ds-dark-theme]'])
    for (const [name, fill] of [['light', light.get(SURFACE) ?? ''], ['dark', dark.get(SURFACE) ?? '']] as const) {
      expect(alphaOf(fill), name).toBe(1)
      expect(fill, name).toMatch(/^var\(--dsw-static-neutral-bluish-\d+\)$/)
    }
  })

  it('overrides in the cascade rather than only in the text', () => {
    // A fallback that lost the cascade would leave the translucent fill in
    // place. The light override repeats the `body` selector of the light
    // declaration and wins on source order; the dark override repeats the dark
    // selector for the same reason, since `body` alone is a lower specificity
    // than the `body[data-ds-dark-theme]` fill it has to beat.
    const fallbackStart = atRuleBlock(sheetCss, REDUCED_TRANSPARENCY)?.start ?? 0
    expect(fallbackStart).toBeGreaterThan(sheetCss.indexOf('--dsw-glass-surface: rgba(255, 255, 255, 0.72)'))
    expect(fallbackStart).toBeGreaterThan(sheetCss.indexOf('--dsw-glass-surface: rgba(53, 54, 56, 0.72)'))
    // The dark fill and its dark override are two declarations with the same
    // selector, so the one the media block carries is the one that wins.
    expect(declarationsFor(sheetCss.slice(0, fallbackStart), ['body[data-ds-dark-theme]']).get(SURFACE))
      .not.toBe(declarationsFor(fallbackCss(REDUCED_TRANSPARENCY), ['body[data-ds-dark-theme]']).get(SURFACE))
  })
})

/**
 * Rules that take the glass fill without the blur beside it. A translucent fill
 * with no backdrop filter composites with unblurred content, which is the
 * washed-out fill the material exists to avoid. The elevation is not required
 * here: a non-elevated wash (a hover fill on a seated chip) carries the same
 * fill and blur without floating, and the elevation spec separately rejects a
 * neutral border beside an elevation shadow.
 * @param css - stylesheet text.
 * @returns the offending selectors, in source order.
 */
function unblurredGlassRules(css: string): string[] {
  return parseRules(css)
    .filter((rule) => {
      const referenced = varReferences(rule.declarations.map(([, value]) => value).join(' '))
      return referenced.includes(SURFACE) && !referenced.includes(FILTER)
    })
    .map(rule => rule.selectors.join(', '))
}

describe('a glass fill never ships without its blur', () => {
  it('rejects a fill that drops the filter', () => {
    expect(unblurredGlassRules(
      '.a { border: 0; background: var(--dsw-glass-surface); backdrop-filter: var(--dsw-glass-filter); box-shadow: var(--dsw-glass-elevation); }',
    )).toEqual([])
    // A seated wash needs no elevation, and is not a violation.
    expect(unblurredGlassRules(
      '.a { background: var(--dsw-glass-surface); backdrop-filter: var(--dsw-glass-filter); }',
    )).toEqual([])
    expect(unblurredGlassRules(
      '.a { background: var(--dsw-glass-surface); }',
    )).toEqual(['.a'])
  })

  it('finds no unblurred glass fill under packages/', () => {
    const unblurred = packageStylesheets().flatMap(file =>
      unblurredGlassRules(readFileSync(file, 'utf8')).map(selectors => `${file} ${selectors}`))
    expect(unblurred).toEqual([])
  })

  it('declares each glass token in exactly one sheet', () => {
    // The tokens have one home; a second declaration would let a surface fork
    // the material without touching the owner sheet.
    const declaring = packageStylesheets().filter(file =>
      parseRules(readFileSync(file, 'utf8'))
        .some(rule => rule.declarations.some(([property]) =>
          property === SURFACE || property === FILTER || property === GLASS_ELEVATION)))
    expect(declaring.map(file => file.replace(/\\/g, '/').split('/src/').pop()))
      .toEqual(['styles/gradient-shadow-text.css'])
  })
})
