/** Deterministic slop-tell probe: graded against two fixture pages, never a live browser. */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import schema from '../rubric.schema.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const script = resolve(import.meta.dirname, '../scripts/review-grade.mjs')
const fixtures = resolve(import.meta.dirname, 'fixtures')

interface RubricItem {
  criterion: string
  score: number | null
  evidence: string
  verdict: 'PASS' | 'REVISE' | 'REJECT' | 'UNVERIFIED'
}
interface Rubric {
  version: number
  source: string
  generatedAt: string
  engine: string
  overallVerdict: 'PASS' | 'REVISE' | 'REJECT'
  notes: string[]
  items: RubricItem[]
  findings: { tell: string; severity: string; evidence: string }[]
}
interface Helper {
  parseArgs(argv: string[]): { help: boolean; html?: string; out?: string; source?: string }
  gradePage(html: string, options?: { source?: string }): Promise<Rubric>
  GradeUnavailableError: typeof Error
}

const helper = await import(pathToFileURL(script).href) as Helper
const UNVERIFIABLE_CRITERIA = new Set(['Brand test', 'One named mechanism', 'Deviation log', 'Writer ≠ reviewer'])

function itemFor(rubric: Rubric, criterion: string): RubricItem {
  const item = rubric.items.find(candidate => candidate.criterion === criterion)
  if (!item) throw new Error(`Rubric is missing criterion: ${criterion}`)
  return item
}

/** Minimal shape check against rubric.schema.json's own criterion enum and item contract, without pulling in a JSON Schema engine. */
function assertMatchesSchema(rubric: Rubric): void {
  const allowedCriteria = new Set(schema.definitions.criterion.enum as string[])
  const allowedVerdicts = new Set(schema.definitions.verdict.enum as string[])
  expect(rubric.version).toBe(1)
  expect(rubric.items).toHaveLength(12)
  expect(rubric.items.map(item => item.criterion)).toEqual(schema.definitions.criterion.enum)
  for (const item of rubric.items) {
    expect(allowedCriteria.has(item.criterion)).toBe(true)
    expect(allowedVerdicts.has(item.verdict)).toBe(true)
    expect(typeof item.evidence).toBe('string')
    expect(item.evidence.length).toBeGreaterThan(0)
    if (item.verdict === 'UNVERIFIED') expect(item.score).toBeNull()
    else expect(item.score).toBeGreaterThanOrEqual(1)
  }
}

describe('review-grade: parseArgs', () => {
  it('requires --html and --out', () => {
    expect(() => helper.parseArgs([])).toThrow('--html is required')
    expect(() => helper.parseArgs(['--html', 'x.html'])).toThrow('--out is required')
  })

  it('accepts --help alone', () => {
    expect(helper.parseArgs(['--help'])).toEqual({ help: true })
  })

  it('rejects an unknown flag', () => {
    expect(() => helper.parseArgs(['--url', 'x'])).toThrow('Unknown argument')
  })

  it('resolves html/out/source to absolute-ish values', () => {
    const options = helper.parseArgs(['--html', 'page.html', '--out', 'artifacts', '--source', 'label'])
    expect(options.help).toBe(false)
    expect(options.source).toBe('label')
    expect(options.html?.endsWith('page.html')).toBe(true)
  })
})

