/**
 * Prose-measure contract for assistant markdown, read as CSS text (jsdom has
 * no layout, so this cannot measure characters-per-line directly — the
 * ConversationRoot.module.css counterpart declares the token value itself;
 * this only pins that MarkdownText.module.css consumes it on the textual-flow
 * elements, not on `.markdown` itself, so code fences and tables stay at the
 * full transcript width). 2026-09-15 transcript-polish, recon/desktop-ux-audit.md R1.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/markdown/MarkdownText.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`MarkdownText.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('MarkdownText.module.css prose measure', () => {
  it('caps paragraphs, list items, quotes, and headings at the shared token', () => {
    expect(declarations('.markdown :where(p, li, blockquote, h1, h2, h3, h4, h5, h6)')).toEqual(
      expect.arrayContaining(['max-width: var(--dsh-chat-prose-measure, 70ch)']),
    )
  })

  it('never caps the .markdown container itself', () => {
    // A block child cannot render wider than its parent: capping the
    // container (instead of the textual elements inside it) would squeeze
    // code fences and tables down with it, contradicting the "code, tables,
    // tool cards exempt" requirement.
    expect(declarations('.markdown')).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^max-width:/),
    ]))
  })
})
