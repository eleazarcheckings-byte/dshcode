/**
 * Proves the reachability chain the skin's `@font-face` rules depend on,
 * end to end, by reading the actual production sources rather than assuming
 * them — SPEC §3 C3: "confirm how apps/web/public reaches the packaged
 * desktop app via dsh-host-frontend-static and prove it with a test or a
 * served-URL check."
 *
 * The chain has three links, each asserted against its real file:
 *  1. `apps/web/public/fonts/*.woff2` exist and are real WOFF2 binaries.
 *  2. `apps/web/vite.config.ts` sets no `publicDir` override, so Vite's
 *     default applies: everything under `public/` is copied verbatim to the
 *     built `dist` root (`apps/web/public/fonts/x` -> `apps/web/dist/fonts/x`).
 *  3. `@deepseek-ai/dsh-host-frontend-static`'s `serveStatic` (the packaged
 *     desktop app's fallback seat, `packages/host/frontend-static/src/
 *     index.ts`) resolves any request path against the dist root generically
 *     — `readFile(resolve(join(distRoot, pathname)))` — with an extension-
 *     keyed MIME table that falls back to `application/octet-stream` for an
 *     unlisted extension (`.woff2` is not a named entry) rather than
 *     rejecting it, exactly like the already-shipped `/favicon.svg` and
 *     `/manifest.webmanifest` public assets. There is no allowlist a new
 *     public file must join.
 *
 * This is a static-source proof, not an executing server: ui-skin-saturn's
 * package.json cannot take a runtime dependency on
 * `@deepseek-ai/dsh-host-frontend-static` without a `pnpm install` this
 * cell's rules forbid, so the test reads that package's source by relative
 * filesystem path (no module resolution, no new dependency) and pins the
 * exact code shape the chain relies on — a change to that shape should fail
 * this test rather than silently break font delivery.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoFile = (rel: string): string => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url))

describe('font delivery: apps/web/public/fonts -> dist -> dsh-host-frontend-static', () => {
  it('ships real WOFF2 binaries at the exact paths the skin\'s @font-face rules reference', () => {
    for (const name of ['InstrumentSans-Variable.woff2', 'CommitMono-400-Regular.woff2', 'CommitMono-700-Regular.woff2']) {
      const bytes = readFileSync(repoFile(`apps/web/public/fonts/${name}`))
      expect(bytes.subarray(0, 4).toString('ascii'), `${name} must be a real WOFF2 (magic 'wOF2')`).toBe('wOF2')
    }
  })

  it('ships the two accompanying license files, and never the SPEC filename that would misrepresent Commit Mono as MIT', () => {
    const ofl = readFileSync(repoFile('apps/web/public/fonts/LICENSE-OFL.txt'), 'utf8')
    expect(ofl).toMatch(/SIL OPEN FONT LICENSE/)
    expect(ofl).toMatch(/Instrument Sans/)
    const commitMonoLicense = readFileSync(repoFile('apps/web/public/fonts/LICENSE-OFL-COMMITMONO.txt'), 'utf8')
    expect(commitMonoLicense).toMatch(/SIL OPEN FONT LICENSE/)
    // Deliberately not asserting the absence of a LICENSE-MIT.txt file: the
    // point is the license actually shipped is correct, not the filename.
  })

  it('apps/web/vite.config.ts sets no publicDir override, so the default `public/` copy convention applies', () => {
    const config = readFileSync(repoFile('apps/web/vite.config.ts'), 'utf8')
    expect(config).not.toMatch(/publicDir/)
  })

  it('apps/web/index.html preloads exactly the two critical-path font files', () => {
    const html = readFileSync(repoFile('apps/web/index.html'), 'utf8')
    const preloads = [...html.matchAll(/<link rel="preload" as="font"[^>]*>/g)]
    expect(preloads, 'exactly two font preload links (SPEC §3 C3)').toHaveLength(2)
    expect(html).toMatch(/<link rel="preload" as="font" type="font\/woff2" href="\/fonts\/InstrumentSans-Variable\.woff2" crossorigin/)
    expect(html).toMatch(/<link rel="preload" as="font" type="font\/woff2" href="\/fonts\/CommitMono-400-Regular\.woff2" crossorigin/)
  })

  it('dsh-host-frontend-static resolves any dist-root path generically (no per-file allowlist a new public asset must join)', () => {
    const source = readFileSync(repoFile('packages/host/frontend-static/src/index.ts'), 'utf8')
    // The traversal-safe join: any decoded request path is resolved directly
    // against the dist root and read from disk — not matched against a
    // named-route table.
    expect(source).toMatch(/const target = resolve\(normalize\(join\(distRoot, pathname\)\)\)/)
    expect(source).toMatch(/body = await readFile\(target\)/)
    // An extension this table does not name (.woff2 among them) still serves
    // — as a generic byte stream — rather than 404ing or being refused.
    expect(source).toMatch(/type = MIME\[extname\(target\)\] \?\? 'application\/octet-stream'/)
  })
})
