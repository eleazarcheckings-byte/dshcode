/**
 * The verdict card: an independent reviewer's judgement, rendered as the thing
 * it is — a stamped receipt with the reasons attached.
 *
 * A countersigned contract is the only place in this product where one agent's
 * work has been graded by another, so the card refuses to compress that into a
 * badge. It shows the stamp, who graded it, what they said, and every criterion
 * with the score and the evidence that earned it. A reader who disagrees with
 * the verdict can see exactly where to disagree.
 *
 * The stamp carries the signature mark: the hairline ring at -18°, drawn in
 * `currentColor` and self-drawing on arrival, so a PASS is sealed rather than
 * merely coloured. Under reduced motion the ring is simply there.
 *
 * Presentational by construction: the whole card comes from the durable proof
 * the `done` projection already carries, so it owns no state and performs no
 * read of its own.
 */

import type { DoneProof } from '@saturnai/dsh-done/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VerdictCard.module.css'

/** The proof to render, plus the strip's locale seat. */
export type VerdictCardProps = {
  /** The contract's proof; only a countersign has a rubric to show. */
  readonly proof: DoneProof | undefined
} & PropsLocale<'done'>

/**
 * The seal: one hairline ellipse at the product's signature tilt, drawn in
 * `currentColor`.
 * @returns the ring, decorative to assistive technology.
 */
function Ring() {
  return (
    <svg className={css.ring} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <ellipse
        className={css.ringPath}
        cx="20"
        cy="20"
        rx="18"
        ry="7.5"
        pathLength={100}
        transform="rotate(-18 20 20)"
      />
    </svg>
  )
}

/**
 * Render one independent review.
 * @param props - the contract's proof and the locale seat.
 * @returns the card, or `null` when this contract was not countersigned.
 */
export function VerdictCard({ proof, t }: VerdictCardProps) {
  if (proof === undefined || proof.kind !== 'countersign') return null
  return (
    <section
      className={css.card}
      data-verdict-card=""
      data-verdict={proof.verdict}
      aria-label={t('verdict.title')}
    >
      <div className={css.head}>
        <span className={css.stamp} data-verdict={proof.verdict} title={t('verdict.stamp.aria', { verdict: proof.verdict })}>
          {proof.verdict === 'PASS' && <Ring />}
          <span className={css.stampWord}>{proof.verdict}</span>
        </span>
        <span className={css.title}>{t('verdict.title')}</span>
        <span className={css.reviewer} title={proof.reviewer}>{proof.reviewer}</span>
      </div>
      {proof.summary !== undefined && proof.summary !== '' && (
        <p className={css.summary}>{proof.summary}</p>
      )}
      <ul className={css.rubric}>
        {proof.scores.map(score => (
          <li
            key={score.criterion}
            className={css.row}
            data-criterion={score.criterion}
            data-score={score.score}
          >
            <span className={css.criterion}>{t(`verdict.criterion.${score.criterion}`)}</span>
            <span className={css.score} title={t('verdict.score.aria', { score: score.score })}>
              {t('verdict.score', { score: score.score })}
            </span>
            <span className={css.evidence}>{score.evidence}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
