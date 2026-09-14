/**
 * Definition of done: the contract strip docked at the head of the composer
 * context stack. A stated contract shows the gold ring, the STATED chip, and
 * the one- or two-sentence statement; a proven one fills the ring, flips the
 * chip to PROVEN, and appends the evidence that met it after a gold middot —
 * the visible form of the doctrine "'done' means proven". Capability absence
 * (undefined) and no contract (null) render no contract row at all, so an
 * untouched composer looks exactly as it did.
 *
 * Folded under that row, in the same card, are the turn receipt — the paths this
 * turn changed beside the evidence that met the contract, with NOT_ASSESSED
 * stated outright while none does — and the checkpoint row: the files the
 * harness recorded before this session changed them, with one-click restore.
 * Row, receipt, and checkpoints are all fixed-height, so neither arriving data
 * nor opening the editor moves the composer.
 *
 * The card is the composer's record of the work, so it renders when either half
 * has something to say: a stated contract, or checkpoints a restore can put
 * back. A session with neither stays invisible.
 *
 * Every verb is a slash command through `remote.commands.execute`: the click and
 * the command are one path with one logged result, so the strip owns no
 * client-side state beyond the open editor.
 *
 * The statement is written through `/done -- <statement>`: the `--` keeps the
 * wording literal, so a contract that happens to open with "clear", "prove", or
 * "edit" is never read as a control word.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CheckpointsProjection } from '@saturnai/dsh-checkpoints/client'
import type { DoneDockInjected } from './index.ts'
import { CheckpointRow } from './CheckpointRow.tsx'
import { turnReceipt } from './turn-receipt.ts'
import { TurnReceipt } from './TurnReceipt.tsx'
import css from './DefinitionOfDone.module.css'

/** Full strip-seat component props: runtime share (standard kit) & injected share & the locale seat. */
export type DefinitionOfDoneProps =
  PropsRuntime<'conversation.input.dock'> & InjectFace<DoneDockInjected> & PropsLocale<'done'>

/** The open editor, if any: amending the statement, or recording evidence. */
type Editor = 'statement' | 'evidence'

/** Mirrors the host's statement ceiling, so the field cannot accept what the command rejects. */
const MAX_EDIT_LENGTH = 400

/** Stable stand-in while the binding exposes no Chat target: no turn, no record. */
const NO_TIMELINE: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() }

