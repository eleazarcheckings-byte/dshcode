/**
 * Mars fix-round (2026-09-15, transcript-polish C2, round 3). SPEC §2 binds
 * "reduced-motion contract in CSS and JS everywhere". `ToolRow.module.css`'s
 * `.root[data-state='running'] .row::after` and `bash-sample.module.css`'s
 * `.root[data-state='running']::after` run the infinite `dsh-tool-row-sweep`
 * / `dsh-bash-row-sweep` glare animation (2.6s ease-out infinite) with no
 * `prefers-reduced-motion` guard — pre-existing, but inside C2's exclusive
 * write scope and six lines from the `.duration` guard block the prior round
 * added (`tool-duration-reduced-motion.client.spec.ts`). This pins the sweep
 * guard alongside it so both animations honor reduced motion.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Half-open source span of one at-rule's block, excluding its prelude. Local
 * copy of the `ui-theme/tests/stylesheet-scan.ts` helper (out of this cell's
 * IN scope to import across packages) — same copy as the sibling
 * `.duration` guard test, kept minimal on purpose.
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

function reducedMotionGuardsSweep(css: string, selector: string): boolean {
  const block = atRuleBlock(css, '@media (prefers-reduced-motion: reduce)')
  if (block === undefined) return false
  const body = css.slice(block.start, block.end + 1)
  const declarationText = body.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{[^{}]*animation:\\s*none`).test(declarationText)
}

describe('tool-row running-state sweep glare honors prefers-reduced-motion', () => {
  it("ToolRow.module.css turns off the row's sweep glare under reduced motion", () => {
    const path = fileURLToPath(new URL('../src/client/tool/components/ToolRow.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(reducedMotionGuardsSweep(css, ".root[data-state='running'] .row::after")).toBe(true)
  })

  it("bash-sample.module.css turns off the row's sweep glare under reduced motion", () => {
    const path = fileURLToPath(new URL('../src/client/tool/toolviews/bash-sample.module.css', import.meta.url))
    const css = readFileSync(path, 'utf8')
    expect(reducedMotionGuardsSweep(css, ".root[data-state='running']::after")).toBe(true)
  })
})
