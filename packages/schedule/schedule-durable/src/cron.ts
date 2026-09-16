/**
 * Self-contained 5-field cron parsing and UTC next-fire computation. No
 * external cron dependency: the grammar and the next-fire search are both
 * implemented in this module.
 * @module @deepseek-ai/dsh-schedule-durable/src/cron
 */

/** Raised for a syntactically or semantically invalid cron expression. */
export class CronParseError extends Error {
  readonly code = 'invalid_cron' as const

  constructor(message: string) {
    super(message)
    this.name = 'CronParseError'
  }
}

/** One parsed field: the closed set of admitted values within its bounds. */
interface CronField {
  readonly values: ReadonlySet<number>
}

/** A fully parsed 5-field cron expression, ready for next-fire search. */
export interface ParsedCron {
  readonly minute: CronField
  readonly hour: CronField
  readonly dayOfMonth: CronField
  readonly month: CronField
  readonly dayOfWeek: CronField
  /** Whether the day-of-month field restricts (is not `*`); governs the standard OR-join with day-of-week. */
  readonly domRestricted: boolean
  /** Whether the day-of-week field restricts (is not `*`). */
  readonly dowRestricted: boolean
}

/** How far past `afterMs` the next-fire search looks before giving up on an unreachable rule. */
export const CRON_SEARCH_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000

const FIELD_BOUNDS = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
} as const

/** Parse one comma-separated cron field into its closed value set. */
function parseField(raw: string, name: keyof typeof FIELD_BOUNDS): CronField {
  const [min, max] = FIELD_BOUNDS[name]
  const values = new Set<number>()
  const parts = raw.split(',').map(part => part.trim()).filter(part => part.length > 0)
  if (parts.length === 0) throw new CronParseError(`cron field '${name}' must not be empty`)
  for (const part of parts) {
    const stepMatch = /^(?<range>\*|\d+(?:-\d+)?)\/(?<step>\d+)$/.exec(part)
    const rangeSource = stepMatch ? stepMatch.groups?.range : part
    const step = stepMatch ? Number.parseInt(stepMatch.groups?.step ?? '', 10) : 1
    if (stepMatch && (!Number.isInteger(step) || step <= 0)) {
      throw new CronParseError(`cron field '${name}' has an invalid step in '${part}'`)
    }
    let lo: number
    let hi: number
    if (rangeSource === '*') {
      lo = min
      hi = max
    } else {
      const rangeMatch = /^(?<lo>\d+)(?:-(?<hi>\d+))?$/.exec(rangeSource ?? '')
      if (!rangeMatch?.groups || rangeMatch.groups.lo === undefined) {
        throw new CronParseError(`cron field '${name}' has an invalid term '${part}'`)
      }
      lo = Number.parseInt(rangeMatch.groups.lo, 10)
      hi = rangeMatch.groups.hi === undefined ? lo : Number.parseInt(rangeMatch.groups.hi, 10)
    }
    if (lo > hi) throw new CronParseError(`cron field '${name}' has a reversed range in '${part}'`)
    if (lo < min || hi > max) {
      throw new CronParseError(`cron field '${name}' term '${part}' is outside its ${min}-${max} bound`)
    }
    for (let value = lo; value <= hi; value += step) {
      values.add(name === 'dayOfWeek' && value === 7 ? 0 : value)
    }
  }
  return { values }
}

/**
 * Parse a standard 5-field cron expression (`minute hour day-of-month month day-of-week`).
 * @param expression - the raw expression; exactly five whitespace-separated fields.
 * @returns the parsed field set, ready for {@link nextFireAfter}.
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new CronParseError(`cron expression must have exactly 5 fields, got ${fields.length}`)
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields as [string, string, string, string, string]
  return {
    minute: parseField(minuteRaw, 'minute'),
    hour: parseField(hourRaw, 'hour'),
    dayOfMonth: parseField(domRaw, 'dayOfMonth'),
    month: parseField(monthRaw, 'month'),
    dayOfWeek: parseField(dowRaw, 'dayOfWeek'),
    domRestricted: domRaw.trim() !== '*',
    dowRestricted: dowRaw.trim() !== '*',
  }
}

/** Whether one UTC-minute candidate's calendar day matches the day-of-month/day-of-week rule (standard cron OR-join when both restrict). */
function dayMatches(parsed: ParsedCron, candidate: Date): boolean {
  const domMatch = parsed.dayOfMonth.values.has(candidate.getUTCDate())
  const dowMatch = parsed.dayOfWeek.values.has(candidate.getUTCDay())
  if (parsed.domRestricted && parsed.dowRestricted) return domMatch || dowMatch
  if (parsed.domRestricted) return domMatch
  if (parsed.dowRestricted) return dowMatch
  return true
}

/**
 * Compute the earliest UTC instant strictly after `afterMs` that satisfies every field of `parsed`.
 * Searches minute-granularity candidates but fast-forwards whole months, days, and hours that
 * cannot match, so an unreachable rule (e.g. day-of-month 31 restricted to a 30-day month set)
 * still terminates within {@link CRON_SEARCH_HORIZON_MS}.
 * @param parsed - a cron expression parsed by {@link parseCron}.
 * @param afterMs - exclusive lower bound, epoch milliseconds.
 * @returns the next matching instant in epoch milliseconds, or `undefined` when none exists within the horizon.
 */
export function nextFireAfter(parsed: ParsedCron, afterMs: number): number | undefined {
  const boundMs = afterMs + CRON_SEARCH_HORIZON_MS
  let candidateMs = Math.floor(afterMs / 60_000) * 60_000 + 60_000
  while (candidateMs <= boundMs) {
    const candidate = new Date(candidateMs)
    const month = candidate.getUTCMonth() + 1
    if (!parsed.month.values.has(month)) {
      candidateMs = Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 1, 0, 0, 0, 0)
      continue
    }
    if (!dayMatches(parsed, candidate)) {
      candidateMs = Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate() + 1, 0, 0, 0, 0)
      continue
    }
    if (!parsed.hour.values.has(candidate.getUTCHours())) {
      candidateMs = Date.UTC(
        candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), candidate.getUTCHours() + 1, 0, 0, 0,
      )
      continue
    }
    if (!parsed.minute.values.has(candidate.getUTCMinutes())) {
      candidateMs += 60_000
      continue
    }
    return candidateMs
  }
  return undefined
}

/** Render a UTC epoch-millisecond instant as a four-digit-year RFC 3339 string with millisecond precision. */
export function toUtcInstant(ms: number): string {
  return new Date(ms).toISOString()
}