export function DefinitionOfDone({
  useProjection, useConversation, setStatement, prove, clear, restoreCheckpoint, t,
}: DefinitionOfDoneProps) {
  const projection = useProjection('done')
  // The checkpoint row reads the host's `checkpoints` projection: the count and
  // the newest catalog this session can restore from. Capability absence
  // (undefined, the plugin not composed) renders no row.
  const checkpoints: CheckpointsProjection | undefined = useProjection('checkpoints')
  // The receipt reads the Chat target's timeline: that target owns the
  // produced-file record published against a turn, and selecting the timeline
  // itself keeps its identity, so the strip re-reads the turn when its data
  // changes rather than on every streamed token.
  const timeline = useConversation(snapshot => snapshot.views.get('chat')?.timeline)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // The contract identity at the moment of a successful clear: the strip hides
  // on the same render instead of waiting for the projection round trip.
  const [clearedAt, setClearedAt] = useState<number | null>(null)
  const pendingRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // The contract's identity (its mutation stamp) is the reset key: a set, an
  // amend, a proof, or a clear from anywhere invalidates the local editor.
  const identity = projection === undefined || projection === null ? null : projection.at
  useEffect(() => {
    setEditor(null)
    setDraft('')
    setActionError(null)
    setClearedAt(null)
  }, [identity])

  // Local state disables the controls on the next render; the ref closes the
  // same-render window so a rapid double submit cannot run the verb twice.
  const runAction = useCallback(async (action: () => Promise<string | null>): Promise<boolean> => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    let failure: string | null
    try {
      failure = await action()
    } catch (reason: unknown) {
      failure = reason instanceof Error ? reason.message : String(reason)
    }
    pendingRef.current = false
    if (!aliveRef.current) return false
    setPending(false)
    if (failure !== null) setActionError(failure)
    return failure === null
  }, [])

  const submit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === '' || editor === null) return
    const verb = editor
    const ok = await runAction(() => (verb === 'evidence' ? prove(trimmed) : setStatement(trimmed)))
    if (ok) setEditor(null)
  }, [draft, editor, prove, runAction, setStatement])

  // The contract row this render shows: the projection, unless a clear just
  // landed locally. No contract is a row of nothing, not a card of nothing —
  // the checkpoint row below it stands on its own.
  const contract = projection === undefined || projection === null || projection.at === clearedAt ? null : projection
  const hasCheckpoints = checkpoints !== undefined && checkpoints.count > 0

  // The card renders for either half of the record; an untouched session has
  // neither a contract nor a checkpoint and is invisible, exactly as before.
  if (contract === null && !hasCheckpoints) return null

  const checkpointRow = hasCheckpoints
    ? <CheckpointRow checkpoints={checkpoints} restore={restoreCheckpoint} t={t} />
    : null

  if (contract === null) {
    return (
      <div className={css.dock} data-done-bar data-status="none">
        <div className={css.card}>{checkpointRow}</div>
      </div>
    )
  }

  const proven = contract.status === 'proven'
  const evidence = proven ? contract.evidence ?? '' : ''
  const statusLabel = proven ? t('status.proven') : t('status.stated')
  const statusTitle = proven ? t('status.proven.aria') : t('status.stated.aria')
  const receipt = turnReceipt({ timeline: timeline ?? NO_TIMELINE, done: contract })

  const statusMarker = (
    <span className={css.marker} data-status={contract.status} aria-hidden="true">
      {proven && <IconCheckOutline16 size={9} />}
    </span>
  )

  const controls = (
    <div className={css.actions}>
      {!proven && (
        <Tooltip label={t('action.prove')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={() => { setDraft(''); setEditor('evidence') }}
            aria-label={t('action.prove')}
          >
            <IconCheckOutline16 size={14} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.iconBtn}
          disabled={pending}
          onClick={() => { setDraft(contract.statement); setEditor('statement') }}
          aria-label={t('action.edit')}
        >
          <IconEditOutline16 size={14} />
        </button>
      </Tooltip>
      <Tooltip label={t('action.clear')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.iconBtn}
          disabled={pending}
          aria-label={t('action.clear')}
          onClick={() => {
            void runAction(clear).then((ok) => {
              if (ok) setClearedAt(contract.at)
            })
          }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </Tooltip>
    </div>
  )

  // The editor replaces the contract in place: same row, same height, so
  // opening it moves nothing below the composer — and the receipt below it
  // keeps its own disclosure state instead of remounting.
  const row = editor !== null
    ? (
      <>
        {statusMarker}
        <input
          className={css.input}
          type="text"
          maxLength={MAX_EDIT_LENGTH}
          aria-label={editor === 'evidence' ? t('form.evidence.aria') : t('form.statement.aria')}
          placeholder={editor === 'evidence' ? t('form.evidence.placeholder') : undefined}
          value={draft}
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setEditor(null)
          }}
          autoFocus
        />
        {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
        <div className={css.actions}>
          <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => { void submit() }}
              disabled={pending || draft.trim() === ''}
              aria-label={t('action.save')}
            >
              <IconCheckOutline16 size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => { setEditor(null) }}
              aria-label={t('action.cancel')}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </Tooltip>
        </div>
      </>
    )
    : (
      <>
        {statusMarker}
        <span className={css.chip} data-status={contract.status} title={statusTitle}>{statusLabel}</span>
        {/* One live region for the contract itself: the chip and the controls
            are chrome around it, never part of the announcement. */}
        <span
          className={css.text}
          aria-live="polite"
          title={evidence === '' ? contract.statement : `${contract.statement} — ${evidence}`}
        >
          <span className={css.statement}>{contract.statement}</span>
          {evidence !== '' && <span className={css.evidence}>{evidence}</span>}
        </span>
        {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
        {controls}
      </>
    )

  return (
    <div className={css.dock} data-done-bar data-status={contract.status}>
      <div className={css.card}>
        <div className={css.bar} role="group" aria-label={t('statement.aria')}>
          {row}
        </div>
        <TurnReceipt receipt={receipt} t={t} />
        {checkpointRow}
      </div>
    </div>
  )
}
