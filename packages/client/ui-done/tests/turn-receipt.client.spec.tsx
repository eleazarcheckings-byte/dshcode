// @vitest-environment jsdom
/**
 * Turn receipt: the join of "what changed" with "how it was proven".
 *
 * The first block owns the doctrine — the pure join and the NOT_ASSESSED rule:
 * only a `proven` status that carries evidence is green, and every other state
 * (capability absent, no contract, stated only, or a proof claiming status
 * without evidence) is NOT_ASSESSED. The second block renders the disclosure
 * row. The third drives the header chip: one ellipsised line in the bar, the
 * whole record in the panel it opens, and the checkpoint half standing alone
 * when no contract is stated.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { CheckpointsProjection } from '@saturnai/dsh-checkpoints/client'
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

/** A session holding two checkpoints, the newest one opened by turn 4. */
const CHECKPOINTS: CheckpointsProjection = {
  count: 2,
  latest: { id: 'cp-2', createdAt: 1, reason: 'turn', turn: 4, files: 2 },
  entries: [{ id: 'cp-2', createdAt: 1, reason: 'turn', turn: 4, files: 2 }],
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

describe('the definition-of-done header chip and its record panel', () => {
  /** Render the header chip over one projection, one chat timeline, and one checkpoint count. */
  function renderChip(
    projection: DoneProjection | null,
    timeline: ReceiptTimeline | undefined,
    checkpoints?: CheckpointsProjection,
  ) {
    const bound = { views: { get: (target: string) => (target === 'chat' && timeline !== undefined ? { timeline } : undefined) } }
    const projections: Record<string, unknown> = { done: projection ?? undefined, checkpoints }
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
    return { chip, props }
  }

  /** Click the chip and hand back the record panel it opened. */
  function openPanel(chip: HTMLButtonElement): HTMLElement {
    fireEvent.click(chip)
    const panel = document.querySelector('[data-done-panel]')
    if (panel === null) throw new Error('the chip opened no panel')
    return panel as HTMLElement
  }

  it('renders nothing for a Session with neither a contract nor a checkpoint', () => {
    const { chip } = renderChip(null, undefined)
    expect(chip).toBeNull()
  })

  it('holds the contract on one line and opens the whole record on click', () => {
    const { chip } = renderChip(
      makeDone({ status: 'proven', evidence: 'grader 15/15' }),
      makeTimeline([['src/a.ts']]),
    )
    expect(chip?.textContent).toContain('Proven')
    expect(chip?.textContent).toContain('Ship the turn receipt')
    expect(chip?.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-done-panel]')).toBeNull()

    const panel = openPanel(chip as HTMLButtonElement)
    expect(chip?.getAttribute('aria-expanded')).toBe('true')
    // The header keeps the chip; the receipt and the statement live in the panel.
    expect(chip?.querySelector('[data-turn-receipt]')).toBeNull()
    expect(panel.querySelector('[data-turn-receipt]')).not.toBeNull()
    expect(panel.textContent).toContain('grader 15/15')
    expect(document.querySelectorAll('[data-turn-receipt]')).toHaveLength(1)
  })

  it('joins the contract\'s verdict with the timeline\'s changed paths', () => {
    const { chip } = renderChip(
      makeDone({ status: 'proven', evidence: 'grader 15/15' }),
      makeTimeline([['src/a.ts', 'src/b.ts']]),
    )
    const panel = openPanel(chip as HTMLButtonElement)
    // Both halves report the same verdict — the chip's own label is outside the
    // panel, so the record itself carries one pair.
    expect(within(panel).getAllByText('Proven')).toHaveLength(2)
    expect(screen.getByText('2 files changed')).toBeTruthy()
  })

  it('keeps a stated contract NOT_ASSESSED in the receipt', () => {
    const { chip } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    const panel = openPanel(chip as HTMLButtonElement)
    expect(within(panel).getByText('Stated')).toBeTruthy()
    expect(within(panel).getByText('NOT_ASSESSED')).toBeTruthy()
    expect(within(panel).queryByText('Proven')).toBeNull()
  })

  it('says so when the binding exposes no chat timeline rather than implying no change', () => {
    const { chip } = renderChip(makeDone(), undefined)
    openPanel(chip as HTMLButtonElement)
    expect(screen.getByText('no record')).toBeTruthy()
    expect(screen.queryByText('1 file changed')).toBeNull()
  })

  it('closes on Escape and hands focus back to the chip', () => {
    const { chip } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    const panel = openPanel(chip as HTMLButtonElement)
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.querySelector('[data-done-panel]')).toBeNull()
    expect(document.activeElement).toBe(chip)
  })

  it('leaves Escape to the editor while the editor is open', () => {
    const { chip } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    const panel = openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Amend definition of done'))
    fireEvent.keyDown(screen.getByLabelText('Definition of done statement'), { key: 'Escape' })
    // The editor closed and the panel stayed: the chip is still expanded.
    expect(document.querySelector('[data-done-panel]')).toBe(panel)
    expect(screen.queryByLabelText('Definition of done statement')).toBeNull()
  })

  it('closes when the pointer goes down outside the chip and the panel', () => {
    const { chip } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    openPanel(chip as HTMLButtonElement)
    fireEvent.pointerDown(document.body)
    expect(document.querySelector('[data-done-panel]')).toBeNull()
  })

  it('amends the statement through the injected verb', async () => {
    const { chip, props } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Amend definition of done'))
    const field = screen.getByLabelText('Definition of done statement') as HTMLInputElement
    expect(field.value).toBe('Ship the turn receipt')
    fireEvent.change(field, { target: { value: 'Ship the header chip' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.setStatement).toHaveBeenCalledWith('Ship the header chip')
    // The verb is asynchronous, so the editor closes on the resolved call.
    await vi.waitFor(() => {
      expect(screen.queryByLabelText('Definition of done statement')).toBeNull()
    })
  })

  it('records evidence through the prove verb', () => {
    const { chip, props } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Record evidence and mark proven'))
    const field = screen.getByLabelText('The one line of evidence that met it') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'ui-done 21/21' } })
    fireEvent.click(screen.getByLabelText('Save'))
    expect(props.prove).toHaveBeenCalledWith('ui-done 21/21')
  })

  it('cancels the editor without running a verb', () => {
    const { chip, props } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Amend definition of done'))
    fireEvent.click(screen.getByLabelText('Cancel'))
    expect(screen.queryByLabelText('Definition of done statement')).toBeNull()
    expect(props.setStatement).not.toHaveBeenCalled()
  })

  it('shows the failure line a rejected verb returns', async () => {
    const { chip, props } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    vi.mocked(props.prove).mockResolvedValueOnce('command failed (E_DONE)')
    openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Record evidence and mark proven'))
    const field = screen.getByLabelText('The one line of evidence that met it')
    fireEvent.change(field, { target: { value: 'nope' } })
    fireEvent.click(screen.getByLabelText('Save'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('command failed (E_DONE)')
  })

  it('clears the contract and closes the panel', async () => {
    const { chip, props } = renderChip(makeDone(), makeTimeline([['src/a.ts']]))
    openPanel(chip as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('Clear definition of done'))
    await vi.waitFor(() => {
      expect(props.clear).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(document.querySelector('[data-done-panel]')).toBeNull()
    })
  })

  it('stands on the checkpoint half alone when no contract is stated', () => {
    const { chip } = renderChip(null, undefined, CHECKPOINTS)
    expect(chip?.textContent).toContain('Checkpoints')
    expect(chip?.getAttribute('data-status')).toBe('none')
    const panel = openPanel(chip as HTMLButtonElement)
    expect(panel.getAttribute('data-status')).toBe('none')
    expect(panel.textContent).toContain('Checkpoints')
    // No contract half, so no receipt and no verbs.
    expect(panel.querySelector('[data-turn-receipt]')).toBeNull()
    expect(screen.queryByLabelText('Amend definition of done')).toBeNull()
  })
})
