/**
 * Minimal PNG text-chunk reader for character cards. SillyTavern cards carry
 * their JSON either as a `chara` (V2) or `ccv3` (V3) `tEXt`, `iTXt`, or
 * `zTXt` chunk; this module walks the chunk stream and decodes those three
 * chunk types. The parser is hand-rolled (no image library) because a card
 * only needs its text metadata, and the PNG signature/chunk walk is ~60 lines
 * of validated code.
 * @module @deepseek-ai/dsh-tavern/png
 */

import { inflateSync } from 'node:zlib'

/** The 8-byte PNG file signature. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

/** One decoded text chunk of a PNG stream. */
export interface PngTextChunk {
  /** The chunk keyword (`chara` or `ccv3` for character cards). */
  readonly keyword: string
  /** The decoded text payload. */
  readonly text: string
}

/**
 * Compute the PNG CRC-32 of one byte range (the standard PNG chunk checksum).
 * @param bytes - the bytes to checksum.
 * @returns the unsigned 32-bit checksum.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** Read one big-endian uint32. */
function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

/** Byte-preserving Latin-1 decode. `TextDecoder('latin1')` resolves to
 *  windows-1252 (which remaps bytes 0x80-0x9F), so a manual chunked
 *  `String.fromCharCode` is the only way to map every byte to its own code
 *  point and let `Buffer.from(text, 'latin1')` round-trip exactly. */
function decodeLatin1(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 4096) {
    text += String.fromCharCode(...bytes.subarray(index, index + 4096))
  }
  return text
}

/** Decode a null-terminated Latin-1 keyword, returning the keyword and the text offset. */
function readKeyword(bytes: Uint8Array): { keyword: string; offset: number } {
  let end = 0
  while (end < bytes.length && bytes[end] !== 0) end += 1
  if (end === bytes.length) throw new Error('tavern: PNG text chunk has no keyword terminator')
  return { keyword: decodeLatin1(bytes.subarray(0, end)), offset: end + 1 }
}

/** Decode card text: valid UTF-8 wins, byte-preserving Latin-1 is the V2 fallback (many exporters truncate CJK to single bytes). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return decodeLatin1(bytes)
  }
}

/** Decode one `tEXt` payload: `keyword\0text` in Latin-1 (V2) or raw UTF-8 bytes. */
function readTextChunk(bytes: Uint8Array): PngTextChunk {
  const { keyword, offset } = readKeyword(bytes)
  return { keyword, text: decodeText(bytes.subarray(offset)) }
}

/** Index of the next NUL byte at or after `from`, or -1. */
function indexOfNul(bytes: Uint8Array, from: number): number {
  for (let index = from; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return index
  }
  return -1
}

/** Decode one `iTXt` payload: `keyword\0flag method language\0translated\0text`, optional zlib. */
function readItxtChunk(bytes: Uint8Array): PngTextChunk {
  const { keyword, offset: keywordEnd } = readKeyword(bytes)
  const compressionFlag = bytes[keywordEnd]
  const languageEnd = indexOfNul(bytes, keywordEnd + 2)
  const textStart = languageEnd < 0 ? -1 : indexOfNul(bytes, languageEnd + 1)
  const textBytes = textStart < 0 ? new Uint8Array() : bytes.subarray(textStart + 1)
  // Flag 0 is uncompressed; any other flag is treated as uncompressed rather
  // than guessing at an unknown compression scheme. Flag 1 means the text
  // bytes are a zlib stream; a stream that fails to inflate is a malformed
  // card, reported with a clear message instead of a raw zlib error.
  if (compressionFlag !== 1) {
    return { keyword, text: new TextDecoder('utf-8').decode(textBytes) }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8').decode(inflateSync(textBytes))
  } catch (error) {
    throw new Error(`tavern: PNG iTXt chunk ${JSON.stringify(keyword)} failed to inflate`, { cause: error })
  }
  return { keyword, text }
}

/**
 * Decode one `zTXt` payload: `keyword\0method compressed` where method 0
 * means the text is a zlib stream (Latin-1 per the PNG spec, though many
 * writers stuff UTF-8 bytes in anyway). Unknown methods fall back to raw
 * Latin-1 rather than guessing at a compression scheme.
 */
function readZtxtChunk(bytes: Uint8Array): PngTextChunk {
  const { keyword, offset: keywordEnd } = readKeyword(bytes)
  const method = bytes[keywordEnd]
  const compressed = bytes.subarray(keywordEnd + 1)
  if (method !== 0) {
    return { keyword, text: decodeLatin1(compressed) }
  }
  let text: string
  try {
    text = decodeText(inflateSync(compressed))
  } catch (error) {
    throw new Error(`tavern: PNG zTXt chunk ${JSON.stringify(keyword)} failed to inflate`, { cause: error })
  }
  return { keyword, text }
}

/**
 * Find the first text chunk carrying the given keyword.
 * @param buf - the PNG file bytes.
 * @param keyword - the keyword to look for (`chara` or `ccv3`).
 * @returns the decoded chunk, or null when the file has no such chunk.
 * @throws when the bytes are not a PNG or the chunk stream is malformed.
 */
export function extractTextChunk(buf: Uint8Array, keyword: string): PngTextChunk | null {
  if (buf.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => buf[index] === byte)) {
    throw new Error('tavern: character card is not a PNG file')
  }
  let offset = PNG_SIGNATURE.length
  while (offset + 8 <= buf.length) {
    const length = readUint32(buf, offset)
    const type = new TextDecoder('latin1').decode(buf.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    if (dataStart + length > buf.length) throw new Error('tavern: PNG chunk extends past the file end')
    if (type === 'IEND') break
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const chunk = type === 'tEXt'
        ? readTextChunk(buf.subarray(dataStart, dataStart + length))
        : type === 'iTXt'
          ? readItxtChunk(buf.subarray(dataStart, dataStart + length))
          : readZtxtChunk(buf.subarray(dataStart, dataStart + length))
      if (chunk.keyword === keyword) return chunk
    }
    offset = dataStart + length + 4
  }
  return null
}
