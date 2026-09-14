/**
 * DeepSeek API pricing schedule helpers — pure, client-side, UTC clock only.
 *
 * Peak windows (UTC, Mon–Fri only):
 *   01:00 – 04:00  and  06:00 – 10:00
 * All other times, including full weekends, are off-peak (≈ half price).
 *
 * Source: DeepSeek official pricing FAQ.
 */

/**
 * Returns `true` when `date` falls inside a DeepSeek API peak pricing window.
 *
 * Only the UTC weekday and UTC hour matter — minutes and seconds are ignored so
 * the function is stable across the full first minute of each boundary hour.
 *
 * @param date - Any Date; evaluated in UTC.
 */
export function isPeakHour(date: Date): boolean {
  const day = date.getUTCDay() // 0 = Sunday … 6 = Saturday
  // Weekends are never peak.
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  // Window 1: 01:00 ≤ h < 04:00
  if (hour >= 1 && hour < 4) return true
  // Window 2: 06:00 ≤ h < 10:00
  if (hour >= 6 && hour < 10) return true
  return false
}

/**
 * Returns the **next** pricing-state transition after `date` and whether the
 * new state is peak (`isPeak: true`) or off-peak (`isPeak: false`).
 *
 * Walks forward in 1-minute steps until the state flips, so the returned `at`
 * is the first full minute of the new window — accurate enough for a tooltip.
 *
 * @param date - Reference point (typically `new Date()`).
 */
export function nextTransition(date: Date): { isPeak: boolean; at: Date } {
  const STEP_MS = 60 * 1000 // 1 minute
  const current = isPeakHour(date)
  let cursor = new Date(date.getTime() + STEP_MS)
  // Cap at 7 days to avoid an infinite loop if the schedule is somehow broken.
  const limit = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000)
  while (isPeakHour(cursor) === current && cursor < limit) {
    cursor = new Date(cursor.getTime() + STEP_MS)
  }
  return { isPeak: !current, at: cursor }
}

/**
 * Formats a Date as a compact UTC time string: `"HH:MM UTC"`.
 * Used in the peak-indicator tooltip to show when the next switch occurs.
 *
 * @param date - The transition time returned by {@link nextTransition}.
 */
export function formatTransitionTime(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0')
  const m = date.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m} UTC`
}
