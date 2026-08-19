/**
 * Pure building blocks of the tavern prompt section: the per-session binding
 * folds from the session log, the activation text window comes from the same
 * log, and the rendered section is a pure function of the folded inputs. All
 * model-visible material is therefore reconstructable from the session log
 * plus the durable import store.
 * @module @deepseek-ai/dsh-tavern/section
 */

import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { substituteMacros } from './character.ts'
import type { ActivatedLore, CharacterProfile, TavernBindingData } from './types.ts'

/** Structural shape check for one binding event payload. */
function isBindingData(value: unknown): value is TavernBindingData {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return (source.mode === 'novel' || source.mode === 'tavern')
    && Array.isArray(source.worldbookIds) && source.worldbookIds.every(id => typeof id === 'string')
    && (source.characterId === null || typeof source.characterId === 'string')
    && (source.characterIds === undefined
      || (Array.isArray(source.characterIds) && source.characterIds.every(id => typeof id === 'string')))
}

/**
 * Fold the latest `tavern/binding` event from a session log.
 * @param events - the session's event log.
 * @returns the binding, or null when the log records none.
 */
export function foldBinding(events: readonly SessionEvent[]): TavernBindingData | null {
  let binding: TavernBindingData | null = null
  for (const event of events) {
    if (event.type !== 'tavern/binding') continue
    if (isBindingData(event.data)) binding = event.data
  }
  return binding
}

/**
 * Fold the tail text window a lorebook activation scans. Text blocks of every
 * message-producing event concatenate; the last `limit` characters remain.
 * @param events - the session's event log.
 * @param limit - the maximum window length in characters.
 * @returns the window, at most `limit` characters long.
 */
export function recentText(events: readonly SessionEvent[], limit: number): string {
  const parts: string[] = []
  for (const event of events) {
    const message = deriveEventMessage(event)
    if (message === null) continue
    parts.push(message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n'))
  }
  return parts.join('\n').slice(-limit)
}

/** One rendered character-card line; empty fields emit nothing. */
function fieldLine(label: string, value: string): string {
  return value.length === 0 ? '' : `- ${label}: ${value}\n`
}

/** Substitute the `{{char}}`/`{{user}}` macros across every card field. */
function substituteProfile(profile: CharacterProfile): CharacterProfile {
  const substitute = (text: string): string => substituteMacros(profile, text)
  const mvuVariables: Record<string, string> = {}
  for (const [key, value] of Object.entries(profile.mvuVariables)) {
    mvuVariables[key] = substitute(value)
  }
  return {
    ...profile,
    name: substitute(profile.name),
    description: substitute(profile.description),
    personality: substitute(profile.personality),
    scenario: substitute(profile.scenario),
    firstMes: substitute(profile.firstMes),
    mesExample: substitute(profile.mesExample),
    systemPrompt: substitute(profile.systemPrompt),
    postHistoryInstructions: substitute(profile.postHistoryInstructions),
    alternateGreetings: profile.alternateGreetings.map(substitute),
    tags: profile.tags.map(substitute),
    creator: substitute(profile.creator),
    mvuVariables,
  }
}

/** Render one character's full block (name, fields, status, opener). */
function fullCharacterBlock(character: CharacterProfile, lean: boolean, loreBlock: string): string {
  const firstMes = character.firstMes.length === 0
    ? ''
    : `\n本对话必须以上述角色的开场白开始：\n${character.firstMes}\n`
  const mvuBlock = lean || Object.keys(character.mvuVariables).length === 0
    ? ''
    : '## 角色状态\n'
      + Object.entries(character.mvuVariables).map(([key, value]) => `- ${key}: ${value}`).join('\n')
      + '\n'
  if (lean) {
    const intro = character.description.length === 0 ? '' : `- 人物介绍: ${character.description}\n`
    return `## 角色扮演设定\n你现在扮演 ${character.name}。\n${intro}${firstMes}${loreBlock}`
  }
  const fields = [
    fieldLine('性格', character.personality),
    fieldLine('背景', character.scenario),
    fieldLine('人物介绍', character.description),
    fieldLine('对话示例', character.mesExample),
    fieldLine('额外设定', character.systemPrompt),
    fieldLine('行为准则', character.postHistoryInstructions),
  ].join('')
  return `## 角色扮演设定\n你现在扮演 ${character.name}。以下设定必须遵守：\n${fields}${mvuBlock}${firstMes}${loreBlock}`
}

/** Render one extra character's trimmed block (name plus description). */
function extraCharacterBlock(character: CharacterProfile): string {
  const intro = character.description.length === 0 ? '' : `- 人物介绍: ${character.description}\n`
  return `## 角色扮演设定\n你现在扮演 ${character.name}。\n${intro}`
}

/**
 * Render the tavern prompt section text.
 * @param input - the folded binding, resolved characters, and activated lore.
 * @param input.characters - the character profiles to roleplay (one for single,
 * several for multi-character mode; empty in novel mode).
 * @param input.lean - trim each character block to its name, description, and
 * first message to cut per-turn tokens (public-kiosk friendly).
 * @returns the section text, or the empty string when nothing injects.
 */
export function renderTavernSection(input: {
  binding: TavernBindingData
  characters: CharacterProfile[]
  activated: ActivatedLore[]
  lean?: boolean
}): string {
  const lean = input.lean === true
  const entries = input.activated.filter(item => item.entry.content.length > 0)
  const loreBlock = entries.length === 0
    ? ''
    : '## 已激活的世界书设定\n当前文本激活了以下世界设定，回答时不得与之矛盾：\n'
      + entries.map(item => `- 《${item.bookName}》：${item.entry.content}`).join('\n')
      + '\n'
  if (input.binding.mode === 'novel' || input.characters.length === 0) return loreBlock
  const substituted = input.characters.map(character => substituteProfile(character))
  if (substituted.length === 1) {
    return fullCharacterBlock(substituted[0]!, lean, loreBlock)
  }
  const blocks = substituted.map(character => extraCharacterBlock(character))
  return `${blocks.join('\n')}\n${loreBlock}`
}
