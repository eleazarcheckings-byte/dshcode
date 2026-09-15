/**
 * The Saturn motion system (SPEC §2): a named three-step duration scale plus
 * standard/out/exit eases, declared once in base.css so component CSS stops
 * inventing ad hoc ms values. 2026-09-15 transcript-polish,
 * recon/desktop-ux-audit.md item 5 — the prior state had 14 distinct
 * duration values project-wide and only 9 uses of the one existing token.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'

const baseCssPath = fileURLToPath(new URL('../src/styles/base.css', import.meta.url))
const baseCss = readFileSync(baseCssPath, 'utf8')

const TOKEN_NAMES = [
  '--saturn-dur-1', '--saturn-dur-2', '--saturn-dur-3',
  '--saturn-ease-standard', '--saturn-ease-out', '--saturn-ease-exit',
] as const

describe('ui-theme base.css Saturn motion tokens', () => {
  it('declares all six named tokens on :root with the SPEC values', () => {
    const rules = parseRules(baseCss.replace(/\/\*[\s\S]*?\*\//g, ' '))
    const root = rules.find(rule => rule.selectors.includes(':root'))
    expect(root, ':root rule').toBeDefined()
    expect(root!.declarations).toEqual(expect.arrayContaining([
      ['--saturn-dur-1', '120ms'],
      ['--saturn-dur-2', '200ms'],
      ['--saturn-dur-3', '320ms'],
      ['--saturn-ease-standard', 'cubic-bezier(.2, 0, 0, 1)'],
      ['--saturn-ease-out', 'cubic-bezier(0, 0, 0, 1)'],
      ['--saturn-ease-exit', 'cubic-bezier(.4, 0, 1, 1)'],
    ]))
  })
})

describe('Saturn motion tokens: real adoption', () => {
  it('is referenced by at least ten declarations under packages/client', () => {
    // Each hit is one `transition`/`animation` declaration that names one of
    // the six tokens (a shorthand transition with two comma-separated
    // properties, each naming a token, counts as two) — real call sites, not
    // merely the :root declaration itself.
    const clientSheets = packageStylesheets().filter(file => file.replace(/\\/g, '/').includes('/packages/client/'))
    let hits = 0
    for (const file of clientSheets) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
      for (const rule of parseRules(css)) {
        for (const [property, value] of rule.declarations) {
          if (!/^(transition|animation)(-duration|-timing-function)?$/.test(property)) continue
          for (const token of TOKEN_NAMES) {
            if (value.includes(`var(${token}`)) hits += 1
          }
        }
      }
    }
    expect(hits).toBeGreaterThanOrEqual(10)
  })
})
