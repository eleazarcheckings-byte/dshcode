/**
 * The conversation header as a touch surface (SPEC §8 M2, Mars r1 finding 1).
 *
 * The first cut of the mobile sheet raised the strip, the drawer, the composer
 * seat and the tool disclosure rows to 44px and stopped there — which left the
 * row a phone user reaches for most often at its desktop size: the view tabs
 * are a 13/16 label over an 11px pad (~27px), and the Agent Team / job-list /
 * Definition-of-Done seats fill the same row from packages this sheet does not
 * own. The fix anchors the header itself, so those packages publish nothing
 * new; this spec is the guard that the anchor keeps carrying the rule.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const mobileCss = readFileSync(fileURLToPath(new URL('../src/styles/mobile.css', import.meta.url)), 'utf8')
/** Declarations only: every scan below reads rules, never the prose around them. */
const source = mobileCss.replace(/\/\*[\s\S]*?\*\//g, ' ')
const rules = parseRules(source)

/** Rules whose selector list mentions `anchor`. */
function rulesFor(anchor: string) {
  return rules.filter(rule => rule.selectors.some(selector => selector.includes(anchor)))
}

describe('ui-theme mobile.css conversation header', () => {
  it('raises every control in the header to a 44px touch target', () => {
    const header = rulesFor('[data-conversation-header]')
    expect(header.length, 'a rule anchored on the conversation header').toBeGreaterThan(0)
    const controls = header.find(rule => rule.selectors.some(selector => /\bbutton\b/.test(selector)))
    expect(controls, '[data-conversation-header] button').toBeDefined()
    expect(controls!.declarations).toEqual(expect.arrayContaining([
      ['min-height', '44px'],
      ['min-width', '44px'],
    ]))
  })

  it('keeps the tab label on the bar it is underlined by, not floating in a taller box', () => {
    const tab = rulesFor('[data-conversation-tab]')
    expect(tab.length, 'a rule anchored on the view tab').toBeGreaterThan(0)
    const declared = new Map(tab.flatMap(rule => rule.declarations))
    expect(declared.get('align-items')).toBe('flex-end')
  })

  it('reaches the header through a durable attribute, never a hashed module class', () => {
    for (const rule of [...rulesFor('[data-conversation-header]'), ...rulesFor('[data-conversation-tab]')]) {
      for (const selector of rule.selectors) {
        expect(selector, selector).not.toMatch(/\.[A-Za-z_-]/)
      }
    }
  })

  it('stays inside the one breakpoint the sheet is allowed to open', () => {
    const topLevel = [...source.matchAll(/^@[^\n{]*/gm)].map(([text]) => text.trim())
    expect(topLevel).toEqual(['@media (max-width: 768px)'])
  })
})
