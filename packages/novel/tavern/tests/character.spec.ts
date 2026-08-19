import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  extractEmbeddedWorldBook,
  parseCharacterJson,
  parseCharacterPng,
  parseCharacterPngRaw,
  substituteMacros,
} from '../src/character.ts'
import type { CharacterProfile } from '../src/types.ts'

/** One full V3-shaped card fixture. */
const V2_CARD: Record<string, unknown> = {
  name: 'Aya',
  description: '冷面剑修',
  personality: '寡言',
  scenario: '黄昏的剑冢',
  first_mes: '*拔出剑* 你来了。',
  mes_example: 'Aya: 剑不是用来问的。',
  system_prompt: '不得提及现实世界',
  post_history_instructions: '保持冷淡',
  alternate_greetings: ['*回眸* 谁？'],
  tags: ['剑修'],
  creator: '匿名',
  character_version: '2.0',
}

/** The expected projection of {@link V2_CARD}. */
const V2_PROFILE: CharacterProfile = {
  name: 'Aya',
  description: '冷面剑修',
  personality: '寡言',
  scenario: '黄昏的剑冢',
  firstMes: '*拔出剑* 你来了。',
  mesExample: 'Aya: 剑不是用来问的。',
  systemPrompt: '不得提及现实世界',
  postHistoryInstructions: '保持冷淡',
  alternateGreetings: ['*回眸* 谁？'],
  tags: ['剑修'],
  creator: '匿名',
  characterVersion: '2.0',
  mvuVariables: {},
}

/** One legacy SillyTavern V2 card fixture (`char_name`-era field names). */
const V2_LEGACY_CARD: Record<string, unknown> = {
  char_name: '青鸾',
  char_persona: '雪原上的孤傲少女',
  char_greeting: '*抬眼* 你也是来寻那把剑的？',
  world_scenario: '北境永夜，剑冢山下',
  example_dialogue: '青鸾: 剑不识人。',
  extensions: {
    talkativeness: '0.5',
    mvu: { variables: { 灵力: 90 } },
  },
}

/** The expected projection of {@link V2_LEGACY_CARD}. */
const V2_LEGACY_PROFILE: CharacterProfile = {
  name: '青鸾',
  description: '雪原上的孤傲少女',
  personality: '',
  scenario: '北境永夜，剑冢山下',
  firstMes: '*抬眼* 你也是来寻那把剑的？',
  mesExample: '青鸾: 剑不识人。',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: [],
  creator: '',
  characterVersion: '',
  mvuVariables: { 灵力: '90' },
}

/** One tool-era card fixture (Tavern Helper / SillyTavern extension fields). */
const HELPER_CARD: Record<string, unknown> = {
  ...V2_CARD,
  creator_notes: '由酒馆助手生成',
  creator_notes_raw: '由酒馆助手生成',
  group_only_greetings: [],
  character_book: { name: 'world', entries: [] },
  extensions: {
    mvu: { variables: { hp: 100 } },
    tavern: { enabled: true },
  },
}

