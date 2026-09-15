/**
 * Regression test for Mars r2 finding 2 on C9 (visual review loop): README.md:88 and
 * README.zh.md:95's Dev Note prose named `scripts/review-grade.mjs` — a bare code span,
 * not a markdown link, so `verify-md-links` never checks it, and the existing
 * `skill-resource-paths.spec.ts` only pins SKILL.md's own resource references, not the
 * package-root README's prose. From the package root (where README.md/README.zh.md live)
 * there is no `scripts/` directory at all — the real path is
 * `skills/premium-web-experience/scripts/review-grade.mjs` (see `skill-resource-paths.spec.ts`).
 *
 * This is a new file, not an edit to the committed-RED `skill-resource-paths.spec.ts`
 * (SPEC/rule: never edit an existing RED test file).
 *
 * General check, generalized past the single instance Mars found: any occurrence of
 * `review-grade.mjs` or `review-web.mjs` in either README that is written as part of a
 * path (i.e. has a `/`-joined prefix immediately before the filename, no whitespace or
 * backtick in between) must resolve to a real file relative to the package root. A bare
 * mention of the filename alone (no path prefix) is just naming the script and is not
 * checked — only a claimed *location* is.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkgRoot = resolve(import.meta.dirname, '..')

/** Matches a contiguous path-like run of characters ending in one of the named
 * package scripts, capturing the (possibly empty) path prefix separately so a bare
 * `review-grade.mjs` mention (no prefix) can be told apart from an asserted path. */
const PATH_CLAIM_RE = /([\w./-]*)(review-(?:grade|web)\.mjs)/g

function pathClaims(text: string): string[] {
  const claims: string[] = []
  for (const match of text.matchAll(PATH_CLAIM_RE)) {
    const [, prefix, filename] = match
    if (prefix === undefined || filename === undefined) continue
    if (prefix.includes('/')) claims.push(`${prefix}${filename}`)
  }
  return claims
}

describe('README prose never claims a stale package-root script path', () => {
  it('every path-shaped mention of review-grade.mjs / review-web.mjs in README.md resolves on disk', async () => {
    const readme = await readFile(resolve(pkgRoot, 'README.md'), 'utf8')
    const claims = pathClaims(readme)
    expect(claims.length).toBeGreaterThan(0) // sanity: the file does reference these scripts
    for (const claim of claims) {
      expect(existsSync(resolve(pkgRoot, claim)), `README.md claims a path that does not exist: ${claim}`).toBe(true)
    }
  })

  it('every path-shaped mention of review-grade.mjs / review-web.mjs in README.zh.md resolves on disk', async () => {
    const readme = await readFile(resolve(pkgRoot, 'README.zh.md'), 'utf8')
    const claims = pathClaims(readme)
    expect(claims.length).toBeGreaterThan(0)
    for (const claim of claims) {
      expect(existsSync(resolve(pkgRoot, claim)), `README.zh.md claims a path that does not exist: ${claim}`).toBe(true)
    }
  })

  it('the Dev Note decision-record paragraph names the in-base script path, not the stale package-root one', async () => {
    const readme = await readFile(resolve(pkgRoot, 'README.md'), 'utf8')
    const readmeZh = await readFile(resolve(pkgRoot, 'README.zh.md'), 'utf8')
    expect(readme).toContain('skills/premium-web-experience/scripts/review-grade.mjs')
    expect(readmeZh).toContain('skills/premium-web-experience/scripts/review-grade.mjs')
  })
})
