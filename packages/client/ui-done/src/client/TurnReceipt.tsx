/**
 * Turn receipt: the disclosure row folded into the definition-of-done strip.
 *
 * The strip already states the contract and how it stands; the receipt is that
 * doctrine made legible at the end of a turn — the paths this turn changed,
 * beside the evidence that met the contract, with NOT_ASSESSED stated outright
 * whenever there is none. It is deliberately a section of the contract's own
 * card rather than a fourth dock card: the surface that proposed it refused
 * stacking ("the next addition must replace or fold, not stack"), and the two
 * halves are one fact — what was done, and by whose standard it is done.
 *
 * Presentational by construction: the joined value comes from `turnReceipt`
 * (see ./turn-receipt.ts) through the strip, so this surface owns no session
 * read of its own and the turn is read once.
 *
 * Geometry keeps the strip's fixed-height rule: the row is a fixed 36px and
 * the panel is rendered in both states, hidden while collapsed, so a path
 * arriving mid-turn never moves the composer — only the reader's own toggle
 * changes the card's height.
 */
import { useId, useState } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReceiptChanges, TurnReceiptValue } from './turn-receipt.ts'
import css from './TurnReceipt.module.css'

/** The joined receipt plus the strip's locale seat. */
export type TurnReceiptProps = {
  readonly receipt: TurnReceiptValue
} & PropsLocale<'done'>

/** One line of counts: what the covered turn changed, as a count. */
function changesSummary(changes: ReceiptChanges, t: TurnReceiptProps['t']): string {
  if (changes.kind === 'unavailable') return t('receipt.summary.unavailable')
  if (changes.paths.length === 0) return t('receipt.summary.unchanged')
  return changes.paths.length === 1
    ? t('receipt.summary.changedOne')
    : t('receipt.summary.changed', { count: changes.paths.length })
}

/**
 * Render the turn receipt: one summary row over the two halves it joins.
 * @param props - the joined receipt and the strip's locale seat.
 * @returns The receipt row and the panel it discloses.
 */
export function TurnReceipt({ receipt, t }: TurnReceiptProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const { turn, changes, verdict } = receipt
  const proven = verdict.kind === 'proven'
  const verdictLabel = proven ? t('receipt.verdict.proven') : t('receipt.verdict.notAssessed')
  const paths = changes.kind === 'recorded' ? changes.paths : null
  return (
    <div className={css.receipt} data-turn-receipt="" data-changes={changes.kind}>
      <button
        type="button"
        className={css.header}
        aria-controls={panelId}
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.label}>{t('receipt.title')}</span>
        <span className={css.summary}>{changesSummary(changes, t)}</span>
        {/* The verdict word, never the colour alone: PROVEN and NOT_ASSESSED
            are the doctrine's own words, stated in both states. */}
        <span className={css.verdict} data-verdict={verdict.kind}>{verdictLabel}</span>
        <span className={css.chevron} aria-hidden="true">
          {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
        </span>
      </button>
      <div id={panelId} className={css.panel} hidden={!expanded}>
        <div className={css.group}>
          <div className={css.groupHead}>
            <span className={css.groupLabel}>{t('receipt.group.changed')}</span>
            {turn !== undefined && (
              <span className={css.turn}>{t('receipt.turn', { turn })}</span>
            )}
          </div>
          {paths === null && <p className={css.note}>{t('receipt.changes.unavailable')}</p>}
          {paths !== null && paths.length === 0 && <p className={css.note}>{t('receipt.changes.empty')}</p>}
          {paths !== null && paths.length > 0 && (
            <ul className={css.paths}>
              {paths.map(path => <li key={path} className={css.path} title={path}>{path}</li>)}
            </ul>
          )}
        </div>
        <div className={css.group}>
          <div className={css.groupHead}>
            <span className={css.groupLabel}>{t('receipt.group.evidence')}</span>
          </div>
          {/* The substance of the receipt: the evidence that met the contract,
              or the doctrine's explicit NOT_ASSESSED when none does. */}
          <p className={css.note} data-evidence={proven ? 'recorded' : 'absent'}>
            {proven ? verdict.evidence : t('receipt.evidence.absent')}
          </p>
        </div>
      </div>
    </div>
  )
}
