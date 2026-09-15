/**
 * Mars fix-round (2026-09-15, transcript-polish C2): DELIVER (1) scopes the
 * 70ch prose-measure cap to assistant markdown prose, with tool cards exempt.
 * `MarkdownText.module.css`'s rule (`.markdown :where(p, li, blockquote,
 * h1..h6) { max-width: var(--dsh-chat-prose-measure, 70ch) }`, pinned by
 * `ui-primitives/tests/markdown-prose-measure.client.spec.ts`) falls back to
 * 70ch whenever nothing sets the custom property — which is exactly what
 * happens for the same `MarkdownText` rendered inside a tool card's `WebBlock`
 * (`ToolRow.tsx:298` → `css.webBody`, `ToolDetails.tsx:57` → `css.web`,
 * `WebBlock.tsx:156`). Since a set (even to `none`) custom property short-
 * circuits the `var()` fallback, the wrapper class the tool card already
 * passes to `WebBlock` is the reset point: no change to the pinned
 * MarkdownText rule itself, no RED test edited.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function declarations(css: string, selector: string, sourceLabel: string): string[] {
  const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`${sourceLabel} has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('tool-card WebBlock is exempt from the assistant prose measure', () => {
  it('ToolRow.module.css resets the prose-measure token on .webBody, the WebBlock wrapper class', () => {
    const path = fileURLToPath(new URL('../src/client/tool/components/ToolRow.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(declarations(css, '.webBody', 'ToolRow.module.css')).toEqual(
      expect.arrayContaining(['--dsh-chat-prose-measure: none']),
    )
  })

  it('ToolDetails.module.css resets the prose-measure token on .web, the WebBlock wrapper class', () => {
    const path = fileURLToPath(new URL('../src/client/tool/ToolDetails.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(declarations(css, '.web', 'ToolDetails.module.css')).toEqual(
      expect.arrayContaining(['--dsh-chat-prose-measure: none']),
    )
  })
})
