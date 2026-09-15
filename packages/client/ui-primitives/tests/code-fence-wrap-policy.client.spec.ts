/**
 * Code-fence wrap policy: a coding tool must never wrap a long identifier or
 * a wide diff pasted into a markdown fence mid-token. `CodeBlock.module.css`
 * previously contradicted its own sibling primitives (TerminalBlock,
 * DiffBlock, ReadBlock, SearchBlock all already use `pre` + `overflow-x:
 * auto`) with `white-space: pre-wrap; word-break: break-all`.
 * 2026-09-15 transcript-polish, recon/desktop-ux-audit.md R2.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = fileURLToPath(new URL('../src/markdown/CodeBlock.module.css', import.meta.url))
const tsxPath = fileURLToPath(new URL('../src/markdown/CodeBlock.tsx', import.meta.url))
const css = readFileSync(cssPath, 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`CodeBlock.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('CodeBlock.module.css fence wrap policy', () => {
  it('scrolls long lines instead of wrapping them', () => {
    const pre = declarations('.block :where(pre)')
    expect(pre).toEqual(expect.arrayContaining(['white-space: pre', 'overflow-x: auto']))
  })

  it('never breaks mid-token', () => {
    const pre = declarations('.block :where(pre)')
    expect(pre.some(line => line.includes('break-all'))).toBe(false)
    expect(pre.some(line => line.startsWith('white-space:') && line.includes('pre-wrap'))).toBe(false)
  })

  it('carries no matching inline word-break override in the component', () => {
    const tsx = readFileSync(tsxPath, 'utf8')
    expect(tsx).not.toMatch(/word-?[Bb]reak/)
  })
})
