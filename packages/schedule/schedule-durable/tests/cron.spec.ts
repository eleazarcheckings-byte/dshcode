import { describe, expect, it } from 'vitest'
import { CronParseError, nextFireAfter, parseCron, toUtcInstant } from '../src/cron.ts'

/** Compute the next fire and render it as a UTC instant, for terse assertions. */
function next(expression: string, afterIso: string): string | undefined {
  const ms = nextFireAfter(parseCron(expression), Date.parse(afterIso))
  return ms === undefined ? undefined : toUtcInstant(ms)
}

describe('parseCron', () => {
  it('rejects an expression without exactly 5 fields', () => {
    expect(() => parseCron('* * * *')).toThrow(CronParseError)
    expect(() => parseCron('* * * * * *')).toThrow(CronParseError)
  })

  it('rejects an out-of-bound term', () => {
    expect(() => parseCron('60 * * * *')).toThrow(CronParseError)
    expect(() => parseCron('* 24 * * *')).toThrow(CronParseError)
    expect(() => parseCron('* * 32 * *')).toThrow(CronParseError)
    expect(() => parseCron('* * * 13 *')).toThrow(CronParseError)
    expect(() => parseCron('* * * * 8')).toThrow(CronParseError)
  })

  it('rejects a reversed range and an invalid step', () => {
    expect(() => parseCron('10-5 * * * *')).toThrow(CronParseError)
    expect(() => parseCron('*/0 * * * *')).toThrow(CronParseError)
    expect(() => parseCron('*/abc * * * *')).toThrow(CronParseError)
  })

  it('folds day-of-week 7 onto 0 (Sunday)', () => {
    const parsed = parseCron('0 0 * * 7')
    expect(parsed.dayOfWeek.values.has(0)).toBe(true)
    expect(parsed.dayOfWeek.values.has(7)).toBe(false)
  })
})

describe('nextFireAfter', () => {
  it('advances to the next matching minute for a wildcard expression', () => {
    expect(next('* * * * *', '2026-09-16T12:00:00.000Z')).toBe('2026-09-16T12:01:00.000Z')
  })

  it('handles an explicit minute/hour target on the same day', () => {
    expect(next('30 9 * * *', '2026-09-16T00:00:00.000Z')).toBe('2026-09-16T09:30:00.000Z')
  })

  it('rolls to the next day once the target time has passed', () => {
    expect(next('30 9 * * *', '2026-09-16T09:30:00.000Z')).toBe('2026-09-17T09:30:00.000Z')
  })

  it('supports a step value', () => {
    expect(next('*/15 * * * *', '2026-09-16T12:01:00.000Z')).toBe('2026-09-16T12:15:00.000Z')
  })

  it('supports an every-other-day-of-week list', () => {
    // 2026-09-16 is a Wednesday (day-of-week 3); "Mon,Wed,Fri" is 1,3,5.
    expect(next('0 0 * * 1,3,5', '2026-09-16T00:00:00.000Z')).toBe('2026-09-18T00:00:00.000Z')
  })

  it('skips a month that has no matching day-of-month (month-end edge case)', () => {
    // The 31st only exists in some months; from April 1 (30-day month) the
    // next 31st is May 31, not April 31.
    expect(next('0 0 31 * *', '2026-04-01T00:00:00.000Z')).toBe('2026-05-31T00:00:00.000Z')
  })

  it('joins day-of-month and day-of-week with OR when both restrict', () => {
    // The 1st of the month OR a Monday: 2026-09-01 is a Tuesday (not the
    // 1st-Monday case), so from 2026-09-02 the next match is the next Monday
    // (2026-09-07), which arrives before the next 1st-of-month (2026-10-01).
    expect(next('0 0 1 * 1', '2026-09-02T00:00:00.000Z')).toBe('2026-09-07T00:00:00.000Z')
  })

  it('reaches February 29 only on a leap year', () => {
    expect(next('0 0 29 2 *', '2025-03-01T00:00:00.000Z')).toBe('2028-02-29T00:00:00.000Z')
  })

  it('reports unreachable for a day-of-month that never occurs in its restricted month', () => {
    // February never has a 30th.
    expect(next('0 0 30 2 *', '2026-01-01T00:00:00.000Z')).toBeUndefined()
  })
})
