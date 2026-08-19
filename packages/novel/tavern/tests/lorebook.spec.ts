import { describe, expect, it } from 'vitest'
import { activateEntries, parseLorebook } from '../src/lorebook.ts'
import type { LorebookEntry } from '../src/types.ts'

/** One minimal valid entry factory for activation tests. */
function entry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    name: '',
    keys: [],
    secondaryKeys: [],
    comment: '',
    content: '',
    constant: false,
    selective: false,
    insertionOrder: 0,
    enabled: true,
    caseSensitive: false,
    stage: 0,
    ...overrides,
  }
}

describe('parseLorebook', () => {
  it('normalizes a full SillyTavern export', () => {
    const book = parseLorebook({
      name: '世界',
      entries: [{
        keys: ['青鸾', '青鸾山'],
        secondary_keys: ['灵兽'],
        comment: 'note',
        content: '青鸾是护山灵兽。',
        constant: false,
        selective: true,
        insertion_order: 3,
        enabled: true,
        case_sensitive: true,
        position: 'before_char',
        priority: 10,
        depth: 4,
        extensions: {},
      }],
      extensions: {},
    })
    expect(book.name).toBe('世界')
    expect(book.entries).toEqual([{
      name: '',
      keys: ['青鸾', '青鸾山'],
      secondaryKeys: ['灵兽'],
      comment: 'note',
      content: '青鸾是护山灵兽。',
      constant: false,
      selective: true,
      insertionOrder: 3,
      enabled: true,
      caseSensitive: true,
      stage: 0,
    }])
  })

  it('fills every missing entry field with the SillyTavern defaults', () => {
    const book = parseLorebook({ name: 'B', entries: [{}] })
    expect(book.entries[0]).toEqual(entry())
  })

  it('parses the activation stage and defaults it to zero', () => {
    expect(parseLorebook({ entries: [{ content: 'x', stage: 2 }] }).entries[0]?.stage).toBe(2)
    expect(parseLorebook({ entries: [{ content: 'x' }] }).entries[0]?.stage).toBe(0)
    expect(() => parseLorebook({ entries: [{ content: 'x', stage: 'two' }] })).toThrow(/stage/)
  })

  it('tolerates a missing or non-string book name', () => {
    expect(parseLorebook({ entries: [] }).name).toBe('')
    expect(parseLorebook({ name: 42, entries: [] }).name).toBe('')
  })

  it.each([
    { label: 'non-object', raw: 'x', failure: /must be a JSON object/ },
    { label: 'null', raw: null, failure: /must be a JSON object/ },
  ])('rejects $label', ({ raw, failure }) => {
    expect(() => parseLorebook(raw)).toThrow(failure)
  })

  it('rejects a missing entries array', () => {
    expect(() => parseLorebook({ name: 'B' })).toThrow(/must contain an entries array/)
    expect(() => parseLorebook({ name: 'B', entries: 42 })).toThrow(/must contain an entries array/)
  })

  it('rejects a non-object entry', () => {
    expect(() => parseLorebook({ entries: ['x'] })).toThrow(/entry 0 must be an object/)
  })

  it.each([
    { key: 'comment', value: 42 },
    { key: 'content', value: {} },
  ])('rejects a non-string $key', ({ key, value }) => {
    expect(() => parseLorebook({ entries: [{ [key]: value }] })).toThrow(/field ".*" must be a string/)
  })

  it.each([
    { key: 'keys', value: 'x' },
    { key: 'keys', value: [42] },
    { key: 'secondary_keys', value: [true] },
  ])('rejects a non-string-array $key', ({ key, value }) => {
    expect(() => parseLorebook({ entries: [{ [key]: value }] })).toThrow(/must be an array of strings/)
  })

  it.each([
    { key: 'constant', value: 1 },
    { key: 'selective', value: 'y' },
    { key: 'enabled', value: 0 },
  ])('rejects a non-boolean $key', ({ key, value }) => {
    expect(() => parseLorebook({ entries: [{ [key]: value }] })).toThrow(/must be a boolean/)
  })

  it('treats null entry fields as missing', () => {
    const book = parseLorebook({ entries: [{ keys: null, stage: null, insertion_order: null, content: null, case_sensitive: null }] })
    expect(book.entries[0]).toEqual(entry())
  })

  it('rejects a non-number insertion_order', () => {
    expect(() => parseLorebook({ entries: [{ insertion_order: 'x' }] })).toThrow(/insertion_order.*must be a number/)
  })
})

describe('activateEntries', () => {
  const text = '青鸾飞过灵兽山，护山剑醒来。'

  it('activates constant entries without keywords', () => {
    expect(activateEntries([entry({ constant: true, content: 'c' })], 'anything'))
      .toEqual([{ entry: entry({ constant: true, content: 'c' }), matchedKeys: [] }])
  })

  it('activates on a case-insensitive keyword match by default', () => {
    expect(activateEntries([entry({ keys: ['青鸾'] })], text).map(match => match.matchedKeys))
      .toEqual([['青鸾']])
  })

  it('matches case-sensitively when requested', () => {
    expect(activateEntries([entry({ keys: ['青鸾'], caseSensitive: true })], '青鸾')).toHaveLength(1)
    expect(activateEntries([entry({ keys: ['Aya'], caseSensitive: true })], 'aya')).toHaveLength(0)
    expect(activateEntries([entry({ keys: ['Aya'], caseSensitive: false })], 'aya')).toHaveLength(1)
  })

  it('skips disabled entries, empty-key entries, and unmatched entries', () => {
    expect(activateEntries([
      entry({ enabled: false, keys: ['青鸾'] }),
      entry({ keys: [] }),
      entry({ keys: ['不存在'] }),
    ], text)).toEqual([])
  })

  it('requires a secondary keyword for selective entries', () => {
    const selective = entry({ keys: ['青鸾'], secondaryKeys: ['灵兽'], selective: true })
    expect(activateEntries([selective], text)).toHaveLength(1)
    expect(activateEntries([selective], '青鸾')).toHaveLength(0)
    expect(activateEntries([entry({ keys: ['青鸾'], secondaryKeys: [], selective: true })], text)).toHaveLength(0)
  })

  it('orders activated entries by insertion_order, stably', () => {
    const first = entry({ keys: ['青鸾'], insertionOrder: 2, content: 'a' })
    const second = entry({ keys: ['青鸾'], insertionOrder: 1, content: 'b' })
    const third = entry({ keys: ['青鸾'], insertionOrder: 1, content: 'c' })
    expect(activateEntries([first, second, third], text).map(match => match.entry.content)).toEqual(['b', 'c', 'a'])
  })

  it('reports every matched primary keyword', () => {
    expect(activateEntries([entry({ keys: ['青鸾', '灵兽', '剑'] })], text).map(match => match.matchedKeys))
      .toEqual([['青鸾', '灵兽', '剑']])
  })
})
