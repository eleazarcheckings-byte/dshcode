/**
 * Pins the hero headline's consumption of the two Saturn type tokens this
 * package exposes (SPEC §3 C3 DELIVER: "`wdth` used as the display move for
 * the hero headline"; Mars round-2 F2). `HeroShell.module.css` lives in
 * `ui-conversation` (owned by C2, already landed), not this package's IN
 * scope — this cell was told to make exactly this one-rule edit there
 * (Mars round-2 required fix #2) and to pin it with a test using this
 * package's CSS-reading pattern (see `typeface-tokens.client.spec.ts`) rather
 * than editing further files outside scope. The test reads the real source
 * by relative filesystem path, the same no-new-dependency approach
 * `font-served-path.spec.ts` already uses for a cross-package proof.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoFile = (rel: string): string => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url))

describe('hero headline display move consumes the Saturn type tokens', () => {
  it('.headline in ui-conversation/HeroShell.module.css sets font-family and the wdth variation from --saturn-font-display(-variation)', () => {
    const css = readFileSync(repoFile('packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css'), 'utf8')
    const headlineRule = /\.headline\s*\{([^}]*)\}/.exec(css)
    expect(headlineRule, '.headline rule must exist').not.toBeNull()
    const body = headlineRule![1] as string
    expect(body).toMatch(/font-family:\s*var\(--saturn-font-display,\s*inherit\)/)
    expect(body).toMatch(/font-variation-settings:\s*var\(--saturn-font-display-variation,\s*'wdth' 100\)/)
  })
})
