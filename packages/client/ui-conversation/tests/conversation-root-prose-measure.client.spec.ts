/**
 * The prose-measure token itself, read as CSS text off ConversationRoot's
 * `.root` — the same width axis --dsh-chat-content-width lives on, kept
 * separate so MarkdownText.module.css can cap running prose without also
 * shrinking the outer column, the composer, or tool cards.
 * 2026-09-15 transcript-polish, recon/desktop-ux-audit.md R1.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`ConversationRoot.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('ConversationRoot.module.css prose measure token', () => {
  it('declares a 70ch prose measure alongside the existing content-width axis', () => {
    const root = declarations('.root')
    expect(root).toEqual(expect.arrayContaining(['--dsh-chat-prose-measure: 70ch']))
    // The existing width axis stays: the new token is additive, not a replacement.
    expect(root.some(line => line.startsWith('--dsh-chat-content-width:'))).toBe(true)
  })
})
