// @vitest-environment jsdom
/**
 * Provenance and the verdict card: what a PROVEN contract actually stands on.
 *
 * "Proven" stopped being a word the model may write about itself, so the chip
 * stops rendering it as one. Every proven contract names its provenance in the
 * bar — the tool call that ran, or the independent countersign — and a
 * countersigned contract carries the reviewer's whole rubric behind the click:
 * the stamped verdict, the reviewer, and one scored line per criterion with the
 * evidence that earned it.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { DoneProjection, DoneProof, ReviewScore } from '@saturnai/dsh-done/client'
import { DefinitionOfDone } from '../src/client/DefinitionOfDone.tsx'
import { VerdictCard } from '../src/client/VerdictCard.tsx'
import { provenance } from '../src/client/provenance.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: Parameters<typeof VerdictCard>[0]['t'] = makeTranslate(en, commonEn)

/** The six graded criteria, as a reviewer returns them. */
const SCORES: ReviewScore[] = [
  { criterion: 'factual_accuracy', score: 5, evidence: 'every claim maps to a logged command' },
  { criterion: 'completeness', score: 4, evidence: 'the refusal paths are covered' },
  { criterion: 'format_compliance', score: 5, evidence: 'matches the rubric shape' },
  { criterion: 'internal_consistency', score: 5, evidence: 'summary agrees with the scores' },
  { criterion: 'edge_case_handling', score: 3, evidence: 'the errored-receipt path is thin' },
  { criterion: 'source_quality', score: 4, evidence: 'cites the session log' },
]

const COUNTERSIGN: DoneProof = {
  kind: 'countersign',
  token: 'saturn-countersign:9f1c2f6a-0f3a-4a1e-9a0f-2d3c4b5a6e7f',
  reviewer: 'Mars — adversarial reviewer (spawn)',
  verdict: 'PASS',
  scores: SCORES,
  summary: 'The contract is met and the evidence is real.',
}

const RECEIPT: DoneProof = { kind: 'receipt', toolCallId: 'r1', toolName: 'run_tests' }

/** A proven contract carrying the given provenance. */
function makeDone(proof: DoneProof): DoneProjection {
  return {
    statement: 'Proof-gated done ships with an independent reviewer.',
    status: 'proven',
    evidence: 'run_tests: 37 passed',
    proof,
    at: 7,
  }
}

/** Render the header chip over one projection, with no timeline and no checkpoints. */
function renderChip(projection: DoneProjection) {
  const bound = { views: { get: () => undefined } }
  const projections: Record<string, unknown> = { done: projection ?? undefined }
  const props = {
    useProjection: (name: string) => projections[name],
    useConversation: (select: (value: typeof bound) => unknown) => select(bound),
    setStatement: vi.fn(async () => null),
    prove: vi.fn(async () => null),
    clear: vi.fn(async () => null),
    restoreCheckpoint: vi.fn(async () => null),
    t,
  } as unknown as Parameters<typeof DefinitionOfDone>[0]
  render(<DefinitionOfDone {...props} />)
  const chip = document.querySelector('[data-done-bar]') as HTMLButtonElement | null
  if (chip === null) throw new Error('no chip rendered')
  return chip
}

/** Click the chip and hand back the record panel it opened. */
function openPanel(chip: HTMLButtonElement): HTMLElement {
  fireEvent.click(chip)
  const panel = document.querySelector('[data-done-panel]')
  if (panel === null) throw new Error('the chip opened no panel')
  return panel as HTMLElement
}

describe('provenance', () => {
  it('names the tool call a receipt stands on', () => {
    expect(provenance(RECEIPT, t)).toContain('run_tests')
  })

  it('names the countersign without pretending to be a run', () => {
    expect(provenance(COUNTERSIGN, t)).toBe(en['proof.countersign'])
  })

  it('says plainly when a human attested it', () => {
    expect(provenance({ kind: 'human' }, t)).toBe(en['proof.human'])
  })

  it('has nothing to say about a contract with no proof', () => {
    expect(provenance(undefined, t)).toBeNull()
  })
})

describe('the chip', () => {
  it('carries the provenance of a receipt beside the status', () => {
    const chip = renderChip(makeDone(RECEIPT))
    expect(chip.getAttribute('data-proof')).toBe('receipt')
    expect(chip.textContent).toContain('run_tests')
  })

  it('marks a countersigned contract as countersigned', () => {
    const chip = renderChip(makeDone(COUNTERSIGN))
    expect(chip.getAttribute('data-proof')).toBe('countersign')
  })
})

describe('the verdict card', () => {
  it('opens the reviewer rubric behind the chip', () => {
    const panel = openPanel(renderChip(makeDone(COUNTERSIGN)))
    const card = panel.querySelector('[data-verdict-card]')
    if (card === null) throw new Error('a countersigned contract rendered no verdict card')
    expect(card.getAttribute('data-verdict')).toBe('PASS')
    expect(within(card as HTMLElement).getByText('PASS')).toBeTruthy()
    expect(card.textContent).toContain('Mars — adversarial reviewer (spawn)')
    expect(card.textContent).toContain('The contract is met and the evidence is real.')
    for (const score of SCORES) {
      expect(card.textContent).toContain(en[`verdict.criterion.${score.criterion}`])
      expect(card.textContent).toContain(score.evidence)
    }
    expect(card.querySelectorAll('[data-criterion]')).toHaveLength(6)
  })

  it('renders each criterion with its score out of five', () => {
    render(<VerdictCard proof={COUNTERSIGN} t={t} />)
    const row = screen.getByText(en['verdict.criterion.edge_case_handling']).closest('[data-criterion]')
    if (row === null) throw new Error('no row for the criterion')
    expect(row.getAttribute('data-score')).toBe('3')
    expect(row.textContent).toContain('3/5')
  })

  it('renders no card for a receipt: there is no rubric to show', () => {
    const panel = openPanel(renderChip(makeDone(RECEIPT)))
    expect(panel.querySelector('[data-verdict-card]')).toBeNull()
  })
})

describe('the dictionaries', () => {
  it('translate every criterion label in both languages', () => {
    for (const score of SCORES) {
      const key = `verdict.criterion.${score.criterion}` as const
      expect(en[key].length).toBeGreaterThan(0)
      expect(zh[key].length).toBeGreaterThan(0)
    }
  })

  it('keep the verdict words as doctrine tokens rather than translating them', () => {
    expect(zh['verdict.title']).not.toContain('PASS')
    expect(en['proof.receipt']).toContain('{tool}')
  })
})
