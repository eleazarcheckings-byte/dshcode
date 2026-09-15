/**
 * SPEC §3 C3: "carry the ring into the sidebar active row." The actual
 * session-row markup (and its hashed CSS-module class names) belongs to
 * `ui-workspace`'s `sidebar.workspaces` registrant — out of this cell's write
 * scope — so this shell reaches the active row through the two stable,
 * un-hashed DOM contracts every row already sets regardless of which package
 * renders it: `role="treeitem"` and `aria-selected` (`Rows.tsx`'s
 * `SessionNodeItem`/`SearchResultItem`). A plain attribute selector composed
 * from `.regionArea` (this file's own scoped class) is not itself scoped by
 * CSS Modules — only the leading class name is — so it reaches straight
 * through to whatever the slotted browser renders, with no private class
 * name to depend on and nothing for that package to change.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/** Declarations of one exact selector, keyed by property (mirrors sidebar-styles.client.spec.ts). */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

const ROW = ".regionArea [role='treeitem'][aria-selected='true']"

describe('SidebarRoot.module.css: active-row ring', () => {
  it('establishes a positioning context on the active row without touching its own layout', () => {
    const row = declarations(ROW)
    expect(row?.get('position'), 'a positioning context for the ring overlay').toBe('relative')
  })

  it('draws the ring as a non-interactive absolute overlay, never a layout participant', () => {
    const ring = declarations(`${ROW}::after`)
    expect(ring, 'the ring pseudo-element').toBeDefined()
    expect(ring?.get('content')).toBe("''")
    expect(ring?.get('position')).toBe('absolute')
    expect(ring?.get('pointer-events'), 'must never intercept row clicks/menus').toBe('none')
  })

  it('paints the ring in the Saturn accent token via a mask, so it inherits the accent rather than a fixed hex', () => {
    const ring = declarations(`${ROW}::after`)
    expect(ring?.get('background-color')).toBe('var(--saturn-accent, currentColor)')
    expect(ring?.get('mask-image'), 'a mask-image (not background-image), so background-color paints through the stroke').toBeDefined()
    expect(ring?.get('-webkit-mask-image'), 'Chromium/Electron requires the -webkit- prefixed form too').toBeDefined()
  })

  it('uses the exact -18deg tilt shared by the favicon and every other ring instance (SPEC §2/§3 C3, one tilt everywhere)', () => {
    const ring = declarations(`${ROW}::after`)
    const mask = ring?.get('mask-image') ?? ''
    expect(mask).toMatch(/rotate\(-18 /)
    // Same rx:ry ellipse ratio as the favicon glyph (ui-skin-saturn/src/client/index.ts), not a
    // freehand redraw: rx=27 ry=9.5 on the shared 64x64 viewBox.
    expect(mask).toMatch(/rx='27' ry='9\.5'/)
  })
})
