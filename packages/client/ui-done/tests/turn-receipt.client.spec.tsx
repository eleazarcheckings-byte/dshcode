// @vitest-environment jsdom
/**
 * Turn receipt: the join of "what changed" with "how it was proven".
 *
 * The first block owns the doctrine — the pure join and the NOT_ASSESSED rule:
 * only a `proven` status that carries evidence is green, and every other state
 * (capability absent, no contract, stated only, or a proof claiming status
 * without evidence) is NOT_ASSESSED. The second block renders the disclosure
 * row. The third proves the fold the surface demanded: one card in the composer
 * dock holding the contract row and this receipt, not a fourth card.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { DoneProjection } from '@saturnai/dsh-done/client'
import { DefinitionOfDone } from '../src/client/DefinitionOfDone.tsx'
import { TurnReceipt } from '../src/client/TurnReceipt.tsx'
import { en, zh } from '../src/client/locales.ts'
import { turnReceipt } from '../src/client/turn-receipt.ts'
import type { ReceiptTimeline, ReceiptTurnData, TurnReceiptValue } from '../src/client/turn-receipt.ts'

afterEach(cleanup)

const t: Parameters<typeof TurnReceipt>[0]['t'] = makeTranslate(en, commonEn)

/** A timeline whose turns each publish the given produced paths (null = no published value). */
function makeTimeline(turns: readonly (readonly string[] | null)[]): ReceiptTimeline {
  const data = new Map<number, { data: ReceiptTurnData }>()
  turns.forEach((paths, index) => {
    data.set(index + 1, {
      data: paths === null
        ? { get: () => undefined }
        : {
          get: (key: 'deliverables') => (key === 'deliverables'
            ? { produced: paths.map(path => ({ path })) }
            : undefined),
        },
    })
  })
  return { turnOrder: turns.map((_, index) => index + 1), turns: data }
}

/** A stated contract; override per case. */
function makeDone(over: Partial<DoneProjection & object> = {}): DoneProjection {
  return { statement: 'Ship the turn receipt', status: 'stated', at: 1, ...over }
}

/** The receipt of one turn that wrote `src/a.ts`, unproven unless overridden. */
function makeReceipt(over: Partial<TurnReceiptValue> = {}): TurnReceiptValue {
  return {
    turn: 3,
    changes: { kind: 'recorded', paths: ['src/a.ts'] },
    verdict: { kind: 'not-assessed' },
    ...over,
  }
}

/** The panel the header's aria-controls points at. */
function panelOf(header: HTMLElement): HTMLElement {
  const panel = document.getElementById(header.getAttribute('aria-controls') ?? '')
  if (panel === null) throw new Error('the disclosure header points at no panel')
  return panel
}

