/**
 * Character card parsing. Cards arrive as a JSON file or a PNG carrying the
 * JSON in a `chara` (V2) or `ccv3` (V3) text chunk. Both V3-shaped cards
 * (`name`, `description`, `first_mes`, ...) and legacy SillyTavern V2 cards
 * (`char_name`, `char_persona`, `char_greeting`, `world_scenario`,
 * `example_dialogue`) are accepted, as are `{ spec, data }` envelopes (the V3
 * JSON export shape). Validation is lenient on optional fields: a wrong-typed
 * value is coerced or dropped instead of failing the whole card, so dirty
 * real-world exports keep importing. Only a non-object payload and a card
 * without any non-blank name (after the V2 fallback) fail loud.
 * @module @deepseek-ai/dsh-tavern/character
 */

import type { CharacterProfile } from './types.ts'
import { inflateSync } from 'node:zlib'
import { extractTextChunk, type PngTextChunk } from './png.ts'

/** String card fields and their empty default. */
const STRING_FIELDS = {
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  system_prompt: '',
  post_history_instructions: '',
  creator: '',
  character_version: '',
} as const

/**
 * Legacy V2 field names mapped onto their V3 equivalents. Old SillyTavern
 * cards carry only these keys; mapping them keeps the projected profile
 * V3-shaped and lets the prompt section render legacy cards fully.
 */
const V2_ALIASES: Readonly<Record<string, keyof typeof STRING_FIELDS>> = {
  char_persona: 'description',
  char_greeting: 'first_mes',
  world_scenario: 'scenario',
  example_dialogue: 'mes_example',
}

/** Reverse lookup: V3 field name → the V2 alias that fills it when the V3 key is absent. */
const V3_TO_V2_ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(V2_ALIASES).map(([alias, target]) => [target, alias]),
)

/** The character name the `{{user}}` macro substitutes to. */
export const USER_MACRO = '用户'

/**
 * Unwrap a `{ spec, data }` envelope (the V3 JSON export shape) when present.
 * The `spec` value itself is not inspected: any export that wraps the card in
 * a `data` object is accepted, matching the tolerance of the PNG path.
 * @param source - the parsed card JSON.
 * @returns the card object to project.
 */
function unwrapEnvelope(source: Record<string, unknown>): Record<string, unknown> {
  const data = source.data
  if (typeof source.spec === 'string' && data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return source
}

/**
 * Read one optional string field, preferring the V3 key over its V2 alias.
 * Wrong-typed values are coerced to their text form instead of failing.
 */
function readString(source: Record<string, unknown>, key: keyof typeof STRING_FIELDS): string {
  const alias = V3_TO_V2_ALIAS[key]
  const value = alias === undefined ? source[key] : source[key] ?? source[alias]
  if (value === undefined || value === null) return STRING_FIELDS[key]
  return typeof value === 'string' ? value : String(value)
}

/** Read one optional string-array field; non-string items are dropped. */
function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Read the MVU status variables from `extensions.mvu.variables`. Anything
 * but a plain object at any nesting level is ignored rather than failing.
 */
function readMvuVariables(source: Record<string, unknown>): Record<string, string> {
  const extensions = source.extensions
  if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions)) return {}
  const mvu = (extensions as Record<string, unknown>).mvu
  if (mvu === null || typeof mvu !== 'object' || Array.isArray(mvu)) return {}
  const variables = (mvu as Record<string, unknown>).variables
  if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(variables)) {
    result[key] = typeof value === 'string' ? value : String(value)
  }
  return result
}

/** Resolve the card name, falling back to the V2 `char_name` key. */
function readName(source: Record<string, unknown>): string {
  const raw = source.name ?? source.char_name
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('tavern: character card must carry a non-empty name')
  }
  return raw.trim()
}

/**
 * Parse and validate one character card JSON.
 * @param raw - the parsed card JSON.
 * @returns the projected profile.
 * @throws when the value is not an object or the card carries no name.
 */
export function parseCharacterJson(raw: unknown): CharacterProfile {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('tavern: character card must be a JSON object')
  }
  const source = unwrapEnvelope(raw as Record<string, unknown>)
  return {
    name: readName(source),
    description: readString(source, 'description'),
    personality: readString(source, 'personality'),
    scenario: readString(source, 'scenario'),
    firstMes: readString(source, 'first_mes'),
    mesExample: readString(source, 'mes_example'),
    systemPrompt: readString(source, 'system_prompt'),
    postHistoryInstructions: readString(source, 'post_history_instructions'),
    alternateGreetings: readStringArray(source, 'alternate_greetings'),
    tags: readStringArray(source, 'tags'),
    creator: readString(source, 'creator'),
    characterVersion: readString(source, 'character_version'),
    mvuVariables: readMvuVariables(source),
  }
}

