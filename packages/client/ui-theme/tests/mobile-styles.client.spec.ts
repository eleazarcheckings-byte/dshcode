/**
 * The mobile sheet's contract (SPEC §8 M2). It is a global sheet that adapts
 * components it does not own, so its shape is the guarantee: ONE breakpoint,
 * only durable anchors (never another package's hashed CSS-module class),
 * the Saturn motion tokens rather than fresh ms values, the safe-area insets,
 * and a reduced-motion arm nested inside the same breakpoint.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atRuleBlock, parseRules } from './stylesheet-scan.ts'

const mobileCssPath = fileURLToPath(new URL('../src/styles/mobile.css', import.meta.url))
const mobileCss = readFileSync(mobileCssPath, 'utf8')
const stylesTs = readFileSync(fileURLToPath(new URL('../src/client/styles.ts', import.meta.url)), 'utf8')
/** Source with comments stripped: every scan below reads declarations, not prose. */
const source = mobileCss.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** The one breakpoint the sheet is allowed to open. */
const BREAKPOINT = '@media (max-width: 768px)'

describe('ui-theme mobile.css registration', () => {
  it('is mounted by the theme plugin like every other global sheet', () => {
    expect(stylesTs).toContain('../styles/mobile.css?inline')
    expect(stylesTs).toContain("['mobile.css', mobile]")
  })
})

describe('ui-theme mobile.css shape', () => {
  it('opens exactly one top-level media query, at the SPEC breakpoint', () => {
    const topLevel = [...source.matchAll(/^@[^\n{]*/gm)].map(([text]) => text.trim())
    expect(topLevel).toEqual([BREAKPOINT])
  })

  it('nests the reduced-motion arm inside that breakpoint', () => {
    const block = atRuleBlock(source, BREAKPOINT)
    expect(block, 'the breakpoint block').toBeDefined()
    const body = source.slice(block!.start, block!.end)
    expect(body).toContain('@media (prefers-reduced-motion: reduce)')
    // The drawer and the backdrop are the only two motions on the surface;
    // reduced motion must cancel both.
    const reduced = body.slice(body.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('[data-mobile-drawer]')
    expect(reduced).toContain('[data-mobile-backdrop]')
    expect(reduced).toMatch(/transition:\s*none/)
  })

  it('anchors only on durable selectors, never a hashed CSS-module class', () => {
    const classSelectors = parseRules(source)
      .flatMap(rule => rule.selectors)
      .filter(selector => /\.[A-Za-z_-]/.test(selector))
    expect(classSelectors).toEqual([])
  })
})

describe('ui-theme mobile.css behavior', () => {
  const declarations = parseRules(source).flatMap(rule =>
    rule.declarations.map(([property, value]): [string, string, string[]] => [property, value, rule.selectors]))
  const valuesOf = (property: string): string[] =>
    declarations.filter(([name]) => name === property).map(([, value]) => value)

  it('gives the shell a dynamic-viewport height so the URL bar cannot clip it', () => {
    expect(valuesOf('height')).toContain('100dvh')
  })

  it('honors every safe-area inset', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(source).toContain(`env(safe-area-inset-${side}`)
    }
  })

  it('docks the composer above the safe area and the open keyboard', () => {
    const composer = declarations.find(([property, , selectors]) =>
      property === 'padding-bottom' && selectors.some(selector => selector.includes('[data-composer-seat]')))
    expect(composer, 'composer seat padding-bottom').toBeDefined()
    expect(composer![1]).toContain('env(safe-area-inset-bottom')
    expect(composer![1]).toContain('--saturn-keyboard-inset')
  })

  it('slides the drawer on the named motion system, not a fresh duration', () => {
    const transitions = declarations
      .filter(([property, , selectors]) => property === 'transition'
        && selectors.some(selector => selector.includes('[data-mobile-drawer]')))
      .map(([, value]) => value)
    expect(transitions.length).toBeGreaterThan(0)
    expect(transitions[0]).toContain('var(--saturn-dur-2)')
    expect(transitions[0]).toContain('var(--saturn-ease-out)')
    // No ad hoc millisecond literal anywhere in the sheet's motion.
    for (const [property, value] of declarations) {
      if (property !== 'transition' && property !== 'animation') continue
      expect(value, `${property}: ${value}`).not.toMatch(/\d+ms/)
    }
  })

  it('raises every drawer, strip and tool tap target to 44px', () => {
    const targets = declarations
      .filter(([property, value]) => property === 'min-height' && value === '44px')
      .flatMap(([, , selectors]) => selectors)
      .join(' ')
    expect(targets).toContain('[data-mobile-strip]')
    expect(targets).toContain('[data-mobile-drawer]')
    expect(targets).toContain('[data-disclosure-row]')
  })

  it('keeps the tool row a single line with its disclosure intact', () => {
    const row = parseRules(source).find(rule =>
      rule.selectors.some(selector => selector.includes('[data-disclosure-row]'))
      && rule.declarations.some(([property]) => property === 'white-space'))
    expect(row, 'single-line tool row rule').toBeDefined()
    expect(row!.declarations).toEqual(expect.arrayContaining([['white-space', 'nowrap']]))
  })

  it('forbids horizontal scroll on the document and clamps wide payloads', () => {
    expect(valuesOf('overflow-x')).toContain('hidden')
    expect(valuesOf('max-width')).toContain('100%')
  })

  it('stands the SaturnBot launcher down on a phone (the dashboard is a desktop window)', () => {
    const rule = parseRules(source).find(rule =>
      rule.selectors.some(selector => selector.includes('[data-saturnbot-launcher]')))
    expect(rule, 'launcher rule').toBeDefined()
    expect(rule!.selectors.every(selector => selector.includes('[data-shell-frame][data-mobile]'))).toBe(true)
    expect(rule!.declarations).toEqual(expect.arrayContaining([['display', 'none']]))
  })
})
