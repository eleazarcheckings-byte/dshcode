/**
 * The multi-task chip's on/off contract as CSS text: the `on` and `off`
 * selectors must declare different `background` and `border`, or the chip
 * would carry different class names while painting identically — exactly
 * the bug izzy reported (the button "always looks like the same"). Plain
 * Node environment, matching this package's other CSS-text specs
 * (`import.meta.url` reads the file directly; no jsdom pragma).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/OrchestrateToggle.module.css', import.meta.url)),
  'utf8',
)

/** Pull one standalone `.name { ... }` rule's declaration body out of the sheet. */
function rule(source: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)\\.${name}\\s*\\{([^}]*)\\}`).exec(source)
  if (match?.[1] === undefined) throw new Error(`expected a standalone .${name} rule in OrchestrateToggle.module.css`)
  return match[1]
}

/** Read one declaration's value out of a rule body. */
function declaration(body: string, property: string): string {
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(body)
  if (match?.[1] === undefined) throw new Error(`expected a "${property}" declaration`)
  return match[1].trim()
}

describe('OrchestrateToggle.module.css — on/off contract', () => {
  it('declares a standalone off rule and a standalone on rule', () => {
    expect(rule(css, 'off')).toMatch(/background:/)
    expect(rule(css, 'on')).toMatch(/background:/)
  })

  it('paints a different background for on than for off', () => {
    const off = declaration(rule(css, 'off'), 'background')
    const on = declaration(rule(css, 'on'), 'background')
    expect(on).not.toBe(off)
  })

  it('paints a different border for on than for off', () => {
    const off = declaration(rule(css, 'off'), 'border')
    const on = declaration(rule(css, 'on'), 'border-color')
    expect(on).not.toBe(off)
  })

  it('marks the pending ring distinct from the resting chip border (dotted/hatched, never solid)', () => {
    const pending = rule(css, 'pending')
    expect(pending).toMatch(/outline.*dash/)
  })

  it('turns off the color transition under prefers-reduced-motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1]
    expect(reduced).toBeTruthy()
    expect(reduced).toMatch(/\.chip\s*\{[^}]*transition:\s*none/)
  })
})
