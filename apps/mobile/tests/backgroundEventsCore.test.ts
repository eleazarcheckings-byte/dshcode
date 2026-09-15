// Mars r2 (M3-apps-mobile-r2.md) R2-F2 / R2-F3 / R2-F4: the background-runner
// tick had zero test coverage, compared event ids as strings (silently
// dropping ids 10-89 once past "9"), and scheduled notifications with no
// `extra`, so a tap on one threw in main.ts. These pure helpers are the
// canonical source both assets/background-runner.js (generated -- see
// scripts/backgroundRunnerBuild.mjs) and this file import, so a fix here is
// a fix there too.
import { describe, expect, it } from 'vitest'
import {
  compareEventIds,
  deepLinkForBackgroundEvent,
  hashToNotificationId,
  isNewerEventId,
  mapBackgroundEvent,
  parseSseFrames,
} from '../src/lib/backgroundEventsCore.js'

describe('parseSseFrames', () => {
  it('parses a real SSE-framed payload (id/event/data lines, blank-line separated)', () => {
    const payload =
      'id: 7\nevent: approval\ndata: {"id":"7","type":"approval","title":"","body":"needs you","at":"2026-09-15T00:00:00.000Z"}\n\n' +
      'id: 8\nevent: verdict\ndata: {"id":"8","type":"verdict","title":"","body":"Verdict PASS on run 4","at":"2026-09-15T00:00:01.000Z"}\n\n'
    const events = parseSseFrames(payload)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ id: '7', type: 'approval' })
    expect(events[1]).toMatchObject({ id: '8', type: 'verdict' })
  })

  it('parses a bare JSON array (a poll-friendly host)', () => {
    const events = parseSseFrames('[{"id":"1","type":"fleet","title":"t","body":"b"}]')
    expect(events).toEqual([{ id: '1', type: 'fleet', title: 't', body: 'b' }])
  })

  it('skips a malformed or truncated data line instead of throwing', () => {
    const payload = 'data: {not json\n\ndata: {"id":"1"}\n\n'
    expect(() => parseSseFrames(payload)).not.toThrow()
    expect(parseSseFrames(payload)).toEqual([{ id: '1' }])
  })

  it('returns an empty array for an empty payload', () => {
    expect(parseSseFrames('')).toEqual([])
    expect(parseSseFrames('   ')).toEqual([])
  })
})

describe('compareEventIds / isNewerEventId -- the 9 -> 10 boundary', () => {
  it('orders "10" after "9" numerically (R2-F2: a string compare has "10" <= "9")', () => {
    expect(compareEventIds('10', '9')).toBeGreaterThan(0)
    expect(compareEventIds('9', '10')).toBeLessThan(0)
    expect(compareEventIds('10', '10')).toBe(0)
  })

  it('treats every id from 10 through 89 as newer than a lastSeen of "9"', () => {
    for (const id of ['10', '11', '50', '89']) {
      expect(isNewerEventId(id, '9')).toBe(true)
    }
  })

  it('treats an id at or below lastSeen as not newer', () => {
    expect(isNewerEventId('9', '9')).toBe(false)
    expect(isNewerEventId('8', '9')).toBe(false)
  })

  it('treats everything as newer when nothing has been seen yet', () => {
    expect(isNewerEventId('1', '')).toBe(true)
    expect(isNewerEventId('1', undefined)).toBe(true)
  })

  it('falls back to a string compare, never throwing, when an id is not numeric', () => {
    expect(() => compareEventIds('abc', '9')).not.toThrow()
    expect(compareEventIds('abc', 'abc')).toBe(0)
  })
})

describe('mapBackgroundEvent -- the extra payload shape (R2-F3)', () => {
  it('attaches extra: { deepLink, eventId, type } mirroring deepLinkFor()', () => {
    const descriptor = mapBackgroundEvent({
      id: '42',
      type: 'approval',
      title: '',
      body: 'A run needs your approval',
      sessionId: 'session-9',
      at: '2026-09-15T00:00:00.000Z',
    })
    expect(descriptor.extra).toEqual({
      deepLink: 'saturn://session/session-9',
      eventId: '42',
      type: 'approval',
    })
    expect(descriptor.title).toBe('Approval needed')
    expect(descriptor.id).toBe(hashToNotificationId('42'))
  })

  it('deep-links to the bare event id when there is no sessionId', () => {
    expect(deepLinkForBackgroundEvent({ id: '5', type: 'fleet' })).toBe('saturn://event/5')
  })

  it('titles a verdict event from its body text', () => {
    const descriptor = mapBackgroundEvent({
      id: '3',
      type: 'verdict',
      title: '',
      body: 'Verdict REVISE on run 2',
      at: '2026-09-15T00:00:00.000Z',
    })
    expect(descriptor.title).toBe('Verdict REVISE')
    expect(descriptor.extra.type).toBe('verdict')
  })
})
