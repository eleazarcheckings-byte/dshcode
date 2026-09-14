// @vitest-environment node
/**
 * Unit tests for the DeepSeek API peak-pricing schedule helpers.
 * All dates are constructed in UTC so the tests are TZ-agnostic.
 */
import { describe, expect, it } from 'vitest'
import { formatTransitionTime, isPeakHour, nextTransition } from '../src/client/skeleton/deepseek-peak.ts'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a UTC Date for a given weekday + hour (minute optional).
 *  weekday follows getUTCDay() convention: 0 = Sunday, 1 = Monday … 6 = Saturday.
 *  2024-01-01 = Monday (getUTCDay() === 1), so Jan 7 = Sunday (getUTCDay() === 0).
 */
function utc(weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6, hour: number, minute = 0): Date {
  // Day-of-month for each weekday, anchored on the week of 2024-01-01 (Mon).
  // Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7 (Jan 7).
  const dayOfMonth = weekday === 0 ? 7 : weekday
  return new Date(Date.UTC(2024, 0, dayOfMonth, hour, minute))
}

// ─── isPeakHour ─────────────────────────────────────────────────────────────

describe('isPeakHour', () => {
  // Window 1: 01:00–03:59 UTC on weekdays
  it('is peak at Mon 01:00 UTC', () => {
    expect(isPeakHour(utc(1, 1))).toBe(true)
  })
  it('is peak at Fri 03:59 UTC', () => {
    expect(isPeakHour(utc(5, 3, 59))).toBe(true)
  })
  it('is NOT peak at Mon 00:59 UTC (before window 1)', () => {
    expect(isPeakHour(utc(1, 0, 59))).toBe(false)
  })
  it('is NOT peak at Tue 04:00 UTC (start of gap between windows)', () => {
    expect(isPeakHour(utc(2, 4))).toBe(false)
  })

  // Window 2: 06:00–09:59 UTC on weekdays
  it('is peak at Wed 06:00 UTC', () => {
    expect(isPeakHour(utc(3, 6))).toBe(true)
  })
  it('is peak at Thu 09:59 UTC', () => {
    expect(isPeakHour(utc(4, 9, 59))).toBe(true)
  })
  it('is NOT peak at Mon 10:00 UTC (after window 2)', () => {
    expect(isPeakHour(utc(1, 10))).toBe(false)
  })

  // Off-peak gap between the two windows (04:00–05:59)
  it('is NOT peak at Wed 05:00 UTC (gap between windows)', () => {
    expect(isPeakHour(utc(3, 5))).toBe(false)
  })
  it('is NOT peak at Mon 04:30 UTC (gap between windows)', () => {
    expect(isPeakHour(utc(1, 4, 30))).toBe(false)
  })

  // Off-peak hours outside both windows
  it('is NOT peak at Mon 11:00 UTC', () => {
    expect(isPeakHour(utc(1, 11))).toBe(false)
  })
  it('is NOT peak at Fri 23:59 UTC', () => {
    expect(isPeakHour(utc(5, 23, 59))).toBe(false)
  })

  // Weekends are always off-peak
  it('is NOT peak at Sat 02:00 UTC (weekend window 1 hour)', () => {
    expect(isPeakHour(utc(6, 2))).toBe(false)
  })
  it('is NOT peak at Sun 08:00 UTC (weekend window 2 hour)', () => {
    expect(isPeakHour(utc(0, 8))).toBe(false)
  })

  // Boundary: exactly at the start/end of each window
  it('is peak at exactly 01:00 UTC', () => {
    expect(isPeakHour(utc(2, 1, 0))).toBe(true)
  })
  it('is NOT peak at exactly 04:00 UTC', () => {
    expect(isPeakHour(utc(2, 4, 0))).toBe(false)
  })
  it('is peak at exactly 06:00 UTC', () => {
    expect(isPeakHour(utc(2, 6, 0))).toBe(true)
  })
  it('is NOT peak at exactly 10:00 UTC', () => {
    expect(isPeakHour(utc(2, 10, 0))).toBe(false)
  })
})

// ─── nextTransition ─────────────────────────────────────────────────────────

describe('nextTransition', () => {
  it('from off-peak at Mon 00:30 UTC → next is peak at 01:00 UTC', () => {
    const from = utc(1, 0, 30)
    const { isPeak, at } = nextTransition(from)
    expect(isPeak).toBe(true)
    expect(at.getUTCHours()).toBe(1)
    expect(at.getUTCMinutes()).toBe(0)
  })

  it('from peak at Mon 02:00 UTC → next is off-peak at 04:00 UTC', () => {
    const from = utc(1, 2)
    const { isPeak, at } = nextTransition(from)
    expect(isPeak).toBe(false)
    expect(at.getUTCHours()).toBe(4)
  })

  it('from off-peak at Mon 04:30 UTC → next is peak at 06:00 UTC', () => {
    const from = utc(1, 4, 30)
    const { isPeak, at } = nextTransition(from)
    expect(isPeak).toBe(true)
    expect(at.getUTCHours()).toBe(6)
  })

  it('from peak at Mon 08:00 UTC → next is off-peak at 10:00 UTC', () => {
    const from = utc(1, 8)
    const { isPeak, at } = nextTransition(from)
    expect(isPeak).toBe(false)
    expect(at.getUTCHours()).toBe(10)
  })

  it('from off-peak Saturday → next transition is Monday 01:00 UTC', () => {
    const from = utc(6, 12) // Sat 12:00 UTC
    const { isPeak, at } = nextTransition(from)
    expect(isPeak).toBe(true)
    expect(at.getUTCDay()).toBe(1) // Monday
    expect(at.getUTCHours()).toBe(1)
  })
})

// ─── formatTransitionTime ────────────────────────────────────────────────────

describe('formatTransitionTime', () => {
  it('formats midnight as 00:00 UTC', () => {
    expect(formatTransitionTime(utc(1, 0))).toBe('00:00 UTC')
  })
  it('formats 01:00 UTC', () => {
    expect(formatTransitionTime(utc(1, 1))).toBe('01:00 UTC')
  })
  it('formats 10:30 UTC with correct padding', () => {
    expect(formatTransitionTime(utc(1, 10, 30))).toBe('10:30 UTC')
  })
  it('formats 23:59 UTC', () => {
    expect(formatTransitionTime(utc(1, 23, 59))).toBe('23:59 UTC')
  })
})