describe('turnReceipt', () => {
  it('joins the latest turn\'s published paths with the contract\'s evidence', () => {
    const timeline = makeTimeline([['src/old.ts'], ['src/a.ts', 'src/b.ts', 'src/a.ts']])
    expect(turnReceipt({ timeline, done: makeDone({ status: 'proven', evidence: 'grader 15/15' }) }))
      .toEqual({
        turn: 2,
        changes: { kind: 'recorded', paths: ['src/a.ts', 'src/b.ts'] },
        verdict: { kind: 'proven', evidence: 'grader 15/15' },
      })
  })

  it('trims the evidence it reports', () => {
    const receipt = turnReceipt({
      timeline: makeTimeline([['src/a.ts']]),
      done: makeDone({ status: 'proven', evidence: '  vitest 12 passed  ' }),
    })
    expect(receipt.verdict).toEqual({ kind: 'proven', evidence: 'vitest 12 passed' })
  })

  it('reports a turn that wrote no files as no files, not as an absence', () => {
    const receipt = turnReceipt({ timeline: makeTimeline([[]]), done: makeDone() })
    expect(receipt.changes).toEqual({ kind: 'recorded', paths: [] })
  })

  it('reports no record when the turn published no produced-file value', () => {
    const receipt = turnReceipt({ timeline: makeTimeline([null]), done: makeDone() })
    expect(receipt.changes).toEqual({ kind: 'unavailable' })
  })

  it('reports no record and reads no turn data when the timeline exposes no turn', () => {
    const get = vi.fn(() => undefined)
    const timeline: ReceiptTimeline = { turnOrder: [], turns: new Map([[1, { data: { get } }]]) }
    expect(turnReceipt({ timeline, done: makeDone() })).toEqual({
      turn: undefined,
      changes: { kind: 'unavailable' },
      verdict: { kind: 'not-assessed' },
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('is NOT_ASSESSED with no contract at all (capability absent, or cleared)', () => {
    const timeline = makeTimeline([['src/a.ts']])
    expect(turnReceipt({ timeline, done: undefined }).verdict).toEqual({ kind: 'not-assessed' })
    expect(turnReceipt({ timeline, done: null }).verdict).toEqual({ kind: 'not-assessed' })
  })

  it('is NOT_ASSESSED for a stated contract, even one carrying stray evidence text', () => {
    const timeline = makeTimeline([['src/a.ts']])
    expect(turnReceipt({ timeline, done: makeDone() }).verdict).toEqual({ kind: 'not-assessed' })
    expect(turnReceipt({ timeline, done: makeDone({ evidence: 'looks done' }) }).verdict)
      .toEqual({ kind: 'not-assessed' })
  })

  it('is NOT_ASSESSED when a proven status carries no evidence — a claim is not proof', () => {
    const timeline = makeTimeline([['src/a.ts']])
    expect(turnReceipt({ timeline, done: makeDone({ status: 'proven' }) }).verdict)
      .toEqual({ kind: 'not-assessed' })
    expect(turnReceipt({ timeline, done: makeDone({ status: 'proven', evidence: '   ' }) }).verdict)
      .toEqual({ kind: 'not-assessed' })
  })
})

describe('TurnReceipt', () => {
  it('collapsed by default: the row carries the summary and the verdict word', () => {
    render(<TurnReceipt receipt={makeReceipt()} t={t} />)
    const header = screen.getByRole('button')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.textContent).toContain('Turn receipt')
    expect(header.textContent).toContain('1 file changed')
    // The doctrine word itself, never colour alone.
    expect(screen.getByText('NOT_ASSESSED').getAttribute('data-verdict')).toBe('not-assessed')
    expect(panelOf(header).hidden).toBe(true)
  })

  it('expands to the changed paths, the turn, and the absent evidence line', () => {
    const { container } = render(
      <TurnReceipt receipt={makeReceipt({ changes: { kind: 'recorded', paths: ['src/a.ts', 'src/b.ts'] } })} t={t} />,
    )
    expect(container.querySelector('[data-turn-receipt]')?.getAttribute('data-changes')).toBe('recorded')
    const header = screen.getByRole('button')

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(panelOf(header).hidden).toBe(false)
    expect(screen.getByText('Changed')).toBeTruthy()
    expect(screen.getByText('Evidence')).toBeTruthy()
    expect(screen.getByText('turn 3')).toBeTruthy()
    expect(screen.getByText('src/a.ts').getAttribute('title')).toBe('src/a.ts')
    expect(screen.getByText('src/b.ts')).toBeTruthy()
    expect(screen.getByText(en['receipt.evidence.absent']).getAttribute('data-evidence')).toBe('absent')

    // The same control closes it: only the reader's own toggle moves the card.
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(panelOf(header).hidden).toBe(true)
  })

  it('shows the evidence that met the contract once proven', () => {
    render(
      <TurnReceipt
        receipt={makeReceipt({ verdict: { kind: 'proven', evidence: 'vitest 12 passed' } })}
        t={t}
      />,
    )
    expect(screen.getByText('Proven').getAttribute('data-verdict')).toBe('proven')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('vitest 12 passed').getAttribute('data-evidence')).toBe('recorded')
  })

  it('states the absence of a record instead of implying the turn changed nothing', () => {
    const { container } = render(
      <TurnReceipt receipt={makeReceipt({ turn: undefined, changes: { kind: 'unavailable' } })} t={t} />,
    )
    expect(container.querySelector('[data-turn-receipt]')?.getAttribute('data-changes')).toBe('unavailable')
    expect(screen.getByRole('button').textContent).toContain('no record')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(en['receipt.changes.unavailable'])).toBeTruthy()
    // No turn to name: the label is omitted rather than rendered empty.
    expect(screen.queryByText(/^turn /)).toBeNull()
  })

  it('states a turn that wrote no files', () => {
    render(<TurnReceipt receipt={makeReceipt({ changes: { kind: 'recorded', paths: [] } })} t={t} />)
    expect(screen.getByRole('button').textContent).toContain('no files changed')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(en['receipt.changes.empty'])).toBeTruthy()
  })

  it('names the verdict in words in every dictionary, NOT_ASSESSED included', () => {
    expect(en['receipt.verdict.notAssessed']).toBe('NOT_ASSESSED')
    expect(en['receipt.verdict.proven']).toBe('Proven')
    // The doctrine token survives translation instead of being paraphrased away.
    expect(zh['receipt.evidence.absent']).toContain('NOT_ASSESSED')
  })
})

