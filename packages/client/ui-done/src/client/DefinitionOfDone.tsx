/**
 * Definition of done: the contract chip occupying one Session-header utility
 * seat. A stated contract shows the hollow ring, the STATED label, and the
 * one-line statement; a proven one fills the ring, flips the label to PROVEN,
 * and appends the evidence that met it after an accented middot — the visible
 * form of the doctrine "'done' means proven". Capability absence (undefined) and
 * no contract (null) leave the chip reading the checkpoint count instead, so a
 * Session with a restore to offer still has a seat.
 *
 * The chip is deliberately one line: the header is chrome, and the contract's
 * full record belongs behind a click. That panel carries the statement and its
 * evidence, the editor for either, the three verbs, the turn receipt — the paths
 * this turn changed beside the evidence that met the contract, with NOT_ASSESSED
 * stated outright while none does — and the checkpoint row: the files the
 * harness recorded before this session changed them, with one-click restore.
 *
 * The panel is drawn in a portal so the header's own clipping and stacking
 * cannot cut it, positioned against the chip, and dismissed by an outside
 * pointer, Escape, or the chip itself. Escape returns focus to the chip.
 *
 * Every verb is a slash command through `remote.commands.execute`: the click and
 * the command are one path with one logged result, so the chip owns no
 * client-side state beyond the open panel and its editor.
 *
 * The statement is written through `/done -- <statement>`: the `--` keeps the
 * wording literal, so a contract that happens to open with "clear", "prove", or
 * "edit" is never read as a control word.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconCloseOutline16, IconEditOutline16, IconTrashOutline16,
  Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CheckpointsProjection } from '@saturnai/dsh-checkpoints/client'
import type { DoneDockInjected } from './index.ts'
import { CheckpointRow } from './CheckpointRow.tsx'
import { turnReceipt } from './turn-receipt.ts'
import { TurnReceipt } from './TurnReceipt.tsx'
import css from './DefinitionOfDone.module.css'

/** Full header-seat component props: runtime share (standard kit) & injected share & the locale seat. */
export type DefinitionOfDoneProps =
  PropsRuntime<'conversation.session.header.utilities'> & InjectFace<DoneDockInjected> & PropsLocale<'done'>

/** The open editor, if any: amending the statement, or recording evidence. */
type Editor = 'statement' | 'evidence'

/** Mirrors the host's statement ceiling, so the field cannot accept what the command rejects. */
const MAX_EDIT_LENGTH = 400

/** Stable stand-in while the binding exposes no Chat target: no turn, no record. */
const NO_TIMELINE: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() }

/** First-pass style while the panel is measured offscreen, so opening never flashes at the origin. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * The Session-header definition-of-done chip and its record panel.
 * @param props - the header utility seat's props: standard-kit hooks, the injected verb face, and `t`.
 * @returns the chip, plus the panel while it is open; `null` when this Session has no record.
 */
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
  // itself keeps its identity, so the panel re-reads the turn when its data
  // changes rather than on every streamed token.
  const timeline = useConversation(snapshot => snapshot.views.get('chat')?.timeline)
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // The contract identity at the moment of a successful clear: the chip hides
  // on the same render instead of waiting for the projection round trip.
  const [clearedAt, setClearedAt] = useState<number | null>(null)
  const pendingRef = useRef(false)
  const aliveRef = useRef(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    side: 'bottom',
    gap: 5,
    margin: 16,
  })

  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

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

  // The contract this render shows: the projection, unless a clear just landed
  // locally. No contract is a chip of nothing, not a chip of nothing plus a
  // stale line — the checkpoint half stands on its own.
  const contract = projection === undefined || projection === null || projection.at === clearedAt ? null : projection
  const hasCheckpoints = checkpoints !== undefined && checkpoints.count > 0

  // The chip renders for either half of the record; an untouched Session has
  // neither a contract nor a checkpoint and is invisible, exactly as before.
  if (contract === null && !hasCheckpoints) return null

  const checkpointRow = hasCheckpoints
    ? <CheckpointRow checkpoints={checkpoints} restore={restoreCheckpoint} t={t} />
    : null

  const proven = contract !== null && contract.status === 'proven'
  const evidence = contract !== null && proven ? contract.evidence ?? '' : ''
  const statusLabel = proven ? t('status.proven') : t('status.stated')
  const statusTitle = proven ? t('status.proven.aria') : t('status.stated.aria')
  const receipt = contract === null ? null : turnReceipt({ timeline: timeline ?? NO_TIMELINE, done: contract })

  // Escape closes the panel and returns focus to the chip. The editor owns
  // Escape while it is open: there it cancels the edit, and closing the whole
  // panel would discard the statement the reader was amending.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open || editor !== null) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  const statusMarker = (
    <span className={css.marker} data-status={proven ? 'proven' : 'stated'} aria-hidden="true">
      {proven && <IconCheckOutline16 size={9} />}
    </span>
  )

  const actions = contract === null ? null : (
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
              if (ok) {
                setClearedAt(contract.at)
                setOpen(false)
              }
            })
          }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </Tooltip>
    </div>
  )

  // The editor replaces the statement in place inside the panel: the chip keeps
  // showing the contract being amended, so the header never blanks mid-edit.
  const editorRow = (
    <>
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

  const panel = open
    ? createPortal((
      <div
        ref={panelRef}
        className={css.panel}
        style={panelPosition ?? MEASURE_STYLE}
        role="group"
        aria-label={t('statement.aria')}
        data-done-panel
        data-status={contract === null ? 'none' : contract.status}
      >
        {contract !== null && (
          <>
            <div className={css.head}>
              {statusMarker}
              <span className={css.label} data-status={contract.status} title={statusTitle}>{statusLabel}</span>
              {editor === null
                ? (
                  <span className={css.panelText}>
                    <span className={css.statement}>{contract.statement}</span>
                    {evidence !== '' && <span className={css.evidence}>{evidence}</span>}
                  </span>
                )
                : <div className={css.editor}>{editorRow}</div>}
              {editor === null && actions}
            </div>
            {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
            {receipt !== null && <TurnReceipt receipt={receipt} t={t} />}
          </>
        )}
        {contract === null && actionError !== null
          && <span className={css.error} role="alert">{actionError}</span>}
        {checkpointRow}
      </div>
    ), document.body)
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.chip}
        data-done-bar
        data-status={contract === null ? 'none' : contract.status}
        aria-expanded={open}
        title={contract === null
          ? t('checkpoint.title')
          : (evidence === '' ? contract.statement : `${contract.statement} — ${evidence}`)}
        onClick={() => { setOpen(current => !current) }}
      >
        {contract !== null && statusMarker}
        {contract !== null && (
          <span className={css.label} data-status={contract.status}>{statusLabel}</span>
        )}
        {/* One live region for the contract itself: the ring and the label are
            chrome around it, never part of the announcement. */}
        <span className={css.text} aria-live="polite">
          {contract === null
            ? <span className={css.statement}>{t('checkpoint.title')}</span>
            : <span className={css.statement}>{contract.statement}</span>}
          {evidence !== '' && <span className={css.evidence}>{evidence}</span>}
        </span>
        <IconChevronDownOutline14 className={open ? css.chevronOpen : undefined} />
      </button>
      {panel}
    </div>
  )
}
