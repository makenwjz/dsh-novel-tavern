/**
 * The interop calendar: how DSH story times map onto neuro-book instants.
 *
 * neuro-book's World Engine stores `instant` as a 64-bit integer (seconds).
 * This module defines a deterministic, lossless convention for interop only:
 * a day is 86400 seconds, a year is 372 days, a month is 31 days, and the
 * story's epoch year 0 is instant 0. Import and export both use it, so any
 * round trip through the same convention is exact. Real neuro-book projects
 * may use any calendar; interop treats the day-number encoding as the common
 * exchange form and documents it in the export report.
 * @module @deepseek-ai/dsh-novel/nb/calendar
 */

import type { StoryTime } from '../types.ts'

const DAY_SECONDS = 86400n
const DAYS_PER_MONTH = 31
const DAYS_PER_YEAR = 372

/** The day number of one story time under the interop calendar. */
export function dayNumber(time: StoryTime): number {
  return time.year * DAYS_PER_YEAR + (time.month - 1) * DAYS_PER_MONTH + (time.day - 1)
}

/** Convert one story time to the interop instant (seconds since epoch year 0). */
export function storyTimeToInstant(time: StoryTime): bigint {
  return BigInt(dayNumber(time)) * DAY_SECONDS
}

/** Convert one interop instant back to a story time. */
export function instantToStoryTime(instant: bigint): StoryTime {
  const days = Number(instant / DAY_SECONDS)
  const year = Math.floor(days / DAYS_PER_YEAR)
  const rest = days - year * DAYS_PER_YEAR
  const month = Math.floor(rest / DAYS_PER_MONTH) + 1
  const day = (rest % DAYS_PER_MONTH) + 1
  return { year, month, day }
}
