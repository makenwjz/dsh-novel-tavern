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
import type { ActivatedLore, CharacterProfile, PresetSection, TavernBindingData } from './types.ts'

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

/** Parse one SillyTavern regex-script find pattern (bare or `/pattern/flags`). */
function parseFindRegex(findRegex: string): { pattern: string; flags: string } {
  const slashed = findRegex.match(/^\/([\s\S]*)\/([dgimsuvy]*)\s*$/)
  if (slashed !== null && slashed[1] !== undefined) {
    return { pattern: slashed[1], flags: slashed[2] ?? 'g' }
  }
  return { pattern: findRegex, flags: 'g' }
}

/** One prompt-side regex script from a card's `regex_scripts` extension. */
export type PromptScript = { findRegex: string; replaceString: string; enabled: boolean; promptOnly: boolean }

/** Render an imported prompt preset's ordered sections (a SillyTavern Chat
 *  Completion Preset). Marker entries resolve against the bound resources;
 *  regular entries render verbatim with `{{char}}`/`{{user}}` substituted.
 *  The author's ordering wins over the fixed built-in block layout. */
export function renderPresetSection(
  preset: { readonly name: string; readonly sections: readonly PresetSection[] },
  characters: readonly CharacterProfile[],
  loreBlock: string,
): string {
  const character = characters[0]
  const parts: string[] = []
  for (const section of preset.sections) {
    if (section.role !== 'system' && section.role !== 'user') continue
    if (section.marker) {
      const marker = section.content.trim().toLowerCase()
      if (marker === 'worldinfobefore' || marker === 'worldinfoafter') {
        if (loreBlock.length > 0) parts.push(loreBlock.trimEnd())
      } else if (character !== undefined) {
        if (marker === 'chardescription') {
          if (character.description.length > 0) parts.push(`## 角色介绍\n${character.description}`)
        } else if (marker === 'charpersonality') {
          if (character.personality.length > 0) parts.push(`## 角色性格\n${character.personality}`)
        } else if (marker === 'scenario') {
          if (character.scenario.length > 0) parts.push(`## 当前场景\n${character.scenario}`)
        } else if (marker === 'dialogueexamples') {
          if (character.mesExample.length > 0) parts.push(`## 对话示例\n${character.mesExample}`)
        }
        // chatHistory is carried by the native session log; personaDescription
        // has no DSH persona yet — both resolve to nothing.
      }
      continue
    }
    const substituted = character === undefined
      ? section.content.replace(/\{\{user\}\}/g, '用户').replace(/\{\{char\}\}/g, '角色')
      : substituteMacros(character, section.content)
    if (substituted.trim().length > 0) parts.push(substituted.trim())
  }
  return parts.join('\n\n')
}

/** One rendered character-card line; empty fields emit nothing. */

/** Apply a card's prompt-side (`promptOnly`) regex scripts to the rendered
 *  section text, the way SillyTavern post-processes the prompt: scripts that
 *  hide variable machinery from the model (e.g. "变量更新对AI不可见") or trim
 *  repetitive text run here. Malformed regexes are skipped. */
export function applyPromptScripts(text: string, scripts: readonly PromptScript[]): string {
  let out = text
  for (const script of scripts) {
    if (!script.enabled || !script.promptOnly || script.findRegex.length === 0) continue
    try {
      const { pattern, flags } = parseFindRegex(script.findRegex)
      out = out.replace(new RegExp(pattern, flags), script.replaceString)
    } catch { /* malformed regex: leave the text untouched */ }
  }
  return out
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

/** Whether the session log already contains the character's opening message
 *  (an assistant message before the first user message). When true, the prompt
 *  section must not force the card's `first_mes` again — the scene already
 *  opened and the model continues from it. */
export function hasOpeningMessage(events: readonly SessionEvent[]): boolean {
  let sawUser = false
  for (const event of events) {
    if (event.type === 'user/message') {
      const source = (event.data as { source?: { kind?: string } } | undefined)?.source
      if (source?.kind === 'user') sawUser = true
      continue
    }
    if (event.type === 'assistant/message' && !sawUser) return true
  }
  return false
}

/** Render one character's full block (name, fields, status, opener). Session
 *  MVU variables override the card's initial variables when both name a key. */
function fullCharacterBlock(
  character: CharacterProfile,
  lean: boolean,
  loreBlock: string,
  openingPresent: boolean,
  sessionMvu: Readonly<Record<string, string>> = {},
): string {
  const firstMes = character.firstMes.length === 0 || openingPresent
    ? ''
    : `\n本对话必须以上述角色的开场白开始：\n${character.firstMes}\n`
  const mvu = { ...character.mvuVariables, ...sessionMvu }
  const mvuBlock = lean || Object.keys(mvu).length === 0
    ? ''
    : '## 角色状态\n'
      + Object.entries(mvu).map(([key, value]) => `- ${key}: ${value}`).join('\n')
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
 * @param input.openingPresent - the session log already carries the character's
 * opening message, so the first_mes instruction is skipped.
 * @param input.mvuVariables - the session's MVU variable state, overriding the
 * card's initial variables.
 * @returns the section text, or the empty string when nothing injects.
 */
export function renderTavernSection(input: {
  binding: TavernBindingData
  characters: CharacterProfile[]
  activated: ActivatedLore[]
  lean?: boolean
  openingPresent?: boolean
  mvuVariables?: Readonly<Record<string, string>>
  preset?: { readonly name: string; readonly sections: readonly PresetSection[] } | null
}): string {
  const lean = input.lean === true
  const entries = input.activated.filter(item => item.entry.content.length > 0)
  const loreBlock = entries.length === 0
    ? ''
    : '## 已激活的世界书设定\n当前文本激活了以下世界设定，回答时不得与之矛盾：\n'
      + entries.map(item => `- 《${item.bookName}》：${item.entry.content}`).join('\n')
      + '\n'
  if (input.preset !== null && input.preset !== undefined) {
    return renderPresetSection(input.preset, input.characters, loreBlock)
  }
  if (input.binding.mode === 'novel' || input.characters.length === 0) return loreBlock
  const substituted = input.characters.map(character => substituteProfile(character))
  if (substituted.length === 1) {
    return fullCharacterBlock(substituted[0]!, lean, loreBlock, input.openingPresent === true, input.mvuVariables)
  }
  const blocks = substituted.map(character => extraCharacterBlock(character))
  return `${blocks.join('\n')}\n${loreBlock}`
}
