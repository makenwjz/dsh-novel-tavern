/**
 * Story-time serialization: a fixed-width, lexicographically sortable text
 * form of {@link StoryTime}. The year is stored offset-encoded — `year + 10^5`
 * as six zero-padded digits (`+` sorts before digits, so a signed form cannot
 * order pre-epoch years first) — followed by `.MM.DD`. Every representable
 * year maps to exactly one six-digit offset, so text order equals story order.
 * @module @deepseek-ai/dsh-novel/story-time
 */

import type { StoryTime } from './types.ts'

/** Width of the year field; bounds the representable range to ±99 999. */
export const YEAR_WIDTH = 6
/** Encoded-year offset: serialized year = story year + this value. */
const YEAR_OFFSET = 10 ** (YEAR_WIDTH - 1)
/** Bound of the representable year range: ±(10^5 − 1). */
const YEAR_BOUND = YEAR_OFFSET - 1

/**
 * Validate a story time. Rejects non-integers, out-of-range months or days,
 * and years that overflow the fixed-width serialization; the calendar itself
 * is not validated (February 31 is a legal story position).
 * @param time - the story time to validate.
 * @throws when any field violates the domain bounds.
 */
export function validateStoryTime(time: StoryTime): void {
  if (!Number.isInteger(time.year) || Math.abs(time.year) > YEAR_BOUND) {
    throw new Error(`novel: story year must be an integer within ±${YEAR_BOUND}`)
  }
  if (!Number.isInteger(time.month) || time.month < 1 || time.month > 12) {
    throw new Error('novel: story month must be an integer between 1 and 12')
  }
  if (!Number.isInteger(time.day) || time.day < 1 || time.day > 31) {
    throw new Error('novel: story day must be an integer between 1 and 31')
  }
}

/**
 * Serialize a story time into its sortable text form.
 * @param time - the story time to serialize (validated).
 * @returns the fixed-width `YYYYYY.MM.DD` string with the offset-encoded
 *   year.
 */
export function serializeStoryTime(time: StoryTime): string {
  validateStoryTime(time)
  const year = (time.year + YEAR_OFFSET).toString().padStart(YEAR_WIDTH, '0')
  const month = time.month.toString().padStart(2, '0')
  const day = time.day.toString().padStart(2, '0')
  return `${year}.${month}.${day}`
}

/**
 * Parse a serialized story time back into its parts.
 * @param serialized - the `YYYYYY.MM.DD` form produced by
 *   {@link serializeStoryTime}.
 * @returns the parsed story time.
 * @throws when the text is not a well-formed serialized story time.
 */
export function parseStoryTime(serialized: string): StoryTime {
  const match = /^(\d{6})\.(\d{2})\.(\d{2})$/.exec(serialized)
  if (!match) {
    throw new Error(`novel: malformed story time ${JSON.stringify(serialized)}`)
  }
  const time: StoryTime = { year: Number(match[1]) - YEAR_OFFSET, month: Number(match[2]), day: Number(match[3]) }
  validateStoryTime(time)
  return time
}

/**
 * Parse a display-form story time back into its parts.
 * @param display - the `±YYYY.MM.DD` form produced by
 *   {@link displayStoryTime}.
 * @returns the parsed story time.
 * @throws when the text is not a well-formed display story time or violates
 *   the domain bounds.
 */
export function parseDisplayStoryTime(display: string): StoryTime {
  const match = /^(-?\d{1,6})\.(\d{2})\.(\d{2})$/.exec(display)
  if (!match) {
    throw new Error(`novel: malformed story time ${JSON.stringify(display)}`)
  }
  const time: StoryTime = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  validateStoryTime(time)
  return time
}

/**
 * Compare two story times; a negative result means `a` precedes `b`.
 * @param a - the left story time.
 * @param b - the right story time.
 * @returns a negative, zero, or positive number.
 */
export function compareStoryTime(a: StoryTime, b: StoryTime): number {
  const left = serializeStoryTime(a)
  const right = serializeStoryTime(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Render a story time for humans: `±YYYY.MM.DD` with the year unpadded.
 * @param time - the story time to display.
 * @returns the display form.
 */
export function displayStoryTime(time: StoryTime): string {
  validateStoryTime(time)
  return `${time.year}.${time.month.toString().padStart(2, '0')}.${time.day.toString().padStart(2, '0')}`
}
