import { describe, expect, it } from 'vitest'
import { deepLinkFor, mapEventToNotification, type RemoteEvent } from '../src/lib/eventsMapper.ts'

function event(overrides: Partial<RemoteEvent> = {}): RemoteEvent {
  return {
    type: 'approval',
    title: '',
    body: '',
    id: 'evt-1',
    at: new Date().toISOString(),
    ...overrides,
  }
}

describe('deepLinkFor', () => {
  it('links to the session when one is present', () => {
    expect(deepLinkFor({ type: 'verdict', id: 'evt-1', sessionId: 'sess-9' })).toBe(
      'saturn://session/sess-9',
    )
  })

  it('falls back to the event id when there is no session', () => {
    expect(deepLinkFor({ type: 'fleet', id: 'evt-1' })).toBe('saturn://event/evt-1')
  })

  it('encodes ids that contain reserved characters', () => {
    expect(deepLinkFor({ type: 'fleet', id: 'evt/1 two' })).toBe('saturn://event/evt%2F1%20two')
  })
})

describe('mapEventToNotification', () => {
  it('titles an approval event "Approval needed" when the host sent no title', () => {
    const n = mapEventToNotification(event({ type: 'approval', title: '', body: 'C8a needs a decision' }))
    expect(n.title).toBe('Approval needed')
    expect(n.body).toBe('C8a needs a decision')
  })

  it('keeps a host-supplied title for approval events', () => {
    const n = mapEventToNotification(event({ type: 'approval', title: 'Deploy hook needs a secret', body: '' }))
    expect(n.title).toBe('Deploy hook needs a secret')
  })

  it('titles a PASS verdict event from the body', () => {
    const n = mapEventToNotification(
      event({ type: 'verdict', title: '', body: 'C8a: PASS — all criteria met', sessionId: 'sess-1' }),
    )
    expect(n.title).toBe('Verdict PASS')
    expect(n.extra.deepLink).toBe('saturn://session/sess-1')
  })

  it('titles a REVISE verdict event from the body', () => {
    const n = mapEventToNotification(event({ type: 'verdict', title: '', body: 'REVISE: fix edge case' }))
    expect(n.title).toBe('Verdict REVISE')
  })

  it('titles a REJECT verdict event from the body', () => {
    const n = mapEventToNotification(event({ type: 'verdict', title: '', body: 'REJECT: missing tests' }))
    expect(n.title).toBe('Verdict REJECT')
  })

  it('falls back to the host title when a verdict body has no recognizable stamp', () => {
    const n = mapEventToNotification(event({ type: 'verdict', title: 'Review complete', body: 'see receipt' }))
    expect(n.title).toBe('Review complete')
  })

  it('titles a saturnbot event "SaturnBot needs you" by default', () => {
    const n = mapEventToNotification(event({ type: 'saturnbot', title: '', body: 'stuck on a Gate' }))
    expect(n.title).toBe('SaturnBot needs you')
  })

  it('derives a stable positive integer id from the event id', () => {
    const n1 = mapEventToNotification(event({ id: 'evt-42' }))
    const n2 = mapEventToNotification(event({ id: 'evt-42' }))
    expect(n1.id).toBe(n2.id)
    expect(Number.isInteger(n1.id)).toBe(true)
    expect(n1.id).toBeGreaterThanOrEqual(0)
  })

  it('produces different ids for different events', () => {
    const n1 = mapEventToNotification(event({ id: 'evt-1' }))
    const n2 = mapEventToNotification(event({ id: 'evt-2' }))
    expect(n1.id).not.toBe(n2.id)
  })

  it('carries the event type and id through to extra for deep-link handling', () => {
    const n = mapEventToNotification(event({ type: 'fleet', id: 'evt-7' }))
    expect(n.extra).toEqual({ deepLink: 'saturn://event/evt-7', eventId: 'evt-7', type: 'fleet' })
  })
})
