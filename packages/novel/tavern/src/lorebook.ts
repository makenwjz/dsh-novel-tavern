/**
 * SillyTavern lorebook parsing and keyword activation. The parser accepts the
 * exported JSON shape (V2-style objects with `keys`, `content`, `constant`,
 * `selective`, `secondary_keys`, `insertion_order`, `enabled`,
 * `case_sensitive`, `comment`) and ignores unknown fields so future
 * SillyTavern exports keep importing. Structural damage fails loud.
 * @module @deepseek-ai/dsh-tavern/lorebook
 */

import type { Lorebook, LorebookEntry } from './types.ts'

/**
 * Parse and validate one SillyTavern lorebook export.
 * @param raw - the parsed JSON worldbook.
 * @returns the normalized lorebook.
 * @throws when the value is not an object, has no entries array, contains a
 * non-object entry, or carries a field of the wrong type.
 */
export function parseLorebook(raw: unknown): Lorebook {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('tavern: worldbook must be a JSON object')
  }
  const source = raw as Record<string, unknown>
  if (!Array.isArray(source.entries)) {
    throw new Error('tavern: worldbook must contain an entries array')
  }
  const name = typeof source.name === 'string' ? source.name : ''
  const entries = source.entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`tavern: worldbook entry ${index} must be an object`)
    }
    return parseEntry(entry as Record<string, unknown>, index)
  })
  return { name, entries }
}

/** Parse one entry, tolerating every missing or null field via defaults. */
function parseEntry(source: Record<string, unknown>, index: number): LorebookEntry {
  const stringField = (key: string, fallback: string): string => {
    const value = source[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error(`tavern: worldbook entry ${index} field ${JSON.stringify(key)} must be a string`)
    }
    return value === undefined || value === null ? fallback : value
  }
  const stringArray = (key: string, fallback: string[]): string[] => {
    const value = source[key]
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.every(item => typeof item === 'string'))) {
      throw new Error(`tavern: worldbook entry ${index} field ${JSON.stringify(key)} must be an array of strings`)
    }
    return value === undefined || value === null ? fallback : value
  }
  const booleanField = (key: string, fallback: boolean): boolean => {
    const value = source[key]
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      throw new Error(`tavern: worldbook entry ${index} field ${JSON.stringify(key)} must be a boolean`)
    }
    return value === undefined || value === null ? fallback : value
  }
  const insertionOrder = source.insertion_order
  if (insertionOrder !== undefined && insertionOrder !== null && typeof insertionOrder !== 'number') {
    throw new Error(`tavern: worldbook entry ${index} field "insertion_order" must be a number`)
  }
  const numberField = (key: string, fallback: number): number => {
    const value = source[key]
    if (value !== undefined && value !== null && typeof value !== 'number') {
      throw new Error(`tavern: worldbook entry ${index} field ${JSON.stringify(key)} must be a number`)
    }
    return value === undefined || value === null ? fallback : value
  }
  return {
    name: stringField('name', ''),
    keys: stringArray('keys', []),
    secondaryKeys: stringArray('secondary_keys', []),
    comment: stringField('comment', ''),
    content: stringField('content', ''),
    constant: booleanField('constant', false),
    selective: booleanField('selective', false),
    insertionOrder: insertionOrder ?? 0,
    enabled: booleanField('enabled', true),
    caseSensitive: booleanField('case_sensitive', false),
    stage: numberField('stage', 0),
  }
}

/** Whether one keyword occurs in the text under the entry's case mode. */
function contains(text: string, keyword: string, caseSensitive: boolean): boolean {
  return caseSensitive
    ? text.includes(keyword)
    : text.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Activate entries against one text window. Constant entries always
 * activate; other entries need a primary keyword, plus a secondary keyword
 * when selective. Results come back in `insertionOrder` (stable).
 *
 * `disabledNames` gates entries by their stored NAME: an entry whose name is
 * listed stays off regardless of keywords. Cards drive this per session to
 * switch story context (playthroughs, chapters) through their frontend.
 * @param entries - the entries to scan.
 * @param text - the text window to match against.
 * @param disabledNames - entry names this session keeps disabled.
 * @returns the activated entries with their matched primary keywords.
 */
export function activateEntries(
  entries: readonly LorebookEntry[],
  text: string,
  disabledNames?: readonly string[],
): Array<{ entry: LorebookEntry; matchedKeys: string[] }> {
  const disabled = new Set(disabledNames ?? [])
  const activated: Array<{ entry: LorebookEntry; matchedKeys: string[] }> = []
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (disabled.has(entry.name)) continue
    if (entry.constant) {
      activated.push({ entry, matchedKeys: [] })
      continue
    }
    const keys = entry.keys.filter(key => key.length > 0)
    if (keys.length === 0) continue
    const matchedKeys = keys.filter(key => contains(text, key, entry.caseSensitive))
    if (matchedKeys.length === 0) continue
    if (entry.selective) {
      const secondaries = entry.secondaryKeys.filter(key => key.length > 0)
      if (secondaries.length === 0) continue
      if (!secondaries.some(key => contains(text, key, entry.caseSensitive))) continue
    }
    activated.push({ entry, matchedKeys })
  }
  return activated.sort((a, b) => a.entry.insertionOrder - b.entry.insertionOrder)
}
