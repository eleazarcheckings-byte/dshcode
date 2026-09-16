// @vitest-environment jsdom
/**
 * Continue after an interrupted turn: the resumable-reason predicate
 * (`canContinueTurn`), the Turn-tail Continue row gated on it, and the real
 * `continueTurn` inject that steers `continue` in `steer` mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { ISession, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import {
  RemoteError, SlotTestRuntime, TestRemote, bindSnapshotSelector, makeTranslate,
  stubSettingsScope,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply as applyConversation, inject as injectConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  apply as applyChat, inject as injectChat, type ChatNode, type ChatSnapshot, type ChatViewInjected,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { canContinueTurn } from '../src/client/contract/chat-nodes.ts'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import { en, zh } from '../src/client/locale.ts'
import { createChatStore } from '../src/client/stores.ts'

afterEach(cleanup)

type TailProps = ComponentProps<typeof TurnTailNodeView>
const t: TailProps['t'] = makeTranslate(en, commonEn)

/* ------------------------------------------------------------------ *
 * canContinueTurn — the resumable-reason predicate.
 * ------------------------------------------------------------------ */

describe('canContinueTurn', () => {
  // The complete live `TurnEndReasonMap` at this revision: completed, aborted,
  // blocked, error, max-tokens, interrupted.
  it.each<[string, TurnEndReason]>([
    ['interrupted', { kind: 'interrupted' }],
    ['aborted', { kind: 'aborted', reason: { kind: 'user' } }],
    ['error', { kind: 'error', error: { code: 'UNKNOWN', message: 'crashed' } }],
    ['max-tokens', { kind: 'max-tokens' }],
  ])('resumes a Turn that ended %s', (_label, reason) => {
    expect(canContinueTurn(reason)).toBe(true)
  })

  it.each<[string, TurnEndReason]>([
    ['completed', { kind: 'completed' }],
    ['blocked', { kind: 'blocked' }],
  ])('refuses a Turn that ended %s', (_label, reason) => {
    expect(canContinueTurn(reason)).toBe(false)
  })

  it('refuses a tail that recorded no end reason', () => {
    expect(canContinueTurn(undefined)).toBe(false)
  })

  it('refuses a merge-extended reason this build does not know', () => {
    // `TurnEndReasonMap` is merge-extensible; the default arm must stay closed
    // so a future variant never grows a Continue affordance by accident.
    expect(canContinueTurn({ kind: 'future-reason' } as unknown as TurnEndReason)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * TurnTailNodeView — the Continue row.
 * ------------------------------------------------------------------ */

function tailNode(endReason: TurnEndReason | undefined, key: string): ChatNode<'turn-tail'> {
  return {
    key,
    id: '1',
    target: 'chat',
    kind: 'turn-tail',
    anchorSeq: 10,
    location: { kind: 'turn', turn: { turn: 1, status: 'closed' } },
    visibility: 'visible',
    data: {
      turn: 1,
      seq: 10,
      time: 10_000,
      ...(endReason === undefined ? {} : { endReason }),
      // An interrupted partial closes without a durable message, so the row
      // under test is reached without the assistant action chrome.
      closing: null,
      branchUnavailable: true,
    },
  } as unknown as ChatNode<'turn-tail'>
}

function tailProps(overrides: {
  endReason?: TurnEndReason
  running?: boolean
  turnOrder?: readonly number[]
  openTurns?: readonly number[]
  continueTurn?: (turn: number) => Promise<boolean>
  nodeKey?: string
} = {}): TailProps {
  const nodeKey = overrides.nodeKey ?? 'fixture:turn-tail:1'
  const turnOrder = overrides.turnOrder ?? [1]
  const openTurns = new Set(overrides.openTurns ?? [])
  const chatSnapshot = {
    locations: { getTurn: () => [nodeKey] },
    timeline: {
      turnOrder,
      turns: new Map(turnOrder.map(turn => [
        turn,
        { turn, status: openTurns.has(turn) ? 'open' : 'closed' },
      ])),
    },
  } as unknown as ChatSnapshot
  return {
    node: tailNode(overrides.endReason, nodeKey),
    cwd: undefined,
    openFile: vi.fn(),
    forkAt: vi.fn(),
    deleteAt: vi.fn(async () => true),
    continueTurn: overrides.continueTurn ?? vi.fn(async () => true),
    renderSlot: () => null,
    renderSlotChain: () => null,
    t,
    useChat: bindSnapshotSelector(createSnapshotStore(chatSnapshot)),
    useSession: bindSnapshotSelector(createSnapshotStore({ running: overrides.running ?? false })),
  } as unknown as TailProps
}

describe('TurnTailNodeView Continue row', () => {
  it.each<[string, TurnEndReason]>([
    ['interrupted', { kind: 'interrupted' }],
    ['aborted', { kind: 'aborted', reason: { kind: 'user' } }],
    ['error', { kind: 'error', error: { code: 'UNKNOWN', message: 'crashed' } }],
    ['max-tokens', { kind: 'max-tokens' }],
  ])('offers exactly one Continue control on a %s tail', (_label, reason) => {
    const view = render(<TurnTailNodeView {...tailProps({ endReason: reason })} />)
    const controls = view.getAllByRole('button', { name: 'Continue' })
    expect(controls).toHaveLength(1)
    expect(controls[0]?.getAttribute('data-continue-turn')).toBe('1')
  })

  it('offers no Continue control on a completed tail', () => {
    const view = render(<TurnTailNodeView {...tailProps({ endReason: { kind: 'completed' } })} />)
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('offers no Continue control while the driver is running', () => {
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' }, running: true })} />,
    )
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('offers no Continue control beside a later Turn', () => {
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' }, turnOrder: [1, 2] })} />,
    )
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('offers no Continue control while any Turn is open', () => {
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' }, openTurns: [1] })} />,
    )
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('activates the injected continueTurn with this Turn', async () => {
    const continueTurn = vi.fn<(turn: number) => Promise<boolean>>(async () => true)
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' }, continueTurn })} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => { expect(continueTurn).toHaveBeenCalledWith(1) })
    // Exactly one admission: the click is not double-fired by the pending guard.
    expect(continueTurn).toHaveBeenCalledOnce()
  })

  it('disarms the control during admission and re-arms it on refusal', async () => {
    let settle: ((ok: boolean) => void) | undefined
    const continueTurn = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' }, continueTurn })} />,
    )
    const control = view.getByRole('button', { name: 'Continue' })
    fireEvent.click(control)
    // The click's state update lands through the React act window.
    expect(control.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(control)
    expect(continueTurn).toHaveBeenCalledOnce()
    settle?.(false)
    await vi.waitFor(() => { expect(control.getAttribute('aria-disabled')).toBeNull() })
  })

  it('names the control "Continue" and explains it through its tooltip', () => {
    const view = render(
      <TurnTailNodeView {...tailProps({ endReason: { kind: 'interrupted' } })} />,
    )
    const control = view.getByRole('button', { name: 'Continue' })
    expect(control.getAttribute('aria-label')).toBe('Continue')
    fireEvent.focus(control)
    expect(screen.getByRole('tooltip').textContent)
      .toBe('This turn stopped before it finished; continue to let the model resume')
  })

  it('resolves both Continue locale keys in English and Chinese', () => {
    expect(en['message.continue']).toBe('Continue')
    expect(en['message.continue.title'])
      .toBe('This turn stopped before it finished; continue to let the model resume')
    expect(zh['message.continue']).toBe('继续')
    expect(zh['message.continue.title']).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ *
 * continueTurn — the real inject path (steer `continue` into the Session).
 * ------------------------------------------------------------------ */

const SID = 'continue-session' as SessionId

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>
type ChatActions = ChatInstance['actions']

function at(seq: number, type: string, data: unknown): SessionEvent {
  return { seq: SessionSeq(seq), time: 1_000 + seq, type, data } as unknown as SessionEvent
}

function event(event: SessionEvent): SessionEventLikeEntry {
  return { type: 'event', event }
}

function sessionFakeFor() {
  const abandon = vi.fn()
  return {
    submission: { requestId: 'continue-submission-1', abandon },
    beginSubmission: vi.fn<ISession['beginSubmission']>(() => ({
      requestId: 'continue-submission-1',
      abandon,
    } as never)),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    loadThrough: vi.fn<ISession['loadThrough']>(() => Promise.resolve()),
  } satisfies SessionBehaviorOverrides
}

/** Full Chat + Conversation bench over one fixture Session's event window. */
async function bench(events: readonly SessionEventLikeEntry[]) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() } as never)
  runtime.ctx.provide('uiWorkspace', { connectWorkspace: vi.fn(async () => SID) } as never)
  new TestRemote(runtime.ctx, {
    session: { openWorkspacePath: vi.fn(async () => ({ ok: true, value: { opened: true } })) },
  })
  const session = sessionFakeFor()
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'Continue', displayTitle: 'Continue', cwd: '/proj' },
    session,
    events,
  }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
    'conversation.approval.detail': { kind: 'single', scope: 'session' },
    'settings.general.item': { kind: 'list', scope: 'root' },
  }, (_props: { renderSlot?: unknown }) => null)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  runtime.renderRoot()
  const entry = runtime.slots.entries('conversation.view')[0]!
  const instance = runtime.storeOf('conversation.view', SID) as ChatInstance
  const injected = (entry.inject as unknown as (
    sessionId: SessionId,
    actions: ChatActions,
  ) => ChatViewInjected)(SID, instance.actions)
  // The `chat` target is built only once a subscriber activates it; the inject
  // read face otherwise falls back to EMPTY_CHAT_SNAPSHOT.
  runtime.ctx.uiConversation.binding(SID).activate('chat')
  const chat = runtime.ctx.uiConversation.binding(SID).target('chat').getSnapshot()
  return { runtime, session, injected, chat }
}

describe('continueTurn inject', () => {
  it('steers the documented "continue" prompt in steer mode for a resumable tail Turn', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
      event(at(2, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } })),
    ])
    expect(b.chat).toBeDefined()
    expect(b.chat?.timeline.turnOrder).toEqual([1])
    expect(b.chat?.timeline.turns.get(1)?.status).toBe('closed')
    // The durable `turn/end` reason is projected onto the tail node the row reads.
    const tail = [...b.chat!.nodes.values()].find(node => node.kind === 'turn-tail')
    expect(tail?.data).toMatchObject({ endReason: { kind: 'interrupted' } })

    await expect(b.injected.continueTurn(1)).resolves.toBe(true)
    expect(b.session.beginSubmission).toHaveBeenCalledWith({
      mode: 'steer',
      text: 'continue',
      images: [],
    })
    expect(b.session.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'continue' }], 'steer', undefined, 'continue-submission-1',
    )
    await b.runtime.dispose()
  })

  it('refuses a Turn that is not the Session tail without steering', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
      event(at(2, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } })),
    ])
    await expect(b.injected.continueTurn(2)).resolves.toBe(false)
    expect(b.session.beginSubmission).not.toHaveBeenCalled()
    expect(b.session.prompt).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('refuses while a Turn is still open without steering', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
    ])
    // The tail Turn guard alone would admit turn 1; the open-Turn guard refuses it.
    expect(b.chat?.timeline.turnOrder).toEqual([1])
    expect(b.chat?.timeline.turns.get(1)?.status).toBe('open')
    await expect(b.injected.continueTurn(1)).resolves.toBe(false)
    expect(b.session.beginSubmission).not.toHaveBeenCalled()
    expect(b.session.prompt).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('joins an in-flight admission instead of steering twice', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
      event(at(2, 'turn/end', { turn: 1, reason: { kind: 'max-tokens' } })),
    ])
    const first = b.injected.continueTurn(1)
    const second = b.injected.continueTurn(1)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(b.session.beginSubmission).toHaveBeenCalledOnce()
    expect(b.session.prompt).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('abandons the echo and resolves false when the host refuses the steer', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
      event(at(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'x' } } })),
    ])
    b.session.prompt.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/agent-busy', 'busy', { reason: 'busy' }),
    })
    await expect(b.injected.continueTurn(1)).resolves.toBe(false)
    const handle = b.session.beginSubmission.mock.results[0]?.value as { abandon: () => void } | undefined
    expect(handle?.abandon).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('abandons the echo and resolves false when the steer throws', async () => {
    const b = await bench([
      event(at(1, 'turn/start', { turn: 1 })),
      event(at(2, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })),
    ])
    b.session.prompt.mockRejectedValueOnce(new Error('transport down'))
    await expect(b.injected.continueTurn(1)).resolves.toBe(false)
    const handle = b.session.beginSubmission.mock.results[0]?.value as { abandon: () => void } | undefined
    expect(handle?.abandon).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })
})
