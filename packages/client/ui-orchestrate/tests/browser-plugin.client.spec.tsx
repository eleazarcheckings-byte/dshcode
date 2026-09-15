/**
 * ui-orchestrate browser half on a real SlotRegistry: the plugin occupies the
 * conversation-declared `conversation.input.left` list seat (`id:
 * 'multi-task'`, `order: 10`) with the multi-task toggle; the injected face
 * executes `/orchestrate on|off` and folds admission outcomes into null
 * (admitted) or a user-visible failure line; a seat declared before or after
 * apply is filled exactly once, and teardown (either side) empties it — the
 * HMR-safety contract the README claims.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { OrchestrateToggle } from '../src/client/OrchestrateToggle.tsx'
import type { OrchestrateToggleInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-orchestrate' as SessionId
const HOLE = 'conversation.input.left'

/** A fresh root context with the composer's list-kind left-control hole declared (or not). */
async function bench(declareHole = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: { [HOLE]: { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const dispose = declareHole ? declare() : undefined
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute, declare, dispose }
}

describe('ui-orchestrate browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until the conversation declares the left-control seat', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(HOLE)).toHaveLength(0)
    b.declare()
    await Promise.resolve()
    expect(b.slots.entries(HOLE)).toHaveLength(1)
  })

  it('registers the multi-task seat at the declared id and order', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries(HOLE)[0]!
    expect(entry.component).toBe(OrchestrateToggle)
    expect(entry.locale).toBe('orchestrate')
    expect(entry.options).toMatchObject({ id: 'multi-task', order: 10 })
  })

  it('executes /orchestrate on|off and folds admission outcomes to a failure line', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries(HOLE)[0]!
    const injected = (entry.inject as unknown as (id: SessionId) => OrchestrateToggleInjected)(SID)

    await expect(injected.toggle(true)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/orchestrate on', [])
    await expect(injected.toggle(false)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/orchestrate off', [])

    // Business failure folds to the composer-visible line: the generated method
    // reports the RPC failure in its error branch.
    b.execute.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/not-found', 'gone', { sessionId: SID }),
    } as never)
    await expect(injected.toggle(true)).resolves.toBe('gone (session/not-found)')

    // Unmatched admission (multi-task not composed host-side) is also a failure line.
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.toggle(true)).resolves.toBe('unknown command: /orchestrate')
  })

  it('fills a seat declared before or after apply and empties it on either side\'s teardown (HMR safety)', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries(HOLE)).toHaveLength(1)

    // The declaring package (ui-conversation) reloads under HMR: the occupant
    // disappears, then reappears once the hole redeclares.
    before.dispose?.()
    expect(before.slots.entries(HOLE)).toHaveLength(0)
    before.declare()
    await Promise.resolve()
    expect(before.slots.entries(HOLE)).toHaveLength(1)

    // This plugin's own module reloads under HMR: its fiber disposes, and no
    // stale occupant survives the disposal.
    await fiber.dispose()
    expect(before.slots.entries(HOLE)).toHaveLength(0)

    // A cold apply after the hole already exists (declared-before-apply) fills
    // it exactly once — no duplicate registration from replaying the effect.
    const after = await bench(true)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(HOLE)).toHaveLength(1)
  })
})
