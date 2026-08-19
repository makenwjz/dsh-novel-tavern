import { describe, expect, it } from 'vitest'
import {
  compareStoryTime,
  displayStoryTime,
  parseDisplayStoryTime,
  parseStoryTime,
  serializeStoryTime,
  validateStoryTime,
} from '../src/story-time.ts'

describe('story-time serialization', () => {
  it('serializes positive, negative, and epoch-zero years with fixed width', () => {
    expect(serializeStoryTime({ year: 2026, month: 1, day: 15 })).toBe('102026.01.15')
    expect(serializeStoryTime({ year: -100, month: 12, day: 31 })).toBe('099900.12.31')
    expect(serializeStoryTime({ year: 0, month: 3, day: 5 })).toBe('100000.03.05')
    expect(serializeStoryTime({ year: 99999, month: 9, day: 9 })).toBe('199999.09.09')
    expect(serializeStoryTime({ year: -99999, month: 1, day: 1 })).toBe('000001.01.01')
  })

  it('round-trips through parse', () => {
    const time = { year: -12, month: 11, day: 30 }
    expect(parseStoryTime(serializeStoryTime(time))).toEqual(time)
  })

  it.each([
    ['missing day', '102026.01'],
    ['short day', '102026.01.1'],
    ['short year', '10202.01.01'],
    ['non-digit year', 'x02026.01.01'],
    ['extra text', '102026.01.15x'],
  ])('rejects a malformed form: %s', (_label, serialized) => {
    expect(() => parseStoryTime(serialized)).toThrow(/malformed story time/)
  })

  it.each([
    ['non-integer year', { year: 2020.5, month: 1, day: 1 }],
    ['overflowing year', { year: 100_000, month: 1, day: 1 }],
    ['too-small year', { year: -100_000, month: 1, day: 1 }],
    ['month zero', { year: 2020, month: 0, day: 1 }],
    ['month thirteen', { year: 2020, month: 13, day: 1 }],
    ['day zero', { year: 2020, month: 1, day: 0 }],
    ['day thirty-two', { year: 2020, month: 1, day: 32 }],
  ])('rejects %s', (_label, time) => {
    expect(() => { validateStoryTime(time) }).toThrow(/novel: story/)
    expect(() => { serializeStoryTime(time) }).toThrow(/novel: story/)
  })

  it('compares story times by their serialized order', () => {
    const earlier = { year: 2020, month: 12, day: 31 }
    const later = { year: 2021, month: 1, day: 1 }
    const beforeEpoch = { year: -1, month: 1, day: 1 }
    expect(compareStoryTime(earlier, later)).toBe(-1)
    expect(compareStoryTime(later, earlier)).toBe(1)
    expect(compareStoryTime(earlier, earlier)).toBe(0)
    expect(compareStoryTime(beforeEpoch, earlier)).toBe(-1)
    expect(compareStoryTime(earlier, beforeEpoch)).toBe(1)
    expect(compareStoryTime(beforeEpoch, { year: 0, month: 1, day: 1 })).toBe(-1)
  })

  it('displays story times unpadded for humans', () => {
    expect(displayStoryTime({ year: -12, month: 11, day: 3 })).toBe('-12.11.03')
    expect(displayStoryTime({ year: 2026, month: 2, day: 5 })).toBe('2026.02.05')
  })

  it('round-trips through display parsing', () => {
    const time = { year: -12, month: 11, day: 30 }
    expect(parseDisplayStoryTime(displayStoryTime(time))).toEqual(time)
    expect(parseDisplayStoryTime('1200.01.01')).toEqual({ year: 1200, month: 1, day: 1 })
    expect(parseDisplayStoryTime('-99999.12.31')).toEqual({ year: -99999, month: 12, day: 31 })
  })

  it.each([
    ['missing day', '1200.01'],
    ['short day', '1200.01.1'],
    ['non-digit year', 'x200.01.01'],
    ['seven-digit year', '1200000.01.01'],
    ['extra text', '1200.01.01x'],
  ])('rejects a malformed display form: %s', (_label, display) => {
    expect(() => parseDisplayStoryTime(display)).toThrow(/malformed story time/)
  })

  it('rejects an overflowing display year through validation', () => {
    expect(() => parseDisplayStoryTime('100000.01.01')).toThrow(/novel: story/)
  })
})
