/**
 * Checkpoint row: the code-restore section of the definition-of-done card.
 *
 * The card already carries the end-of-turn facts — the contract, and the paths
 * this turn changed. A checkpoint is the next fact in the same story and belongs
 * in the same card: the harness recorded the files a turn was ABOUT to change
 * before it changed them, so the work is undoable, and this row is where that
 * undo is one click away. It is deliberately not a fourth dock card — the
 * surface that owns the receipt refused stacking, and this row is folded under
 * it for the same reason.
 *
 * Two rules shape the geometry and the vocabulary. The row is a fixed 36px with
 * its panel rendered in both states (hidden while collapsed), so a checkpoint
 * recorded mid-turn never moves the composer. And a restore OVERWRITES files,
 * so it is never one click deep: choosing a checkpoint arms a confirmation the
 * row renders in place, with Escape dismissing it, and only the confirmation
 * runs the verb.
 *
 * Every verb is the `/checkpoint` command through `remote.commands.execute`:
 * the click and the slash command are one path with one logged result, so the
 * row owns no client-side state beyond the disclosure and the armed confirm.
 */
import { useId, useState } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CheckpointSummary, CheckpointsProjection } from '@saturnai/dsh-checkpoints/client'
import css from './CheckpointRow.module.css'

/** The checkpoint catalog plus the card's locale seat and the restore verb. */
export type CheckpointRowProps = {
  /** The session's checkpoints, or the key's absence when the plugin is not composed. */
  readonly checkpoints: CheckpointsProjection | undefined
  /** Run `/checkpoint restore <id>`; null on admitted execution, else the failure line. */
  readonly restore: (id: string) => Promise<string | null>
} & PropsLocale<'done'>

/** One checkpoint's human description: what moment it restores, and how much it covers. */
function describe(summary: CheckpointSummary, t: CheckpointRowProps['t']): string {
  const when = summary.reason === 'pre-restore'
    ? t('checkpoint.when.preRestore')
    : t('checkpoint.when.turn', { turn: summary.turn ?? 0 })
  const files = summary.files === 1 ? t('checkpoint.files.one') : t('checkpoint.files.many', { count: summary.files })
  return `${when} · ${files}`
}

/**
 * Render the checkpoint row: what the session can put back, and the confirm that
 * puts it back.
 * @param props - the checkpoint catalog, the restore verb, and the locale seat.
 * @returns The row and its panel, or nothing when the session has no checkpoints.
 */
export function CheckpointRow({ checkpoints, restore, t }: CheckpointRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const panelId = useId()

  if (checkpoints === undefined || checkpoints.count === 0) return null
  const latest = checkpoints.latest

  /** Run one restore; the row never assumes the verb was admitted. */
  const run = async (id: string): Promise<void> => {
    if (pending) return
    setPending(true)
    setActionError(null)
    let failure: string | null
    try {
      failure = await restore(id)
    } catch (reason: unknown) {
      failure = reason instanceof Error ? reason.message : String(reason)
    }
    setPending(false)
    if (failure !== null) setActionError(failure)
    setConfirming(null)
  }

  const countLabel = checkpoints.count === 1
    ? t('checkpoint.count.one')
    : t('checkpoint.count.many', { count: checkpoints.count })

  return (
    <div className={css.row} data-checkpoints="" data-pending={pending ? 'true' : undefined}>
      {confirming !== null
        ? (
          /* The confirm takes the row's own seat: same height, so arming it
             moves nothing, and Escape disarms it without running the verb. */
          <div
            className={css.confirm}
            role="group"
            aria-label={t('checkpoint.aria')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirming(null)
            }}
          >
            <span className={css.confirmText}>
              {t('checkpoint.confirm.ask', { id: confirming })}
            </span>
            {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
            <div className={css.confirmActions}>
              <button
                type="button"
                className={css.confirmBtn}
                disabled={pending}
                onClick={() => { void run(confirming) }}
                aria-label={t('checkpoint.confirm.go')}
                autoFocus
              >
                {t('checkpoint.confirm.go')}
              </button>
              <button
                type="button"
                className={css.cancelBtn}
                disabled={pending}
                onClick={() => { setConfirming(null) }}
                aria-label={t('checkpoint.confirm.cancel')}
              >
                {t('checkpoint.confirm.cancel')}
              </button>
            </div>
          </div>
        )
        : (
          <div className={css.line}>
            <button
              type="button"
              className={css.header}
              aria-controls={panelId}
              aria-expanded={expanded}
              onClick={() => { setExpanded(value => !value) }}
            >
              <span className={css.label}>{t('checkpoint.title')}</span>
              <span className={css.summary}>{countLabel}</span>
              {latest !== null && <span className={css.when}>{describe(latest, t)}</span>}
              <span className={css.chevron} aria-hidden="true">
                {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
              </span>
            </button>
            {latest !== null && (
              <button
                type="button"
                className={css.restore}
                onClick={() => { setConfirming(latest.id) }}
                aria-label={t('checkpoint.restore.aria', { id: latest.id })}
              >
                {t('checkpoint.action.restore')}
              </button>
            )}
            {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
          </div>
        )}
      <div id={panelId} className={css.panel} hidden={!expanded || confirming !== null}>
        <p className={css.note}>{t('checkpoint.note')}</p>
        <ul className={css.list}>
          {checkpoints.entries.map(entry => (
            <li key={entry.id} className={css.entry}>
              <span className={css.entryId}>#{entry.id}</span>
              <span className={css.entryText} title={describe(entry, t)}>{describe(entry, t)}</span>
              <button
                type="button"
                className={css.entryRestore}
                onClick={() => { setConfirming(entry.id) }}
                aria-label={t('checkpoint.restore.aria', { id: entry.id })}
              >
                {t('checkpoint.action.restore')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
