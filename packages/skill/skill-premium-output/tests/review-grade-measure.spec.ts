/**
 * Regression test for Mars r2 finding 1 on C9 (visual review loop): the "measure" probe named
 * in SPEC §3 C9 was deferred, not shipped. This round implements it split across both scripts —
 * `review-web.mjs` measures rendered characters-per-line with a real browser (see
 * `review-web.spec.ts` for that half); `review-grade.mjs` only *consumes* the value from a
 * supplied `--report` (a review-web.mjs report.json) and must never guess it — `UNVERIFIED`,
 * not a guessed `PASS`, when no report (or no desktop-view measurement) is supplied.
 *
 * New file — does not edit the existing committed `review-grade.spec.ts`.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = resolve(import.meta.dirname, '../skills/premium-web-experience/scripts/review-grade.mjs')
const fixtures = resolve(import.meta.dirname, 'fixtures')

interface MeasureField {
  verdict: 'PASS' | 'REVISE' | 'REJECT' | 'UNVERIFIED'
  measure_ch: number | null
  evidence: string
}
interface Rubric {
  overallVerdict: 'PASS' | 'REVISE' | 'REJECT'
  items: { criterion: string }[]
  measure: MeasureField
}
interface Helper {
  gradePage(html: string, options?: { source?: string; measure?: { measure_ch: number; pass: boolean } }): Promise<Rubric>
}

const helper = await import(pathToFileURL(script).href) as Helper

describe('review-grade: rendered character measure (consumed from review-web.mjs, never guessed)', () => {
  it('is UNVERIFIED with a null measure_ch when no measurement is supplied', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html, { source: 'tests/fixtures/premium.html' })
    expect(rubric.measure.verdict).toBe('UNVERIFIED')
    expect(rubric.measure.measure_ch).toBeNull()
    expect(rubric.measure.evidence).toMatch(/review-web\.mjs/)
  })

  it('passes through a within-budget measurement as PASS', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html, { measure: { measure_ch: 62, pass: true } })
    expect(rubric.measure.verdict).toBe('PASS')
    expect(rubric.measure.measure_ch).toBe(62)
  })

  it('flags an over-budget measurement as REVISE (not a hard REJECT)', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html, { measure: { measure_ch: 96, pass: false } })
    expect(rubric.measure.verdict).toBe('REVISE')
    expect(rubric.measure.evidence).toContain('96')
  })

  it('never lets the measure signal gate overallVerdict or the fixed 12-item checklist', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html, { measure: { measure_ch: 200, pass: false } })
    expect(rubric.overallVerdict).toBe('PASS')
    expect(rubric.items).toHaveLength(12)
  })
})

describe('review-grade: CLI --report consumption', () => {
  const cleanup: (() => Promise<unknown>)[] = []
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(dispose => dispose())) })
  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'review-grade-measure-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    return dir
  }

  it('reads the desktop view measurement out of a review-web.mjs report.json fixture', async () => {
    const out = await tempDir()
    const reportPath = join(out, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      version: 1,
      status: 'checks-complete',
      target: 'http://127.0.0.1/',
      visualQualityAssessed: false,
      views: [
        { name: 'desktop', measure: { measure_ch: 58, pass: true, linesSampled: 20 } },
        { name: 'mobile', measure: { measure_ch: 34, pass: true, linesSampled: 20 } },
      ],
    }))
    const { stdout } = await execFileAsync(process.execPath, [script, '--html', join(fixtures, 'premium.html'), '--out', out, '--report', reportPath])
    const printed = JSON.parse(stdout) as { rubric: string }
    const rubric = JSON.parse(await readFile(printed.rubric, 'utf8')) as Rubric
    expect(rubric.measure.verdict).toBe('PASS')
    expect(rubric.measure.measure_ch).toBe(58)
  })

  it('stays UNVERIFIED when the supplied report has no desktop measurement (e.g. an unavailable browser run)', async () => {
    const out = await tempDir()
    const reportPath = join(out, 'report.json')
    await writeFile(reportPath, JSON.stringify({ version: 1, status: 'unavailable', views: [] }))
    const { stdout } = await execFileAsync(process.execPath, [script, '--html', join(fixtures, 'premium.html'), '--out', out, '--report', reportPath])
    const printed = JSON.parse(stdout) as { rubric: string }
    const rubric = JSON.parse(await readFile(printed.rubric, 'utf8')) as Rubric
    expect(rubric.measure.verdict).toBe('UNVERIFIED')
  })

  it('exits 2 without writing anything when --report points at unreadable/invalid JSON', async () => {
    const out = await tempDir()
    const missingReport = join(out, 'does-not-exist.json')
    await expect(execFileAsync(process.execPath, [script, '--html', join(fixtures, 'premium.html'), '--out', out, '--report', missingReport]))
      .rejects.toMatchObject({ code: 2 })
  })
})
