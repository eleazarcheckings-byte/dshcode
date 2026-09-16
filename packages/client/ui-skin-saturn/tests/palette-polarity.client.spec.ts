// @vitest-environment jsdom
/**
 * The Saturn palette must keep every `--dsw-static-*` scale in **descending
 * lightness**: index 00 lightest, index 1000 darkest.
 *
 * This is the product's load-bearing invariant, not a style preference.
 * Upstream switches light/dark in the `--dsw-alias-*` indirection rather than
 * in the scales themselves, so `bg-base` resolves to `neutral-bluish-00` in
 * light and `neutral-bluish-950` in dark, and `label-primary` to
 * `neutral-bluish-1000` in light and `neutral-bluish-50` in dark. Authoring a
 * scale ascending therefore inverts the product: dark mode paints a near-white
 * background while every setting still reads "dark". These tests pin the two
 * anchors that failure mode flips, and the ordering of every scale that feeds
 * them.
 */
import { beforeAll, describe, expect, it } from 'vitest'

const PLUGIN = '@saturnai/dsh-client-ui-skin-saturn'

/** Index suffix variants (`50p`, `700-delete`) are exempt from the ordering check. */
const INDEXED = /^(neutral-bluish|neutral|deepseek|blue|amber|green|red)-(\d+)$/

/** WCAG 2.x relative luminance of an `#rrggbb` colour. */
function luminance(hex: string): number {
  const packed = Number.parseInt(hex.slice(1), 16)
  const channel = (raw: number): number => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((packed >> 16) & 255) + 0.7152 * channel((packed >> 8) & 255) + 0.0722 * channel(packed & 255)
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every `--dsw-static-<family>-<index>` the shipped sheet declares, grouped by family. */
function declaredScales(): Map<string, { index: number; value: string }[]> {
  const tag = document.querySelector(`style[data-plugin="${PLUGIN}"]`)
  expect(tag, 'the skin must inject its stylesheet on import').not.toBeNull()
  const scales = new Map<string, { index: number; value: string }[]>()
  for (const match of tag.textContent.matchAll(/--dsw-static-([a-z0-9-]+):(#[0-9a-f]{6})/g)) {
    const parsed = INDEXED.exec(match[1]!)
    if (parsed === null) continue
    const family = parsed[1]!
    const entry = { index: Number(parsed[2]), value: match[2]! }
    scales.set(family, [...(scales.get(family) ?? []), entry])
  }
  return scales
}

describe('Saturn Premium palette polarity', () => {
  beforeAll(async () => {
    await import('../src/client/index.ts')
  })

  it('declares every scale with lightness strictly descending as the index rises', () => {
    const scales = declaredScales()
    expect(scales.size, 'all seven families ship a scale').toBe(7)
    for (const [family, entries] of scales) {
      const ascending = [...entries].sort((a, b) => a.index - b.index)
      for (let i = 1; i < ascending.length; i += 1) {
        const previous = ascending[i - 1]!
        const current = ascending[i]!
        expect(
          luminance(current.value),
          `${family}-${current.index} (${current.value}) must be darker than ${family}-${previous.index} (${previous.value})`,
        ).toBeLessThan(luminance(previous.value))
      }
    }
  })

  it('keeps the dark alias anchors on the correct side of the scale', () => {
    const scales = declaredScales()
    const lookup = (family: string, index: number): string => {
      const hit = scales.get(family)?.find(entry => entry.index === index)
      expect(hit, `${family}-${index} must be declared`).toBeDefined()
      return hit!.value
    }
    // Dark `--dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950)`.
    expect(luminance(lookup('neutral-bluish', 950)), 'the app base must be near-black').toBeLessThan(0.02)
    // Dark `--dsw-alias-label-primary: var(--dsw-static-neutral-bluish-50)`.
    expect(luminance(lookup('neutral-bluish', 50)), 'the primary label must be near-white').toBeGreaterThan(0.7)
    // Dark `--dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-1000)`.
    expect(luminance(lookup('neutral-bluish', 1000)), 'ink on a filled control must be near-black').toBeLessThan(0.02)
    // Dark `--dsw-alias-state-warn-tertiary: var(--dsw-static-amber-900)`.
    expect(luminance(lookup('amber', 900)), 'a tertiary state surface must be a deep tint').toBeLessThan(0.05)
  })

  it('renders its own text and accent legibly on its own base', () => {
    const scales = declaredScales()
    const value = (family: string, index: number): string =>
      scales.get(family)!.find(entry => entry.index === index)!.value
    const base = value('neutral-bluish', 950)
    expect(contrast(value('neutral-bluish', 50), base), 'primary label').toBeGreaterThanOrEqual(4.5)
    expect(contrast(value('neutral-bluish', 300), base), 'secondary label').toBeGreaterThanOrEqual(4.5)
    expect(contrast(value('neutral-bluish', 600), base), 'caption').toBeGreaterThanOrEqual(4.5)
    expect(contrast(value('amber', 500), base), 'warning label').toBeGreaterThanOrEqual(4.5)
  })
})
