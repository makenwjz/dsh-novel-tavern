import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, extractTextChunk } from '../src/png.ts'

/** Append one PNG chunk (length, type, data, crc) to a builder. */
function chunk(type: string, data: number[]): number[] {
  const length = [(data.length >>> 24) & 0xFF, (data.length >>> 16) & 0xFF, (data.length >>> 8) & 0xFF, data.length & 0xFF]
  const payload = [...length, ...[...type].map(char => char.charCodeAt(0)), ...data]
  const crc = crc32(Uint8Array.from(payload.slice(4)))
  return [...payload, (crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF]
}

/** One complete PNG byte array for tests. */
function png(chunks: number[][]): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...chunks.flat()])
}

/** The byte sequence of one Latin-1 string. */
function latin1(text: string): number[] {
  return [...Buffer.from(text, 'latin1')]
}

/** A `tEXt` chunk with the given keyword and Latin-1 text. */
function textChunk(keyword: string, text: string): number[] {
  return chunk('tEXt', [...latin1(keyword), 0, ...latin1(text)])
}

/** An `iTXt` chunk with the given keyword, optional zlib compression, and UTF-8 text. */
function itxtChunk(keyword: string, text: string, compressed: boolean): number[] {
  const payload = compressed
    ? [...latin1(keyword), 0, 1, 0, 0, 0, ...deflateSync(Buffer.from(text, 'utf-8'))]
    : [...latin1(keyword), 0, 0, 0, 0, 0, ...Buffer.from(text, 'utf-8')]
  return chunk('iTXt', payload)
}

/** A `zTXt` chunk with the given keyword, zlib compression method 0, and text bytes. */
function ztxtChunk(keyword: string, text: string, compressed: boolean): number[] {
  const payload = compressed
    ? [...latin1(keyword), 0, 0, ...deflateSync(Buffer.from(text, 'utf-8'))]
    : [...latin1(keyword), 0, 0, ...Buffer.from(text, 'utf-8')]
  return chunk('zTXt', payload)
}

describe('extractTextChunk', () => {
  it('extracts a V2 chara chunk', () => {
    const card = png([textChunk('chara', '{"name":"Aya"}')])
    expect(extractTextChunk(card, 'chara')).toEqual({ keyword: 'chara', text: '{"name":"Aya"}' })
  })

  it('extracts an uncompressed ccv3 iTXt chunk with UTF-8 text', () => {
    const card = png([itxtChunk('ccv3', '{"name":"青鸾"}', false)])
    expect(extractTextChunk(card, 'ccv3')).toEqual({ keyword: 'ccv3', text: '{"name":"青鸾"}' })
  })

  it('extracts a zlib-compressed ccv3 iTXt chunk', () => {
    const card = png([itxtChunk('ccv3', '{"name":"Aya"}', true)])
    expect(extractTextChunk(card, 'ccv3')?.text).toBe('{"name":"Aya"}')
  })

  it('throws a clear error when a compressed iTXt payload fails to inflate', () => {
    const card = png([chunk('iTXt', [...latin1('ccv3'), 0, 1, 0, 0, 0, ...Buffer.from('not-deflate')])])
    expect(() => extractTextChunk(card, 'ccv3')).toThrow(/failed to inflate/)
  })

  it('treats an unknown iTXt compression flag as uncompressed', () => {
    const card = png([chunk('iTXt', [...latin1('ccv3'), 0, 7, 0, 0, 0, ...Buffer.from('{"name":"Aya"}', 'utf-8')])])
    expect(extractTextChunk(card, 'ccv3')?.text).toBe('{"name":"Aya"}')
  })

  it('extracts a zlib-compressed zTXt chara chunk', () => {
    const card = png([ztxtChunk('chara', '{"name":"Aya"}', true)])
    expect(extractTextChunk(card, 'chara')?.text).toBe('{"name":"Aya"}')
  })

  it('treats an unknown zTXt compression method as raw text', () => {
    const card = png([chunk('zTXt', [...latin1('chara'), 0, 7, ...Buffer.from('{"name":"Aya"}', 'utf-8')])])
    expect(extractTextChunk(card, 'chara')?.text).toBe('{"name":"Aya"}')
  })

  it('throws a clear error when a zTXt payload fails to inflate', () => {
    const card = png([chunk('zTXt', [...latin1('chara'), 0, 0, ...Buffer.from('not-deflate')])])
    expect(() => extractTextChunk(card, 'chara')).toThrow(/failed to inflate/)
  })

  it('falls back to Latin-1 when the tEXt bytes are not valid UTF-8', () => {
    const card = png([chunk('tEXt', [...latin1('chara'), 0, 0xD1, 0xD4])])
    expect(extractTextChunk(card, 'chara')?.text).toBe('\u00D1\u00D4')
  })

  it('yields an empty text for an iTXt payload without terminator NULs', () => {
    const card = png([chunk('iTXt', [...latin1('ccv3'), 0, 0, 0, ...latin1('zh-CN')])])
    expect(extractTextChunk(card, 'ccv3')).toEqual({ keyword: 'ccv3', text: '' })
  })

  it('walks past unrelated chunks and stops at IEND', () => {
    const card = png([
      chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      textChunk('Title', 'nope'),
      chunk('IEND', []),
    ])
    expect(extractTextChunk(card, 'chara')).toBeNull()
  })

  it('returns null when the keyword is absent', () => {
    expect(extractTextChunk(png([textChunk('chara', 'x')]), 'ccv3')).toBeNull()
  })

  it('rejects a non-PNG signature', () => {
    expect(() => extractTextChunk(Uint8Array.of(1, 2, 3), 'chara')).toThrow(/not a PNG file/)
  })

  it('rejects a chunk extending past the file end', () => {
    const card = png([chunk('tEXt', latin1('chara'))])
    expect(() => extractTextChunk(card.subarray(0, card.length - 8), 'chara')).toThrow(/past the file end/)
  })

  it('rejects a text chunk without a keyword terminator', () => {
    const card = png([chunk('tEXt', latin1('chara'))])
    expect(() => extractTextChunk(card, 'chara')).toThrow(/no keyword terminator/)
  })
})
