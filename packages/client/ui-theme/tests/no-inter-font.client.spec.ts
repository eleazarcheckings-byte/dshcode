/**
 * The design law's own explicit "do not use Inter" rule, enforced as a
 * project-wide guard: a stray `font-family: Inter, ...` fallback is dead code
 * only because no `@font-face` for it ships anywhere today — it activates
 * silently the moment anyone bundles Inter for an unrelated reason.
 * 2026-09-15 transcript-polish, recon/desktop-ux-audit.md item 3 (confirmed
 * hit: QueueDock.module.css:87,145).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packageStylesheets } from './stylesheet-scan.ts'

describe('no Inter literal under packages/client', () => {
  it('never references the banned Inter typeface in any client stylesheet', () => {
    const hits = packageStylesheets()
      .filter(file => file.replace(/\\/g, '/').includes('/packages/client/'))
      .flatMap((file) => {
        const css = readFileSync(file, 'utf8')
        return /\binter\b/i.test(css) ? [file] : []
      })
    expect(hits).toEqual([])
  })
})
