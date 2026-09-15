/**
 * Mars fix-round (2026-09-15, transcript-polish C2): SPEC §2 binds a
 * reduced-motion contract in CSS everywhere; the `dsh-tool-duration-in`
 * entrance animation this cell added to `.duration` in both `ToolRow.
 * module.css` and `bash-sample.module.css` shipped with no
 * `prefers-reduced-motion` guard, unlike every sibling package (`grep -rn
 * prefers-reduced-motion packages/client/ui-tool` returned nothing). This
 * pins the guard so it cannot regress.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Half-open source span of one at-rule's block, excluding its prelude. Local
 * copy of the `ui-theme/tests/stylesheet-scan.ts` helper (out of this cell's
 * IN scope to import across packages) — kept minimal on purpose.
 */
function atRuleBlock(css: string, prelude: string): { start: number; end: number } | undefined {
  const opening = css.indexOf(`${prelude} {`)
  if (opening === -1) return undefined
  const start = css.indexOf('{', opening)
  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return { start, end: index }
    }
  }
  throw new Error(`unbalanced braces after ${prelude}`)
}

function reducedMotionGuardsDuration(css: string): boolean {
  const block = atRuleBlock(css, '@media (prefers-reduced-motion: reduce)')
  if (block === undefined) return false
  const body = css.slice(block.start, block.end + 1)
  const declarationText = body.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return /\.duration\s*\{[^{}]*animation:\s*none/.test(declarationText)
}

describe('tool-row duration entrance animation honors prefers-reduced-motion', () => {
  it('ToolRow.module.css turns off .duration\'s entrance animation under reduced motion', () => {
    const path = fileURLToPath(new URL('../src/client/tool/components/ToolRow.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(reducedMotionGuardsDuration(css)).toBe(true)
  })

  it('bash-sample.module.css turns off .duration\'s entrance animation under reduced motion', () => {
    const path = fileURLToPath(new URL('../src/client/tool/toolviews/bash-sample.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(reducedMotionGuardsDuration(css)).toBe(true)
  })
})
