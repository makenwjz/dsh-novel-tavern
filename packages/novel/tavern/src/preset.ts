/**
 * Clean-room parser for SillyTavern Chat Completion Presets (referencing the
 * `@dsh-rp/compat-sillytavern` format): prompts + prompt_order profiles. The
 * `100001` ordering profile wins when present, else the first profile; only
 * enabled entries become ordered sections. Generation parameters are kept as
 * inert data (the harness model route owns those settings).
 * @module @deepseek-ai/dsh-tavern/preset
 */

import type { PresetSection, PromptPreset } from './types.ts'

/** The generation keys a preset may carry; kept inert on import. */
const GENERATION_KEYS = [
  'temperature', 'openai_max_tokens', 'top_p', 'top_k', 'top_a', 'min_p',
  'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'reasoning_effort',
] as const

/**
 * Parse one SillyTavern Chat Completion Preset JSON.
 * @param source - the preset document.
 * @returns the normalized preset (name + ordered sections + inert generation).
 * @throws when the document is malformed JSON or lacks the prompts/prompt_order arrays.
 */
export function parsePromptPreset(source: string): PromptPreset {
  let root: unknown
  try {
    root = JSON.parse(source)
  } catch {
    throw new Error('SillyTavern preset must be valid JSON')
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new Error('SillyTavern preset must be a JSON object')
  }
  const record = root as Record<string, unknown>
  if (!Array.isArray(record.prompts) || !Array.isArray(record.prompt_order)) {
    throw new Error('SillyTavern preset must contain prompts and prompt_order arrays')
  }
  const prompts = new Map<string, Record<string, unknown>>()
  for (const [index, value] of record.prompts.entries()) {
    if (typeof value !== 'object' || value === null) continue
    const row = value as Record<string, unknown>
    const id = typeof row.identifier === 'string' && row.identifier.length > 0
      ? row.identifier
      : String(index)
    prompts.set(id, row)
  }
  const orders: Array<{ id: string; entries: Array<{ identifier: string; enabled: boolean }> }> = []
  for (const [orderIndex, value] of record.prompt_order.entries()) {
    if (typeof value !== 'object' || value === null) continue
    const row = value as Record<string, unknown>
    if (!Array.isArray(row.order)) continue
    const characterId = row.character_id !== undefined && row.character_id !== null
      ? String(row.character_id)
      : `legacy:${orderIndex}`
    const entries = (row.order as unknown[]).map(entry => {
      if (typeof entry !== 'object' || entry === null) return null
      const line = entry as Record<string, unknown>
      return typeof line.identifier === 'string' && line.identifier.length > 0
        ? { identifier: line.identifier, enabled: line.enabled === true }
        : null
    }).filter((entry): entry is { identifier: string; enabled: boolean } => entry !== null)
    orders.push({ id: characterId, entries })
  }
  const selected = orders.find(order => order.id === '100001') ?? orders[0]
  const sections: PresetSection[] = []
  if (selected !== undefined) {
    for (const entry of selected.entries) {
      if (!entry.enabled) continue
      const prompt = prompts.get(entry.identifier)
      if (prompt === undefined) continue
      const role = prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system'
      sections.push({
        id: entry.identifier,
        name: typeof prompt.name === 'string' && prompt.name.length > 0 ? prompt.name : entry.identifier,
        role,
        content: typeof prompt.content === 'string' ? prompt.content : '',
        marker: prompt.marker === true,
      })
    }
  }
  const generation: Record<string, unknown> = {}
  for (const key of GENERATION_KEYS) {
    if (record[key] !== undefined) generation[key] = record[key]
  }
  const name = typeof record.name === 'string' && record.name.trim() !== ''
    ? record.name.trim()
    : '未命名预设'
  return { name, sections, generation }
}