describe('parseCharacterJson', () => {
  it('projects a full V3-shaped card', () => {
    expect(parseCharacterJson(V2_CARD)).toEqual(V2_PROFILE)
  })

  it('projects a legacy V2 card through the char_name-era field aliases', () => {
    expect(parseCharacterJson(V2_LEGACY_CARD)).toEqual(V2_LEGACY_PROFILE)
  })

  it('unwraps a V3 JSON export envelope', () => {
    expect(parseCharacterJson({ spec: 'chara_card_v3', data: V2_CARD })).toEqual(V2_PROFILE)
  })

  it('unwraps any { spec, data } envelope regardless of the spec value', () => {
    expect(parseCharacterJson({ spec: 'chara_card_v2', data: V2_CARD })).toEqual(V2_PROFILE)
  })

  it('falls back to char_name when name is absent', () => {
    expect(parseCharacterJson({ char_name: 'Aya' }).name).toBe('Aya')
  })

  it('fills missing fields with empty defaults and trims the name', () => {
    expect(parseCharacterJson({ name: '  Aya  ' })).toEqual({
      name: 'Aya',
      description: '',
      personality: '',
      scenario: '',
      firstMes: '',
      mesExample: '',
      systemPrompt: '',
      postHistoryInstructions: '',
      alternateGreetings: [],
      tags: [],
      creator: '',
      characterVersion: '',
      mvuVariables: {},
    })
  })

  it('ignores tool-era extension fields while projecting the supported subset', () => {
    expect(parseCharacterJson(HELPER_CARD)).toEqual({ ...V2_PROFILE, mvuVariables: { hp: '100' } })
  })

  it('projects MVU status variables and stringifies their values', () => {
    const card = {
      name: 'Aya',
      extensions: { mvu: { variables: { HP: 100, 好感: '高' } } },
    }
    expect(parseCharacterJson(card).mvuVariables).toEqual({ HP: '100', 好感: '高' })
    expect(parseCharacterJson({ name: 'Aya', extensions: { mvu: { variables: 'x' } } }).mvuVariables).toEqual({})
  })

  it('coerces a wrong-typed string field instead of failing', () => {
    expect(parseCharacterJson({ name: 'Aya', personality: 42 }).personality).toBe('42')
  })

  it('drops non-string items from string-array fields', () => {
    expect(parseCharacterJson({ name: 'Aya', tags: [1, '剑修'] }).tags).toEqual(['剑修'])
    expect(parseCharacterJson({ name: 'Aya', alternate_greetings: [1] }).alternateGreetings).toEqual([])
  })

  it('drops a wrong-typed array field entirely', () => {
    expect(parseCharacterJson({ name: 'Aya', tags: 42 }).tags).toEqual([])
  })

  it.each([
    { label: 'non-object', raw: 'x' },
    { label: 'null', raw: null },
  ])('rejects $label', ({ raw }) => {
    expect(() => parseCharacterJson(raw)).toThrow(/must be a JSON object/)
  })

  it.each([
    { label: 'missing name', raw: {} },
    { label: 'blank name', raw: { name: '  ' } },
    { label: 'non-string name', raw: { name: 42 } },
    { label: 'blank char_name', raw: { char_name: '  ' } },
  ])('rejects $label', ({ raw }) => {
    expect(() => parseCharacterJson(raw)).toThrow(/non-empty name/)
  })
})

/** A PNG carrying one JSON card under the given keyword (UTF-8 bytes in the text chunk). */
function cardPng(keyword: string, json: string): Uint8Array {
  const data = [...Buffer.from(`${keyword}\0`, 'latin1'), ...Buffer.from(json, 'utf-8')]
  const length = [(data.length >>> 24) & 0xFF, (data.length >>> 16) & 0xFF, (data.length >>> 8) & 0xFF, data.length & 0xFF]
  const type = [...Buffer.from('tEXt', 'latin1')]
  const payload = [...length, ...type, ...data]
  const crc = crc32Local(Uint8Array.from(payload.slice(4)))
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...payload,
    (crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF,
  ])
  return bytes
}