/**
 * Parse one PNG character card. V2 cards store the JSON in a `chara` chunk;
 * V3 cards store a `{ spec: 'chara_card_v3', data: {...} }` envelope in a
 * `ccv3` chunk. The envelope is unwrapped by {@link parseCharacterJson}, so
 * both shapes and every `{ spec, data }` variant resolve the same way.
 * @param buf - the PNG file bytes.
 * @returns the projected profile.
 * @throws when no card chunk exists, its payload is not JSON, or the card
 * itself is invalid.
 */
export function parseCharacterPng(buf: Uint8Array): CharacterProfile {
  return parseCharacterJson(parseCharacterPngRaw(buf))
}

/**
 * Parse one PNG card and return the raw card JSON (before projection), so the
 * importer can reach the embedded worldbook and other tool-era fields the
 * profile does not carry.
 * @param buf - the PNG file bytes.
 * @returns the parsed card JSON.
 * @throws when no card chunk exists or its payload is not JSON.
 */
export function parseCharacterPngRaw(buf: Uint8Array): unknown {
  const v3 = extractTextChunk(buf, 'ccv3')
  const v2 = v3 === null ? extractTextChunk(buf, 'chara') : null
  const chunk = v3 ?? v2
  if (chunk === null) {
    throw new Error('tavern: PNG character card carries no chara or ccv3 text chunk')
  }
  return parseCardJson(chunk)
}

/**
 * Extract the worldbook embedded in a card: the V3 `character_book` field or
 * the legacy `extensions.world_book` object. `{ spec, data }` envelopes are
 * unwrapped first, since cards arrive either flat or enveloped.
 * @param raw - the parsed card JSON.
 * @returns the embedded worldbook, or null when the card carries none.
 */
export function extractEmbeddedWorldBook(raw: unknown): { name: string; entries: unknown[] } | null {
  if (typeof raw !== 'object' || raw === null) return null
  let source = raw as Record<string, unknown>
  if (typeof source.spec === 'string' && source.data !== null && typeof source.data === 'object' && !Array.isArray(source.data)) {
    source = source.data as Record<string, unknown>
  }
  const extensions = (source.extensions ?? {}) as Record<string, unknown>
  const book = source.character_book ?? extensions.world_book
  if (typeof book !== 'object' || book === null) return null
  const candidate = book as Record<string, unknown>
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return null
  return {
    name: typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : 'character book',
    entries: candidate.entries,
  }
}

/**
 * Parse one text chunk's payload as the card JSON, trying a chain of
 * decodings: some non-conformant exporters write the deflated bytes inside a
 * `tEXt` chunk, or encode the JSON as UTF-16, or leave a BOM. Every fallback
 * is attempted before failing loud.
 * @param chunk - the decoded text chunk.
 * @returns the parsed card JSON.
 * @throws when every decoding fails to produce valid JSON.
 */
function parseCardJson(chunk: PngTextChunk): unknown {
  const direct = tryJson(chunk.text)
  if (direct !== undefined) return direct
  const trimmed = tryJson(chunk.text.replace(/^\uFEFF/, '').trim())
  if (trimmed !== undefined) return trimmed
  // Some exporters base64-encode the card JSON inside the text chunk. Only
  // attempt base64 when the text is strictly base64-shaped (alphabet plus
  // whitespace, length a multiple of 4), so the fallback never mangles a
  // UTF-16 or binary payload that merely decodes to garbage.
  const base64Text = chunk.text.replace(/\s+/g, '')
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64Text) && base64Text.length % 4 === 0) {
    const base64 = tryJson(() => Buffer.from(base64Text, 'base64').toString('utf-8'))
    if (base64 !== undefined) return base64
  }
  // The tEXt reader falls back to Latin-1 for binary payloads; mapping the
  // decoded text back through Latin-1 recovers the exact stored bytes, so a
  // deflate stream hidden in a tEXt chunk can still be inflated.
  const bytes = Buffer.from(chunk.text, 'latin1')
  const deflated = tryJson(() => new TextDecoder('utf-8').decode(inflateSync(bytes)))
  if (deflated !== undefined) return deflated
  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    const utf16 = tryJson(() => new TextDecoder(encoding).decode(bytes))
    if (utf16 !== undefined) return utf16
  }
  throw new Error(`tavern: PNG character card chunk ${JSON.stringify(chunk.keyword)} is not valid JSON`)
}

/** Run one JSON parse attempt, returning the value or undefined on failure. */
function tryJson(source: string | (() => string)): unknown {
  try {
    const text = typeof source === 'function' ? source() : source
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Substitute the SillyTavern macros a prompt section may reference.
 * @param profile - the card whose name fills `{{char}}`.
 * @param text - the text to substitute in.
 * @returns the substituted text.
 */
export function substituteMacros(profile: CharacterProfile, text: string): string {
  return text.split('{{char}}').join(profile.name).split('{{user}}').join(USER_MACRO)
}
