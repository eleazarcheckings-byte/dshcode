// @ts-nocheck -- alpha.4 sync: product chat extension awaiting deep migration
import { memo, useCallback, useState } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, ContextMenu, IconBranchOutline16, IconCopyOutline16, IconFolderOpen16, IconPlayOutline16,
  IconTrashOutline16, Modal, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMenuEntry, ContextMenuTarget } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { canContinueTurn } from '../contract/chat-nodes.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, cwd, openFile, forkAt, deleteAt, continueTurn, renderSlot, renderSlotChain, t, useChat, useSession,
}: TurnTailNodeViewProps) {
  const data = node.data
  // The props face resolves to `any` under the alpha.4 ts-nocheck; pin the
  // delete callback so its call arm is typed.
  const deleteAtTyped = deleteAt as ((seq: number) => Promise<boolean>) | undefined
  // Context menu state is declared above the placement guards below so the
  // hook order survives a node that renders no tail.
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget | null>(null)
  const [confirmSeq, setConfirmSeq] = useState<number | null>(null)
  const closeMenu = useCallback(() => { setMenuOpen(false) }, [])
  const openMenuAt = useCallback((target: ContextMenuTarget) => {
    setMenuTarget(target)
    setMenuOpen(true)
  }, [])
  const hasLaterChatNode = useChat(snapshot =>
    snapshot.locations.getTurn(data.turn).at(-1) !== node.key)
  const isLatestTurn = useChat(snapshot => snapshot.timeline.turnOrder.at(-1) === data.turn)
  const anyOpenTurn = useChat(snapshot =>
    [...snapshot.timeline.turns.values()].some(turn => turn.status === 'open'))
  // Continue: offered only on a Turn that stopped short of a completed answer
  // (canContinueTurn reads the durable turn/end reason — a crash-orphaned Turn
  // carries the backend's `interrupted` marker) AND while that Turn is still the
  // Session's live tail. Never beside a later Turn, never during an open turn,
  // never while the driver is running. State sits above the placement guard so
  // hook order survives a node that renders no tail.
  const resumable = canContinueTurn(data.endReason)
  const idleTail = useSession(snapshot => !snapshot.running) && isLatestTurn && !anyOpenTurn
  const [continuePending, setContinuePending] = useState(false)
  const onContinue = continuePending || continueTurn === undefined
    ? undefined
    : () => {
      setContinuePending(true)
      // `continuePending` guards only the admission window: it disarms the
      // control between the click and the driver reporting the resumed Turn as
      // live, and a refusal re-arms it. A successful admission unmounts this
      // row outright, because the row itself is gated on being the live tail —
      // so an older Turn never keeps a spent Continue beside the Turn that
      // actually resumed, and a Turn that fails again offers a fresh control on
      // its own tail (a new node, not this one).
      void continueTurn(data.turn).then((ok) => {
        if (!ok) setContinuePending(false)
      }, () => { setContinuePending(false) })
    }
  const continueRow = resumable && idleTail
    ? (
      <div className={css.continueRow}>
        <Tooltip label={t('message.continue.title')} side="bottom">
          {/* aria-disabled, not disabled: a native disabled button delivers no
              hover/focus events, so Tooltip could not explain the state. */}
          <button
            type="button"
            className={css.continue}
            aria-label={t('message.continue')}
            aria-disabled={continuePending || undefined}
            data-continue-turn={data.turn}
            onClick={onContinue}
          >
            <IconPlayOutline16 />
            {t('message.continue')}
          </button>
        </Tooltip>
      </div>
    )
    : null
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) {
    return continueRow === null && tail === null
      ? null
      : <div className={css.root}>{continueRow}{tail}</div>
  }
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  // A synthetic closing node (interrupted partial) cannot address a durable
  // message; deleting it anchors the whole turn through its turn/end seq and
  // the host folds the entire interrupted turn off the surface.
  const deleteTarget = messageId === undefined ? data.seq : closing.finalNode.seq
  const assistant = assistantText(closing.blocks)
  const branchUnavailable = data.branchUnavailable || hasLaterChatNode
  // Delete is the only row here that destroys model-visible history and cannot
  // be undone, so it is the one row gated behind a confirmation. Copy and fork
  // act on a copy, not on the transcript.
  const turnMenuItems: readonly ContextMenuEntry[] = [
    { id: 'copy', label: t('copy'), icon: <IconCopyOutline16 /> },
    {
      id: 'fork',
      label: t('message.branch'),
      icon: <IconBranchOutline16 />,
      disabled: branchUnavailable,
    },
    // The reveal row is offered only when the Turn's Session has a workspace on
    // record: without one the opener would receive a bare `.` and could resolve
    // it against the host process, which is not this Session's folder.
    ...(cwd === undefined
      ? []
      : [{ id: 'reveal', label: t('message.showInFolder'), icon: <IconFolderOpen16 /> }]),
    { type: 'separator', id: 'sep-delete' },
    {
      id: 'delete',
      label: t('message.deleteTurn'),
      icon: <IconTrashOutline16 />,
      danger: true,
      disabled: anyOpenTurn,
    },
  ]
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-actions-reveal={isLatestTurn ? 'always' : 'hover'}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuTarget({ kind: 'point', x: event.clientX, y: event.clientY })
        setMenuOpen(true)
      }}
    >
      {continueRow}
      {tail}
      <MessageIconActions
        text={assistant}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={branchUnavailable}
        onDelete={() => deleteAtTyped(deleteTarget)}
        deleteUnavailable={anyOpenTurn}
        className={css.actions}
        extraActions={assistantActions}
        // The icon row is the turn's focusable affordance, so it is both the
        // pointer target that anchors the card and the keyboard route into it
        // (context-menu key / Shift+F10), with focus returning to the button.
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenuAt({ kind: 'element', rect: event.currentTarget.getBoundingClientRect() })
        }}
        usageAction={(
          <>
            {data.tokenUsage !== undefined && <TurnUsagePanel usage={data.tokenUsage} t={t} />}
            {runMs !== undefined && (
              <TurnTimePanel
                runMs={runMs}
                tokensPerSecond={data.tokensPerSecond}
                ttftMs={data.ttftMs}
                t={t}
              />
            )}
          </>
        )}
        t={t}
      />
      <ContextMenu
        open={menuOpen}
        target={menuTarget}
        label={t('message.menu.aria')}
        items={turnMenuItems}
        onClose={closeMenu}
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'copy') void writeClipboard(assistant)
          else if (id === 'fork') forkAt(closing.finalNode.seq)
          // `.` is the chat view's own "open the session workspace" spelling
          // (ChatView.isFolderOpenPath), so the reveal reuses the same host
          // opener as every produced-file chip rather than adding a second one.
          else if (id === 'reveal') openFile('.')
          else if (id === 'delete') setConfirmSeq(deleteTarget)
        }}
      />
      <Modal
        open={confirmSeq !== null}
        onClose={() => { setConfirmSeq(null) }}
        title={t('message.deleteConfirm.title')}
        description={t('message.deleteConfirm.body')}
        closeLabel={t('cancel')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setConfirmSeq(null) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const seq = confirmSeq
                setConfirmSeq(null)
                if (seq !== null) void deleteAtTyped(seq)
              }}
            >
              {t('delete')}
            </Button>
          </>
        )}
      />
    </div>
  )
})
