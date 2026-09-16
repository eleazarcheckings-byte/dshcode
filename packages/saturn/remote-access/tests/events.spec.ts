/**
 * The replay window over the notification ring: a phone that was asleep asks
 * for everything after the last id it saw, and the bus answers with the frames
 * it still holds, how far ahead the host is, whether the window was too small,
 * and — the one thing a cursor cannot infer on its own — whether the backlog
 * had already been evicted when it asked.
 */

import { describe, expect, it } from 'vitest'
import { EventBus } from '../src/events.ts'

const AT = Date.parse('2026-09-15T20:00:00.000Z')

function busWith(count: number): EventBus {
  const bus = new EventBus()
  for (let index = 1; index <= count; index += 1) {
    bus.publish({ type: 'verdict', title: `verdict ${String(index)}`, body: 'PASS' }, AT + index)
  }
  return bus
}

describe('replay window', () => {
  it('hands back every frame newer than the cursor, oldest first', () => {
    const caught = busWith(3).replay(0, 100)
    expect(caught.events.map(event => event.id)).toEqual(['1', '2', '3'])
    expect(caught.events[0]).toMatchObject({ type: 'verdict', title: 'verdict 1', body: 'PASS' })
    expect(caught.newest).toBe('3')
    expect(caught.truncated).toBe(false)
    expect(caught.gap).toBe(false)
  })

  it('echoes the cursor and stays empty when the host holds nothing newer', () => {
    expect(busWith(3).replay(3, 100)).toMatchObject({ events: [], newest: '3', truncated: false, gap: false })
    // A cursor ahead of the host — a device restored onto an older harness —
    // is answered with its own number rather than an invented one.
    expect(busWith(3).replay(9, 100)).toMatchObject({ events: [], newest: '9', truncated: false })
    expect(new EventBus().replay(0, 100)).toMatchObject({ events: [], newest: '0', truncated: false, gap: false })
  })

  it('fills the window in order and says the backlog is longer than it', () => {
    const caught = busWith(5).replay(1, 2)
    expect(caught.events.map(event => event.id)).toEqual(['2', '3'])
    expect(caught.truncated).toBe(true)
    expect(caught.newest).toBe('5')
    expect(busWith(5).replay(3, 2).truncated).toBe(false)
  })

  it('reports a gap when the ring dropped what the cursor asked for', () => {
    // The ring holds 64; asking from the very start after 100 frames cannot be
    // answered completely, and a device told otherwise would silently lose 36.
    const evicted = busWith(100).replay(0, 200)
    expect(evicted.gap).toBe(true)
    expect(evicted.events[0]?.id).toBe('37')
    expect(evicted.events).toHaveLength(64)
    expect(evicted.newest).toBe('100')
    // Contiguous cursors are not a gap: the next frame is the one it wanted.
    expect(busWith(100).replay(36, 200).gap).toBe(false)
    expect(busWith(100).replay(50, 200).gap).toBe(false)
    expect(busWith(3).replay(0, 200).gap).toBe(false)
  })
})