describe('review-grade: gradePage', () => {
  it('passes the premium fixture on every mechanically-scored criterion', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html, { source: 'tests/fixtures/premium.html' })
    assertMatchesSchema(rubric)
    expect(rubric.overallVerdict).toBe('PASS')
    for (const item of rubric.items) {
      if (UNVERIFIABLE_CRITERIA.has(item.criterion)) expect(item.verdict).toBe('UNVERIFIED')
      else expect(item.verdict, `${item.criterion}: ${item.evidence}`).toBe('PASS')
    }
  })

  it('rejects the slop fixture and names the specific tells', async () => {
    const html = await readFile(join(fixtures, 'slop.html'), 'utf8')
    const rubric = await helper.gradePage(html, { source: 'tests/fixtures/slop.html' })
    assertMatchesSchema(rubric)
    expect(rubric.overallVerdict).toBe('REJECT')

    const slop = itemFor(rubric, 'ai-slop scan')
    expect(slop.verdict).toBe('REJECT')
    expect(slop.evidence).toMatch(/purple\/indigo gradient/)
    expect(slop.evidence).toMatch(/banned font-family literal: Inter/)
    expect(slop.evidence).toMatch(/named "sparkle"/)
    expect(slop.evidence).toMatch(/identical-signature sibling cards/)
    expect(slop.evidence).toMatch(/blanket fade-up/)

    expect(itemFor(rubric, 'homogenized-premium scan').verdict).toBe('REJECT')
    expect(itemFor(rubric, 'homogenized-premium scan').evidence).toMatch(/serif/)

    expect(itemFor(rubric, 'Motion budget respected').verdict).toBe('REJECT')
    expect(itemFor(rubric, 'Ambient canvas quality bar').verdict).toBe('REJECT')
    expect(itemFor(rubric, 'Ambient canvas quality bar').evidence).toMatch(/purposeless/)

    const contrast = itemFor(rubric, 'Contrast measured')
    expect(contrast.verdict).toBe('REJECT')
    expect(contrast.evidence).toMatch(/needs 4.5:1/)

    const ctas = itemFor(rubric, 'One primary CTA per section; real routes')
    expect(ctas.verdict).toBe('REJECT')
    expect(ctas.evidence).toMatch(/dead link/)

    expect(itemFor(rubric, 'Reduced-motion state designed').verdict).toBe('REJECT')
  })

  it('never scores the four judgment criteria — always UNVERIFIED with a null score, on either fixture', async () => {
    for (const fixture of ['premium.html', 'slop.html']) {
      const html = await readFile(join(fixtures, fixture), 'utf8')
      const rubric = await helper.gradePage(html, { source: fixture })
      for (const criterion of UNVERIFIABLE_CRITERIA) {
        const item = itemFor(rubric, criterion)
        expect(item.verdict).toBe('UNVERIFIED')
        expect(item.score).toBeNull()
      }
    }
  })

  it('treats a CSS scroll-driven reveal (animation-timeline) as technique, not a blanket-fade-up tell', async () => {
    const html = await readFile(join(fixtures, 'premium.html'), 'utf8')
    const rubric = await helper.gradePage(html)
    expect(itemFor(rubric, 'ai-slop scan').evidence).not.toMatch(/blanket fade-up/)
    expect(itemFor(rubric, 'Motion budget respected').verdict).toBe('PASS')
  })
})

describe('review-grade: CLI', () => {
  const cleanup: (() => Promise<unknown>)[] = []
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(dispose => dispose())) })

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'review-grade-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    return dir
  }

  it('exits 0 and writes rubric.json + rubric.md for the premium fixture', async () => {
    const out = await tempDir()
    const { stdout } = await execFileAsync(process.execPath, [script, '--html', join(fixtures, 'premium.html'), '--out', out])
    const printed = JSON.parse(stdout)
    expect(printed.overallVerdict).toBe('PASS')
    const rubric = JSON.parse(await readFile(printed.rubric, 'utf8')) as Rubric
    assertMatchesSchema(rubric)
    expect(rubric.source).toContain('premium.html')
    const summary = await readFile(printed.summary, 'utf8')
    expect(summary).toContain('Overall: **PASS**')
  })

  it('exits 1 for the slop fixture', async () => {
    const out = await tempDir()
    await expect(execFileAsync(process.execPath, [script, '--html', join(fixtures, 'slop.html'), '--out', out]))
      .rejects.toMatchObject({ code: 1 })
  })

  it('exits 2 on invalid arguments without writing anything', async () => {
    await expect(execFileAsync(process.execPath, [script, '--out', 'x']))
      .rejects.toMatchObject({ code: 2 })
  })
})
