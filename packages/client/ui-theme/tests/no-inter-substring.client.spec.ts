/**
 * Mars fix-round (2026-09-15, transcript-polish C2): the SPEC §3 C2 ACCEPTANCE
 * line is a plain substring grep — `grep -rn "Inter" packages/client
 * --include=*.css` must be empty — but the sibling `no-inter-font` guard uses
 * `/\binter\b/i`, which requires a word boundary before "inter" and therefore
 * never catches "Inter" embedded inside a larger word such as
 * "Interrupted-turn" (AssistantMarkdown.module.css:52). This guard mirrors the
 * SPEC's own grep exactly: a case-insensitive substring search, no word
 * boundary, so a future comment or token that merely contains the four
 * letters I-n-t-e-r cannot slip back in unnoticed.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packageStylesheets } from './stylesheet-scan.ts'

describe('no "Inter" substring under packages/client (SPEC §3 C2 acceptance grep)', () => {
  it('never contains the four letters "Inter" anywhere in a client stylesheet, including inside comments', () => {
    const hits = packageStylesheets()
      .filter(file => file.replace(/\\/g, '/').includes('/packages/client/'))
      .flatMap((file) => {
        const css = readFileSync(file, 'utf8')
        return /inter/i.test(css) ? [file] : []
      })
    expect(hits).toEqual([])
  })
})
