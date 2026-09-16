// Mars r2 (M3-apps-mobile-r2.md) R2-F2 / R2-F3 / R2-F4: the background-runner
// tick had zero test coverage, compared event ids as strings (silently
// dropping ids 10-89 once past "9"), and scheduled notifications with no
// `extra`, so a tap on one threw in main.ts. These pure helpers are the
// canonical source both assets/background-runner.js (generated -- see
// scripts/backgroundRunnerBuild.mjs) and this file import, so a fix here is
// a fix there too.
//
// Mars r3 (M3-apps-mobile-r3.md) R3-F1: the tick's streaming
// `response.body.getReader()` read is unreachable on iOS --
// @capacitor/background-runner's JSResponse (its own shipped Swift source,
// JSResponse.swift) exposes only ok/status/url/text()/json(), and its fetch
// resolves only once the whole body has buffered (JSFetch.swift), so a
// fetch against the host's never-closing SSE stream never resolves at all.
// `parseSseFrames` (the SSE-frame parser the old streaming read used) is
// gone with that path; the tick now consumes the bounded replay contract
// (SPEC.md §8) with a single `response.json()` per page instead.
import { describe, expect, it } from 'vitest'
import {
  compareEventIds,
  deepLinkForBackgroundEvent,
  hashToNotificationId,
  hasReplayGap,
  isNewerEventId,
  isReplayTruncated,
  mapBackgroundEvent,
  parseReplayEvents,
  resolveReplayCursor,
} from '../src/lib/backgroundEventsCore.js'

describe('parseReplayEvents -- GET .../events/replay JSON shape', () => {
  it('reads the `events` array off a well-formed replay body', () => {
    const payload = { events: [{ id: '11', type: 'fleet' }], newest: '11', truncated: false }
    expect(parseReplayEvents(payload)).toEqual([{ id: '11', type: 'fleet' }])
  })

  it('returns an empty array when `events` is missing, not an array, or the payload itself is not an object', () => {
    expect(parseReplayEvents({ newest: '1' })).toEqual([])
    expect(parseReplayEvents({ events: 'not-an-array' })).toEqual([])
    expect(parseReplayEvents(null)).toEqual([])
    expect(parseReplayEvents(undefined)).toEqual([])
    expect(parseReplayEvents('[]')).toEqual([])
  })

  it('never throws on a malformed payload', () => {
    expect(() => parseReplayEvents(42)).not.toThrow()
    expect(() => parseReplayEvents([])).not.toThrow()
  })
})

describe('hasReplayGap / isReplayTruncated -- the contract flags', () => {
  it('detects `gap: true` when the requested `after` was older than the ring\'s oldest retained id', () => {
    expect(hasReplayGap({ events: [], newest: '50', gap: true })).toBe(true)
    expect(hasReplayGap({ events: [], newest: '50' })).toBe(false)
    expect(hasReplayGap(null)).toBe(false)
  })

  it('detects `truncated: true` when more than `limit` events were available', () => {
    expect(isReplayTruncated({ events: [], newest: '50', truncated: true })).toBe(true)
    expect(isReplayTruncated({ events: [], newest: '50', truncated: false })).toBe(false)
    expect(isReplayTruncated(undefined)).toBe(false)
  })
})

describe('resolveReplayCursor -- advancing `lastSeen` after a page (truncated paging)', () => {
  it('takes the host-reported `newest` when it is at or ahead of what this page actually scheduled', () => {
    expect(resolveReplayCursor('12', '10')).toBe('12')
    expect(resolveReplayCursor('12', '12')).toBe('12')
  })

  it('falls back to the observed id when `newest` is missing or malformed, never regressing the cursor', () => {
    expect(resolveReplayCursor(undefined, '10')).toBe('10')
    expect(resolveReplayCursor(null, '10')).toBe('10')
    expect(resolveReplayCursor('9', '10')).toBe('10')
  })

  it('takes the reported `newest` when nothing on this page advanced the observed id (e.g. an empty page)', () => {
    expect(resolveReplayCursor('20', '')).toBe('20')
  })

  it('models one truncated-paging tick: two 100-row pages, `after` advancing between them', () => {
    const page1 = { events: [{ id: '101' }, { id: '102' }], newest: '102', truncated: true }
    const page2 = { events: [{ id: '103' }], newest: '103', truncated: false }
    let cursor = '100'
    for (const page of [page1, page2]) {
      let observed = cursor
      for (const event of parseReplayEvents(page)) {
        if (compareEventIds(event.id, observed) > 0) observed = event.id
      }
      cursor = resolveReplayCursor(page.newest, observed)
      if (!isReplayTruncated(page)) break
    }
    expect(cursor).toBe('103')
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