/** Local CRC-32 for the fixture builder (mirrors the source table walk). */
function crc32Local(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

describe('parseCharacterPng', () => {
  it('parses a V3-shaped chara chunk', () => {
    expect(parseCharacterPng(cardPng('chara', JSON.stringify(V2_CARD)))).toEqual(V2_PROFILE)
  })

  it('parses a chara chunk carrying legacy V2 field names', () => {
    expect(parseCharacterPng(cardPng('chara', JSON.stringify(V2_LEGACY_CARD)))).toEqual(V2_LEGACY_PROFILE)
  })

  it('parses a V3 ccv3 envelope', () => {
    const card = cardPng('ccv3', JSON.stringify({ spec: 'chara_card_v3', data: V2_CARD }))
    expect(parseCharacterPng(card)).toEqual(V2_PROFILE)
  })

  it('parses a V3 card carrying tool-era extension fields', () => {
    const card = cardPng('ccv3', JSON.stringify({ spec: 'chara_card_v3', data: HELPER_CARD }))
    expect(parseCharacterPng(card)).toEqual({ ...V2_PROFILE, mvuVariables: { hp: '100' } })
  })

  it('rejects a PNG without any card chunk', () => {
    const card = cardPng('Title', 'hello')
    expect(() => parseCharacterPng(card)).toThrow(/no chara or ccv3 text chunk/)
  })

  it('rejects a PNG whose card chunk is not JSON', () => {
    expect(() => parseCharacterPng(cardPng('chara', 'not json'))).toThrow(/not valid JSON/)
  })

  it('unwraps a non-v3 ccv3 envelope and validates its data', () => {
    expect(() => parseCharacterPng(cardPng('ccv3', JSON.stringify({ spec: 'chara_card_v2', data: {} }))))
      .toThrow(/non-empty name/)
  })
})

describe('parseCharacterPng fallback decodings', () => {
  /** A PNG whose tEXt payload is the given raw bytes (not necessarily UTF-8). */
  function cardPngBytes(keyword: string, bytes: Uint8Array): Uint8Array {
    const data = [...Buffer.from(`${keyword}\0`, 'latin1'), ...bytes]
    const length = [(data.length >>> 24) & 0xFF, (data.length >>> 16) & 0xFF, (data.length >>> 8) & 0xFF, data.length & 0xFF]
    const type = [...Buffer.from('tEXt', 'latin1')]
    const payload = [...length, ...type, ...data]
    const crc = crc32Local(Uint8Array.from(payload.slice(4)))
    return Uint8Array.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...payload,
      (crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF,
    ])
  }

  it('inflates a deflate stream hidden in a tEXt chunk', () => {
    const deflated = deflateSync(Buffer.from(JSON.stringify(V2_LEGACY_CARD), 'utf-8'))
    expect(parseCharacterPng(cardPngBytes('chara', deflated))).toEqual(V2_LEGACY_PROFILE)
  })

  it('strips a UTF-8 BOM before parsing', () => {
    const withBom = Buffer.from(`\uFEFF${JSON.stringify(V2_CARD)}`, 'utf-8')
    expect(parseCharacterPng(cardPngBytes('chara', withBom))).toEqual(V2_PROFILE)
  })

  it('decodes UTF-16LE card text', () => {
    const utf16 = Buffer.from(JSON.stringify(V2_CARD), 'utf16le')
    expect(parseCharacterPng(cardPngBytes('chara', utf16))).toEqual(V2_PROFILE)
  })

  it('still rejects a chunk that decodes to no JSON under any scheme', () => {
    expect(() => parseCharacterPng(cardPng('chara', 'not json'))).toThrow(/not valid JSON/)
  })
})

describe('extractEmbeddedWorldBook', () => {
  it('extracts the V3 character_book field', () => {
    const raw = {
      name: 'Aya',
      character_book: { name: '剑冢', entries: [{ keys: ['剑'], content: '埋着断剑' }] },
    }
    expect(extractEmbeddedWorldBook(raw)).toEqual({
      name: '剑冢',
      entries: [{ keys: ['剑'], content: '埋着断剑' }],
    })
  })

  it('unwraps a V3 envelope before extracting the character_book', () => {
    const raw = {
      spec: 'chara_card_v3',
      data: { name: 'Aya', character_book: { name: '剑冢', entries: [{ keys: ['剑'], content: '埋着断剑' }] } },
    }
    expect(extractEmbeddedWorldBook(raw)?.name).toBe('剑冢')
  })

  it('extracts the legacy extensions.world_book field', () => {
    const raw = { name: 'Aya', extensions: { world_book: { name: 'W', entries: [{}] } } }
    expect(extractEmbeddedWorldBook(raw)?.name).toBe('W')
  })

  it('returns null when the card carries no worldbook', () => {
    expect(extractEmbeddedWorldBook({ name: 'Aya' })).toBeNull()
    expect(extractEmbeddedWorldBook({ name: 'Aya', character_book: { name: 'X', entries: [] } })).toBeNull()
    expect(extractEmbeddedWorldBook('x')).toBeNull()
  })

  it('round-trips through a base64 PNG card via parseCharacterPngRaw', () => {
    const raw = {
      name: 'Aya',
      character_book: { name: '剑冢', entries: [{ keys: ['剑'], content: '埋着断剑' }] },
    }
    const card = cardPng('chara', Buffer.from(JSON.stringify(raw), 'utf-8').toString('base64'))
    expect(parseCharacterPngRaw(card)).toEqual(raw)
    expect(parseCharacterPng(card).name).toBe('Aya')
  })
})

describe('substituteMacros', () => {
  it('substitutes {{char}} and {{user}}', () => {
    const profile = { ...V2_PROFILE }
    expect(substituteMacros(profile, '{{char}}对{{user}}说'))
      .toBe('Aya对用户说')
  })
})
