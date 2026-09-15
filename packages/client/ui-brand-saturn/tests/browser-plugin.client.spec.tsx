// @vitest-environment jsdom
/**
 * Proves the two contracts the package README claims: both sidebar slots are
 * filled as one declaration-aware unit with no build-profile gate (unlike
 * `ui-brand-official`), and the registration survives HMR — a slot that
 * reloads (redeclares) or a plugin fiber that disposes and reloads leaves no
 * stale occupant and no missing one.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { SaturnName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

/** A fresh root context with the sidebar (and hero) slot holes declared. */
async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...HOLES, HERO_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Saturn browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills both sidebar slots with no build-profile gate', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('leaves the conversation hero mark unoccupied, deliberately', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown (HMR-safety)', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    // The declaring slot side reloads under HMR (its module re-evaluates):
    // the occupants must disappear, then reappear once it redeclares.
    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    // This plugin's own module reloads under HMR: its fiber disposes, and no
    // stale occupant survives the disposal.
    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    // A cold apply after the holes already exist (declared-before-apply) fills
    // them exactly once — no duplicate registration from replaying the effect.
    const after = await bench(true)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the wordmark independently of the slot registry', () => {
    const name = render(<SaturnName />)
    expect(name.getByText('Saturn')).not.toBeNull()
    expect(name.getByText('AI')).not.toBeNull()
    name.unmount()
  })
})