describe('the receipt folded into the definition-of-done card', () => {
  /** Render the dock strip over one projection and one chat timeline. */
  function renderStrip(projection: DoneProjection, timeline: ReceiptTimeline | undefined) {
    const bound = { views: { get: (target: string) => (target === 'chat' && timeline !== undefined ? { timeline } : undefined) } }
    const props = {
      useProjection: () => projection,
      useConversation: (select: (value: typeof bound) => unknown) => select(bound),
      setStatement: vi.fn(async () => null),
      prove: vi.fn(async () => null),
      clear: vi.fn(async () => null),
      t,
    } as unknown as Parameters<typeof DefinitionOfDone>[0]
    render(<DefinitionOfDone {...props} />)
    const bar = screen.getByRole('group', { name: 'Definition of done' })
    const receipt = document.querySelector('[data-turn-receipt]')
    return { bar, receipt }
  }

  it('is one card: the contract row and the receipt, not a fourth card', () => {
    const { bar, receipt } = renderStrip(
      makeDone({ status: 'proven', evidence: 'grader 15/15' }),
      makeTimeline([['src/a.ts']]),
    )
    expect(receipt).not.toBeNull()
    // The receipt is a sibling row inside the row's own card, so both halves are
    // one surface and only the section hairline separates them.
    expect(bar.parentElement?.contains(receipt)).toBe(true)
    expect(document.querySelectorAll('[data-turn-receipt]')).toHaveLength(1)
  })

  it('joins the contract\'s verdict with the timeline\'s changed paths', () => {
    renderStrip(
      makeDone({ status: 'proven', evidence: 'grader 15/15' }),
      makeTimeline([['src/a.ts', 'src/b.ts']]),
    )
    // Both halves report the same verdict, and the receipt counts the turn.
    expect(screen.getAllByText('Proven')).toHaveLength(2)
    expect(screen.getByText('2 files changed')).toBeTruthy()
  })

  it('keeps a stated contract NOT_ASSESSED in the receipt', () => {
    renderStrip(makeDone(), makeTimeline([['src/a.ts']]))
    expect(screen.getByText('Stated')).toBeTruthy()
    expect(screen.getByText('NOT_ASSESSED')).toBeTruthy()
    expect(screen.queryByText('Proven')).toBeNull()
  })

  it('says so when the binding exposes no chat timeline rather than implying no change', () => {
    renderStrip(makeDone(), undefined)
    expect(screen.getByText('no record')).toBeTruthy()
    expect(screen.queryByText('1 file changed')).toBeNull()
  })
})
