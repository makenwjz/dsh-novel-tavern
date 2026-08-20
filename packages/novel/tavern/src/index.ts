/**
 * The tavern service: a SillyTavern-compatible roleplay store for the novel
 * workspace. It imports lorebook (worldbook) JSON exports and character cards
 * (JSON or PNG with a `chara`/`ccv3` text chunk), validates them loud, mints
 * stable ids, and feeds a per-session prompt section that injects the
 * character and the keyword-activated lorebook entries. Sessions bind to the
 * store through a typed `tavern/binding` session event, so the binding is a
 * pure replay quantity recovered from the session log on restarts and cold
 * reads.
 * @module @deepseek-ai/dsh-tavern
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `AssembleContext.agent` and `Context.systemPrompt`
// augmentations into the program.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { activateEntries, parseLorebook } from './lorebook.ts'
import { extractEmbeddedWorldBook, parseCharacterJson, parseCharacterPng, parseCharacterPngRaw } from './character.ts'
import { parsePromptPreset } from './preset.ts'
import { applyPromptScripts, foldBinding, hasOpeningMessage, recentText, renderTavernSection, type PromptScript } from './section.ts'
import type {
  ActivatedLore,
  CardScore,
  CharacterId,
  CharacterProfile,
  CharacterView,
  DanglingBinding,
  JailbreakId,
  JailbreakPreset,
  Lorebook,
  PromptPreset,
  PromptPresetId,
  PromptPresetView,
  TavernBindingData,
  TavernProjectTree,
  WorldBookId,
  WorldBookView,
} from './types.ts'

/** The deployment-facing configuration of the tavern store. */
export interface TavernConfig {
  /** Directory holding `worldbooks/` and `characters/`; resolved against the working directory. */
  root: string
  /** The character budget of the activation text window scanned per assembly. */
  activationTextLimit: number
  /** Cap on the total characters of activated lore injected per assembly.
   *  Large lorebooks (100+ entries) otherwise blow the prompt budget; entries
   *  beyond the cap are dropped in insertion order. Defaults to 12000. */
  activationCharBudget?: number
  /** Trim the character block to name, description, and first message to cut per-turn tokens. */
  lean: boolean
  /** Optional provider route used by the card-quality scoring call. */
  scoreProvider?: string
  /** Optional model id paired with `scoreProvider`. */
  scoreModel?: string
  /** Output-token cap for the scoring call. */
  scoreMaxTokens?: number
}

/** Safe identifier pattern shared by store files and sessions. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Mint one store id for a collection. */
function mintId(prefix: 'worldbook' | 'character'): string {
  return `${prefix}-${randomUUID()}`
}

/** Validate an opaque store id, failing loud on anything unsafe or malformed. */
function validateId(kind: 'worldbook' | 'character', id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`tavern: invalid ${kind} id ${JSON.stringify(id)}`)
  }
}

/** Parse the model's scoring JSON, tolerating prose around the braces. */
function parseScore(text: string): CardScore {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const raw = start >= 0 && end > start ? text.slice(start, end + 1) : ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('tavern: card scoring returned no parseable JSON')
  }
  const score = parsed as Record<string, unknown>
  const numberField = (key: 'overall' | 'clarity' | 'consistency' | 'tokenEfficiency'): number => {
    const value = score[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`tavern: card scoring returned an invalid ${JSON.stringify(key)}`)
    }
    return value
  }
  return {
    overall: numberField('overall'),
    clarity: numberField('clarity'),
    consistency: numberField('consistency'),
    tokenEfficiency: numberField('tokenEfficiency'),
    note: typeof score.note === 'string' ? score.note : '',
  }
}

/** The stored-file extensions of one collection. */
const STORE_EXTENSIONS: Record<'worldbooks' | 'characters' | 'presets' | 'jailbreaks' | 'jailbreaks', string[]> = {
  worldbooks: ['json'],
  characters: ['json', 'png'],
  presets: ['json'],
  jailbreaks: ['json'],
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tavern: TavernService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Latest-wins per-session tavern binding. The model-visible injection is
     * folded from this event, so the prompt material is reconstructable from
     * the session log alone; the referenced store files are durable data.
     */
    'tavern/binding': TavernBindingData
  }
}

/**
 * The tavern store service, published on `ctx.tavern`. Ids are minted by the
 * service (`worldbook-<uuid>`, `character-<uuid>`); imports keep their raw
 * file bytes so a re-export round-trips. Deletes fail loud while any attached
 * session still binds the referenced store object.
 */
export class TavernService extends Service {
  static Config: z<TavernConfig> = z.object({
    root: z.string().default('tavern'),
    activationTextLimit: z.number().step(1).min(1).default(4000),
    activationCharBudget: z.number().step(1).min(500).default(12000),
    lean: z.boolean().default(false),
    scoreProvider: z.string(),
    scoreModel: z.string(),
    scoreMaxTokens: z.number().step(1).min(1).default(500),
  })
  /** Sibling services the constructor reads while registering the section. */
  static inject = ['systemPrompt', 'sessions']

  /** The store's root directory (resolved). */
  readonly root: string
  /** The resolved activation text window budget. */
  readonly activationTextLimit: number
  /** The resolved injected-lore character cap. */
  readonly activationCharBudget: number
  /** Whether the prompt section renders the trimmed character block. */
  private _lean: boolean

  /** Whether the prompt section renders the trimmed character block. */
  get lean(): boolean {
    return this._lean
  }

  /** The optional scoring route and output cap. */
  private readonly scoreRoute: { readonly provider: string; readonly model: string } | undefined
  private readonly scoreMaxTokens: number

  /**
   * Open (or create) the store under `config.root` and register the prompt
   * section that injects bindings into every session's assembly.
   * @param ctx - Cordis context that owns the service.
   * @param config - plugin configuration (schema-validated).
   */
  constructor(ctx: Context, config: TavernConfig) {
    super(ctx, 'tavern')
    this.root = resolve(config.root)
    this.activationTextLimit = config.activationTextLimit
    /* v8 ignore next -- the Config schema default supplies the budget, so this fallback is unreachable */
    this.activationCharBudget = config.activationCharBudget ?? 12000
    this._lean = config.lean
    this.scoreRoute = config.scoreProvider !== undefined && config.scoreModel !== undefined
      ? { provider: config.scoreProvider, model: config.scoreModel }
      : undefined
    /* v8 ignore next -- the Config schema default supplies scoreMaxTokens, so this fallback is unreachable */
    this.scoreMaxTokens = config.scoreMaxTokens ?? 500
    mkdirSync(join(this.root, 'worldbooks'), { recursive: true })
    mkdirSync(join(this.root, 'characters'), { recursive: true })
    mkdirSync(join(this.root, 'presets'), { recursive: true })
    mkdirSync(join(this.root, 'jailbreaks'), { recursive: true })
    ctx.systemPrompt.section({
      name: 'tavern:context',
      order: 40,
      text: (context) => {
        if (context.agent === undefined) return ''
        const session = context.agent.session
        const binding = foldBinding(session.events)
        if (binding === null) return ''
        try {
          const characters = binding.characterIds !== undefined && binding.characterIds.length > 0
            ? binding.characterIds.map(id => this.characterProfile(id))
            : (binding.characterId === null ? [] : [this.characterProfile(binding.characterId)])
          const activated = this.activatedLore(binding, recentText(session.events, this.activationTextLimit))
          const rendered = renderTavernSection({
            binding,
            characters,
            activated,
            lean: this.lean,
            openingPresent: hasOpeningMessage(session.events),
            ...(binding.mvuVariables === undefined ? {} : { mvuVariables: binding.mvuVariables }),
            ...(binding.presetId === undefined ? {} : { preset: this.promptPreset(binding.presetId) }),
            ...(binding.persona === undefined ? {} : { persona: binding.persona }),
            ...(binding.jailbreakId === undefined ? {} : { jailbreak: this.jailbreakFor(binding.jailbreakId) }),
          })
          // The card's prompt-side regex scripts hide variable machinery from
          // the model (e.g. "变量更新对AI不可见") and trim repetitive text.
          return applyPromptScripts(rendered, this.promptScriptsFor(binding))
        } catch (error) {
          // A tampered store must not take down every turn: degrade to an
          // empty section and let the invariant companion fail the boot.
          ctx.logger.warn('dsh-tavern: failed to render the tavern context section: %o', error)
          return ''
        }
      },
    })
  }

  /**
   * Toggle the trimmed character block at runtime. The new value applies from
   * the next prompt assembly onward.
   * @param lean - whether the prompt section renders the trimmed character block.
   */
  setLean(lean: boolean): void {
    this._lean = lean
  }

  /**
   * Import one SillyTavern lorebook export.
   * @param content - the raw worldbook JSON text.
   * @returns the stored worldbook row.
   */
  importWorldBook(content: string): WorldBookView {
    const book = parseLorebook(parseJson(content, 'worldbook'))
    const id = mintId('worldbook') as WorldBookId
    writeFileSync(join(this.root, 'worldbooks', `${id}.json`), content, 'utf-8')
    return { id, name: book.name, entryCount: book.entries.length }
  }

  /**
   * Every imported worldbook, ordered by name.
   * @returns the worldbook rows.
   */
  listWorldBooks(): WorldBookView[] {
    return this.scanStore<WorldBookView>('worldbooks', 'json', (file, id) => {
      const book = parseLorebook(parseJson(readFileSync(file, 'utf-8'), 'worldbook'))
      return { id: id as WorldBookId, name: book.name, entryCount: book.entries.length }
    })
  }

  /**
   * Delete one worldbook. Sessions whose binding still references the book
   * block the delete.
   * @param id - the worldbook id.
   */
  deleteWorldBook(id: WorldBookId): void {
    this.deleteFile('worldbooks', 'worldbook', id)
  }

  /**
   * Import one SillyTavern Chat Completion Preset (referencing the
   * `@dsh-rp/compat-sillytavern` format): prompts + prompt_order profiles are
   * normalized to ordered sections; generation parameters stay inert.
   * @param content - the preset JSON document.
   * @returns the stored preset row.
   */
  importPromptPreset(content: string): PromptPresetView {
    const preset = parsePromptPreset(content)
    const id = mintId('preset' as never) as PromptPresetId
    writeFileSync(join(this.root, 'presets', `${id}.json`), JSON.stringify(preset, null, 2), 'utf-8')
    return { id, name: preset.name, promptCount: preset.sections.length, enabledCount: preset.sections.length }
  }

  /**
   * Every imported prompt preset, ordered by name.
   * @returns the preset rows.
   */
  listPromptPresets(): PromptPresetView[] {
    return this.scanStore<PromptPresetView>('presets', 'json', (_file, id) => {
      const preset = this.promptPreset(id as PromptPresetId)
      return { id: id as PromptPresetId, name: preset.name, promptCount: preset.sections.length, enabledCount: preset.sections.length }
    })
  }

  /**
   * Delete one prompt preset. Sessions whose binding still references the
   * preset block the delete.
   * @param id - the preset id.
   */
  deletePromptPreset(id: PromptPresetId): void {
    this.deleteFile('presets', 'preset', id)
  }

  /** Load one stored prompt preset. */
  private promptPreset(id: PromptPresetId): PromptPreset {
    const file = join(this.root, 'presets', `${id}.json`)
    if (!existsSync(file)) throw new Error(`tavern: preset ${JSON.stringify(id)} not found`)
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error(`tavern: preset ${JSON.stringify(id)} is malformed`)
    const preset = parsed as PromptPreset
    return {
      name: preset.name,
      sections: Array.isArray(preset.sections) ? preset.sections : [],
      generation: preset.generation ?? {},
    }
  }

  /** The prompt text of one jailbreak preset (empty when missing). */
  private jailbreakFor(id: JailbreakId): string {
    const found = this.listJailbreaks().find(preset => preset.id === id)
    return found?.content ?? ''
  }

  /**
   * Create or update one AI-jailbreak preset (破限): a user-authored prompt
   * injected ahead of the character block to relax the model's guardrails.
   * @param id - the preset id to update, or undefined to create.
   * @param name - the display name.
   * @param content - the prompt text.
   * @returns the stored preset.
   * @throws when the name is blank, or the id is unknown.
   */
  saveJailbreak(id: JailbreakId | undefined, name: string, content: string): JailbreakPreset {
    const title = name.trim()
    if (title.length === 0) throw new Error('tavern: jailbreak name must not be empty')
    const text = content.trim()
    const targetId = id ?? mintId('jailbreak' as never) as JailbreakId
    writeFileSync(join(this.root, 'jailbreaks', `${targetId}.json`), JSON.stringify({ id: targetId, name: title, content: text }, null, 2), 'utf-8')
    return { id: targetId, name: title, content: text }
  }

  /** Every jailbreak preset, ordered by name. */
  listJailbreaks(): JailbreakPreset[] {
    return this.scanStore<JailbreakPreset>('jailbreaks', 'json', (file, id) => {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
      return {
        id: id as JailbreakId,
        name: typeof parsed.name === 'string' ? parsed.name : '未命名破限',
        content: typeof parsed.content === 'string' ? parsed.content : '',
      }
    })
  }

  /**
   * Delete one jailbreak preset. Sessions whose binding still references it
   * block the delete.
   * @param id - the jailbreak id.
   */
  deleteJailbreak(id: JailbreakId): void {
    this.deleteFile('jailbreaks', 'jailbreak', id)
  }

  /**
   * Import one character card.
   * @param fileName - the original file name; `.png` (any case) selects the
   * PNG card parser, anything else parses as JSON.
   * @param data - the raw card bytes.
   * @returns the stored character row.
   */
  importCharacter(fileName: string, data: Uint8Array): CharacterView {
    const isPng = fileName.toLowerCase().endsWith('.png')
    const raw = isPng
      ? parseCharacterPngRaw(data)
      : parseJson(new TextDecoder().decode(data), 'character')
    const profile = parseCharacterJson(raw)
    const embedded = extractEmbeddedWorldBook(raw)
    if (embedded !== null) {
      // A card with an embedded worldbook brings its worldbook with it, so the
      // roleplay binding can activate its entries without a separate import.
      this.importWorldBook(JSON.stringify({ name: embedded.name, entries: embedded.entries }))
    }
    const id = mintId('character') as CharacterId
    writeFileSync(join(this.root, 'characters', `${id}.${isPng ? 'png' : 'json'}`), data)
    return { id, name: profile.name, format: isPng ? 'png' : 'json' }
  }

  /**
   * Every imported character, ordered by name.
   * @returns the character rows.
   */
  listCharacters(): CharacterView[] {
    return ['json', 'png']
      .flatMap(extension => this.scanStore<CharacterView>('characters', extension, (file, id) => {
        const profile = this.characterFile(file, extension)
        return { id: id as CharacterId, name: profile.name, format: extension as 'json' | 'png' }
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Delete one character card. Sessions whose binding still references the
   * card block the delete.
   * @param id - the character id.
   */
  deleteCharacter(id: CharacterId): void {
    this.deleteFile('characters', 'character', id)
  }

  /**
   * Load one worldbook.
   * @param id - the worldbook id.
   * @returns the parsed lorebook.
   */
  worldBook(id: WorldBookId): Lorebook {
    validateId('worldbook', id)
    return parseLorebook(parseJson(readFileSync(join(this.root, 'worldbooks', `${id}.json`), 'utf-8'), 'worldbook'))
  }

  /**
   * Toggle one worldbook entry's `enabled` flag in the stored file, so the
   * manual per-entry switch persists across sessions (SillyTavern's book
   * editor behaves the same way). The card frontend's session-level overrides
   * continue to apply on top of this.
   * @param id - the worldbook id.
   * @param entryName - the entry's display name (or comment fallback).
   * @param enabled - the new enabled state.
   * @returns true when the entry was updated.
   * @throws when the worldbook or entry is missing.
   */
  setWorldBookEntryEnabled(id: WorldBookId, entryName: string, enabled: boolean): boolean {
    validateId('worldbook', id)
    const file = join(this.root, 'worldbooks', `${id}.json`)
    if (!existsSync(file)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} not found`)
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { entries?: Array<Record<string, unknown>> }
    if (!Array.isArray(raw.entries)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} has no entries array`)
    let found = false
    for (const row of raw.entries) {
      if (typeof row !== 'object' || row === null) continue
      const name = row.name ?? row.comment ?? ''
      if (name !== entryName) continue
      row.enabled = enabled
      found = true
    }
    if (!found) throw new Error(`tavern: worldbook ${JSON.stringify(id)} has no entry named ${JSON.stringify(entryName)}`)
    writeFileSync(file, JSON.stringify(raw, null, 2))
    return true
  }

  /**
   * Add or update one worldbook entry in the stored file. An entry whose name
   * (or comment fallback) matches an existing row updates it; otherwise a new
   * row is appended.
   * @param id - the worldbook id.
   * @param entry - the entry fields; omitted fields keep their values on update.
   * @returns true when the entry was written.
   * @throws when the worldbook is missing or the name is blank.
   */
  saveWorldBookEntry(id: WorldBookId, entry: { name: string; keys?: string[]; content?: string; comment?: string; enabled?: boolean }): boolean {
    validateId('worldbook', id)
    const file = join(this.root, 'worldbooks', `${id}.json`)
    if (!existsSync(file)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} not found`)
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { entries?: Array<Record<string, unknown>> }
    if (!Array.isArray(raw.entries)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} has no entries array`)
    const name = entry.name.trim()
    if (name.length === 0) throw new Error('tavern: entry name must not be empty')
    const existing = raw.entries.find(row => row?.name === name || (row?.name === undefined && row?.comment === name))
    const patch: Record<string, unknown> = {}
    if (entry.keys !== undefined) patch.keys = [...entry.keys]
    if (entry.content !== undefined) patch.content = entry.content
    if (entry.comment !== undefined) patch.comment = entry.comment
    if (entry.enabled !== undefined) patch.enabled = entry.enabled
    if (existing !== undefined) {
      Object.assign(existing, patch)
    } else {
      raw.entries.push({
        name,
        keys: entry.keys ?? [],
        content: entry.content ?? '',
        comment: entry.comment ?? '',
        enabled: entry.enabled ?? true,
        ...patch,
      })
    }
    writeFileSync(file, JSON.stringify(raw, null, 2))
    return true
  }

  /**
   * Delete one worldbook entry from the stored file.
   * @param id - the worldbook id.
   * @param name - the entry's display name (or comment fallback).
   * @returns true when the entry was removed.
   * @throws when the worldbook or entry is missing.
   */
  deleteWorldBookEntry(id: WorldBookId, name: string): boolean {
    validateId('worldbook', id)
    const file = join(this.root, 'worldbooks', `${id}.json`)
    if (!existsSync(file)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} not found`)
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { entries?: Array<Record<string, unknown>> }
    if (!Array.isArray(raw.entries)) throw new Error(`tavern: worldbook ${JSON.stringify(id)} has no entries array`)
    const before = raw.entries.length
    raw.entries = raw.entries.filter(row => !(row?.name === name || (row?.name === undefined && row?.comment === name)))
    if (raw.entries.length === before) throw new Error(`tavern: worldbook ${JSON.stringify(id)} has no entry named ${JSON.stringify(name)}`)
    writeFileSync(file, JSON.stringify(raw, null, 2))
    return true
  }

  /**
   * Load one character card.
   * @param id - the character id.
   * @returns the projected profile.
   */
  characterProfile(id: CharacterId): CharacterProfile {
    validateId('character', id)
    const file = this.storeFile('characters', 'character', id)
    if (file === undefined) throw new Error(`tavern: character ${JSON.stringify(id)} not found`)
    const profile = this.characterFile(file, file.endsWith('.png') ? 'png' : 'json')
    // Editor overrides (written by updateCharacter) take precedence, so the
    // card file itself stays untouched — PNG cards never get re-encoded.
    const override = this.characterOverride(id)
    if (override === null) return profile
    return {
      ...profile,
      name: override.name ?? profile.name,
      description: override.description ?? profile.description,
      personality: override.personality ?? profile.personality,
      scenario: override.scenario ?? profile.scenario,
      mesExample: override.mesExample ?? profile.mesExample,
    }
  }

  /** The editor override file of one card, or null when none was written. */
  private characterOverride(id: CharacterId): {
    name?: string
    description?: string
    personality?: string
    scenario?: string
    mesExample?: string
    scriptOverrides?: Record<string, { enabled?: boolean; findRegex?: string; replaceString?: string; markdownOnly?: boolean; promptOnly?: boolean }>
  } | null {
    const file = join(this.root, 'characters', `${id}.override.json`)
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
      const scripts = parsed.scriptOverrides
      return {
        ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
        ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
        ...(typeof parsed.personality === 'string' ? { personality: parsed.personality } : {}),
        ...(typeof parsed.scenario === 'string' ? { scenario: parsed.scenario } : {}),
        ...(typeof parsed.mesExample === 'string' ? { mesExample: parsed.mesExample } : {}),
        ...(typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts) ? { scriptOverrides: scripts as Record<string, { enabled?: boolean; findRegex?: string; replaceString?: string; markdownOnly?: boolean; promptOnly?: boolean }> } : {}),
      }
    } catch {
      return null
    }
  }

  /** The card's raw extensions with any script overrides merged in, so the
   *  editor's regex tweaks flow into rendering and prompt injection alike. */
  private mergedExtensions(id: CharacterId, format: 'json' | 'png'): Record<string, unknown> {
    const extensions = this.characterExtensions(id, format)
    const override = this.characterOverride(id)
    if (override === null || override.scriptOverrides === undefined) return extensions
    const regexes = extensions.regex_scripts
    if (!Array.isArray(regexes)) return extensions
    const merged = regexes.map((item) => {
      if (typeof item !== 'object' || item === null) return item
      const row = item as Record<string, unknown>
      const name = typeof row.scriptName === 'string' ? row.scriptName : ''
      const patch = override.scriptOverrides?.[name]
      if (patch === undefined) return item
      return {
        ...row,
        ...(patch.enabled === undefined ? {} : { disabled: !patch.enabled }),
        ...(patch.findRegex === undefined ? {} : { findRegex: patch.findRegex }),
        ...(patch.replaceString === undefined ? {} : { replaceString: patch.replaceString }),
        ...(patch.markdownOnly === undefined ? {} : { markdownOnly: patch.markdownOnly }),
        ...(patch.promptOnly === undefined ? {} : { promptOnly: patch.promptOnly }),
      }
    })
    return { ...extensions, regex_scripts: merged }
  }

  /**
   * Update one character card's regex scripts (enabled flag, find/replace
   * strings). Overrides are stored in the sidecar file and merged at use time.
   * @param id - the character card.
   * @param overrides - per-script patches keyed by script name.
   * @returns the updated script list (name, enabled, findRegex, replaceString).
   */
  updateCharacterScripts(
    id: CharacterId,
    overrides: Array<{ name: string; enabled?: boolean; findRegex?: string; replaceString?: string }>,
  ): Array<{ name: string; enabled: boolean; findRegex: string; replaceString: string }> {
    validateId('character', id)
    const file = this.storeFile('characters', 'character', id)
    if (file === undefined) throw new Error(`tavern: character ${JSON.stringify(id)} not found`)
    const base = this.characterOverride(id) ?? {}
    const next = {
      ...base,
      scriptOverrides: {
        ...(base.scriptOverrides ?? {}),
        ...Object.fromEntries(overrides
          .filter(patch => patch.name.trim().length > 0)
          .map(patch => [patch.name.trim(), {
            ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
            ...(patch.findRegex === undefined ? {} : { findRegex: patch.findRegex }),
            ...(patch.replaceString === undefined ? {} : { replaceString: patch.replaceString }),
          }])),
      },
    }
    writeFileSync(join(this.root, 'characters', `${id}.override.json`), JSON.stringify(next, null, 2), 'utf-8')
    const format = file.endsWith('.png') ? 'png' : 'json'
    const extensions = this.mergedExtensions(id, format)
    const regexes = extensions.regex_scripts
    if (!Array.isArray(regexes)) return []
    return regexes.map((item) => {
      if (typeof item !== 'object' || item === null) return { name: '', enabled: false, findRegex: '', replaceString: '' }
      const row = item as Record<string, unknown>
      return {
        name: typeof row.scriptName === 'string' ? row.scriptName : '',
        enabled: row.disabled !== true,
        findRegex: typeof row.findRegex === 'string' ? row.findRegex : '',
        replaceString: typeof row.replaceString === 'string' ? row.replaceString : '',
      }
    })
  }

  /**
   * Update one character card's editor fields. Overrides are stored in a
   * sidecar file, so JSON and PNG cards alike are updated without touching
   * the original bytes; the override takes precedence at prompt build time.
   * @param id - the character card.
   * @param fields - the fields to update; omitted fields keep their values.
   * @returns the updated profile view.
   */
  updateCharacter(id: CharacterId, fields: { name?: string; description?: string; personality?: string; scenario?: string; mesExample?: string }): CharacterProfile {
    validateId('character', id)
    const file = this.storeFile('characters', 'character', id)
    if (file === undefined) throw new Error(`tavern: character ${JSON.stringify(id)} not found`)
    const base = this.characterOverride(id) ?? {}
    const next = { ...base }
    for (const key of ['name', 'description', 'personality', 'scenario', 'mesExample'] as const) {
      const value = fields[key]
      if (typeof value !== 'string') continue
      const text = value.trim()
      if (text.length === 0) {
        delete next[key]
      } else {
        next[key] = text
      }
    }
    writeFileSync(join(this.root, 'characters', `${id}.override.json`), JSON.stringify(next, null, 2), 'utf-8')
    return this.characterProfile(id)
  }

  /**
   * The project explorer tree: every worldbook with its entries, and every
   * character with its raw extension fields and portrait-image availability.
   * @returns the tree.
   */
  projectTree(): TavernProjectTree {
    const worldbooks = this.listWorldBooks().map((view) => {
      const book = this.worldBook(view.id)
      return {
        id: view.id,
        name: view.name,
        entries: book.entries.map(entry => ({
          name: entry.name,
          keys: [...entry.keys],
          content: entry.content,
          comment: entry.comment,
          enabled: entry.enabled,
        })),
      }
    })
    const characters = this.listCharacters().map((view) => {
      const profile = this.characterProfile(view.id)
      return {
        id: view.id,
        name: view.name,
        format: view.format,
        extensions: this.mergedExtensions(view.id, view.format),
        hasAvatar: view.format === 'png',
        // The card's opening messages: first_mes plus every alternate greeting,
        // so the chat can preload the scene the way SillyTavern does.
        greetings: [
          ...(profile.firstMes.length === 0 ? [] : [profile.firstMes]),
          ...profile.alternateGreetings,
        ],
        // The card's editor fields, for the SillyTavern-style character editor.
        description: profile.description,
        personality: profile.personality,
        scenario: profile.scenario,
        mesExample: profile.mesExample,
        tags: [...profile.tags],
      }
    })
    return { worldbooks, characters }
  }

  /**
   * The stored character card's portrait image as base64. PNG cards carry
   * their portrait as the file itself; JSON cards have no embedded image.
   * @param id - the character card.
   * @returns the base64 PNG bytes.
   */
  characterImage(id: CharacterId): string {
    validateId('character', id)
    const file = this.storeFile('characters', 'character', id)
    if (file === undefined) throw new Error(`tavern: character ${JSON.stringify(id)} not found`)
    if (!file.endsWith('.png')) throw new Error(`tavern: character ${JSON.stringify(id)} has no embedded image`)
    return readFileSync(file).toString('base64')
  }

  /** The raw `extensions` object of one stored character card. */
  private characterExtensions(id: CharacterId, format: 'json' | 'png'): Record<string, unknown> {
    const file = this.storeFile('characters', 'character', id)
    if (file === undefined) return {}
    const raw = format === 'png'
      ? parseCharacterPngRaw(readFileSync(file))
      : parseJson(new TextDecoder().decode(readFileSync(file)), 'character')
    if (typeof raw !== 'object' || raw === null) return {}
    let source = raw as Record<string, unknown>
    if (typeof source.spec === 'string' && source.data !== null && typeof source.data === 'object' && !Array.isArray(source.data)) {
      source = source.data as Record<string, unknown>
    }
    const extensions = source.extensions
    return extensions !== null && typeof extensions === 'object' && !Array.isArray(extensions)
      ? extensions as Record<string, unknown>
      : {}
  }

  /** The prompt-side (`promptOnly`) regex scripts of the binding's first
   *  character card, applied to the rendered section so variable machinery
   *  stays invisible to the model. */
  private promptScriptsFor(binding: TavernBindingData): PromptScript[] {
    const id = (binding.characterIds ?? (binding.characterId === null ? [] : [binding.characterId]))[0]
    if (id === undefined) return []
    const view = this.listCharacters().find(card => card.id === id)
    if (view === undefined) return []
    const extensions = this.mergedExtensions(view.id, view.format)
    const regexes = extensions.regex_scripts
    if (!Array.isArray(regexes)) return []
    const scripts: PromptScript[] = []
    for (const item of regexes) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      scripts.push({
        findRegex: typeof row.findRegex === 'string' ? row.findRegex : '',
        replaceString: typeof row.replaceString === 'string' ? row.replaceString : '',
        enabled: row.disabled !== true,
        promptOnly: row.promptOnly === true,
      })
    }
    return scripts
  }

  /**
   * Model-assess one character card's quality through the LLM service.
   * @param id - the character card to score.
   * @param signal - optional caller cancellation.
   * @returns the structured score, failing loud when no llm service or scoring route exists.
   */
  async scoreCharacter(id: CharacterId, signal?: AbortSignal): Promise<CardScore> {
    if (this.scoreRoute === undefined) {
      throw new Error('tavern: card scoring requires scoreProvider and scoreModel in the configuration')
    }
    const llm = this.ctx.get('llm')
    if (llm === undefined) {
      throw new Error('tavern: card scoring requires the llm service')
    }
    const profile = this.characterProfile(id)
    const system = [
      '你是角色卡质量评审员。根据角色设定的清晰度、内部一致性、token 效率三个维度，',
      '对下面的角色卡 JSON 评分。返回严格 JSON：',
      '{"overall":<0-10>,"clarity":<0-10>,"consistency":<0-10>,"tokenEfficiency":<0-10>,"note":"<一句话改进建议>"}',
    ].join('\n')
    const messages = [createUserMessage({
      content: [{ type: 'text', text: JSON.stringify(profile) }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' },
    })]
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream({
      provider: this.scoreRoute.provider,
      model: this.scoreRoute.model,
      messages,
      system,
      maxTokens: this.scoreMaxTokens,
      ...(signal === undefined ? {} : { signal }),
    })) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
      throw new Error(`tavern: card scoring failed: ${finish.failure.message}`)
    }
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
    return parseScore(text)
  }

  /**
   * The activated lore of one binding against one text window, capped by the
   * injected-character budget. Activation scans every enabled entry (constant
   * entries always fire; the rest need keyword matches, plus secondary keys
   * when selective); the survivors are sorted by insertion order and the head
   * of the list is kept until the budget is exhausted — a 100+ entry lorebook
   * can otherwise inject tens of thousands of tokens into every assembly.
   * @param binding - the binding to load.
   * @param text - the text window to activate against.
   * @returns the activated entries in insertion order, worldbook by worldbook,
   * truncated to the character budget.
   */
  activatedLore(binding: TavernBindingData, text: string): ActivatedLore[] {
    const stage = binding.stage ?? 0
    const activated: ActivatedLore[] = []
    for (const id of binding.worldbookIds) {
      const book = this.worldBook(id)
      activated.push(...activateEntries(book.entries, text, binding.disabledEntryNames)
        .filter(match => match.entry.stage === 0 || match.entry.stage === stage)
        .map(match => ({
          bookId: id,
          bookName: book.name,
          entry: match.entry,
          matchedKeys: match.matchedKeys,
        })))
    }
    activated.sort((a, b) => a.entry.insertionOrder - b.entry.insertionOrder)
    let chars = 0
    let dropped = 0
    const kept: ActivatedLore[] = []
    for (const match of activated) {
      chars += match.entry.content.length
      if (chars > this.activationCharBudget && kept.length > 0) {
        dropped += 1
        continue
      }
      kept.push(match)
    }
    if (dropped > 0) {
      this.ctx.logger.warn(
        'dsh-tavern: lore injection exceeded the %d-char budget; dropped %d of %d activated entries',
        this.activationCharBudget, dropped, activated.length,
      )
    }
    return kept
  }

  /**
   * Advance one session's lorebook activation stage by one and record the new
   * binding. Entries on stage zero always stay active; the raised stage moves
   * the session into the next staged set.
   * @param sessionId - the attached session to advance.
   * @returns the new binding.
   * @throws when the session is unattached or carries no binding.
   */
  advanceStage(sessionId: string): TavernBindingData {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error(`tavern: session ${JSON.stringify(sessionId)} is not attached`)
    const binding = foldBinding(session.events)
    if (binding === null) throw new Error(`tavern: session ${JSON.stringify(sessionId)} has no binding`)
    const next: TavernBindingData = { ...binding, stage: (binding.stage ?? 0) + 1 }
    session.append('tavern/binding', next)
    return next
  }

  /**
   * Write the character's opening message into the session log as the first
   * assistant message, so the model continues from it instead of being told to
   * re-open with the card's `first_mes` (the prompt section detects the opening
   * and skips that instruction). SillyTavern behaves this way: the greeting is
   * a real first message.
   * @param sessionId - the attached session to open.
   * @param greeting - the opening message text (e.g. a card greeting).
   * @returns true when the opening was written.
   * @throws when the session is unattached, the greeting is blank, the opening
   * was already written, or the conversation already has a user message.
   */
  setGreeting(sessionId: string, greeting: string): boolean {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error(`tavern: session ${JSON.stringify(sessionId)} is not attached`)
    const text = greeting.trim()
    if (text.length === 0) throw new Error('tavern: greeting must not be empty')
    if (hasOpeningMessage(session.events)) throw new Error('tavern: the opening message is already written to this session')
    let sawUser = false
    for (const event of session.events) {
      if (event.type !== 'user/message') continue
      const source = (event.data as { source?: { kind?: string } } | undefined)?.source
      if (source?.kind === 'user') sawUser = true
    }
    if (sawUser) throw new Error('tavern: the conversation already started; the opening can only be written before the first user message')
    session.append('assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: `opening-${randomUUID()}` as never,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'dsh-tavern', model: 'opening' },
      },
    }, { surfaceOp: 'append' })
    return true
  }

  /**
   * Replace one session's MVU variable state (SillyTavern card variables).
   * The values are injected into the prompt as `## 角色状态`; the card
   * frontend updates them through the bridge and the model through
   * `<json_patch>` blocks.
   * @param sessionId - the attached session to update.
   * @param variables - the new flat variable map.
   * @returns the new binding.
   * @throws when the session is unattached or carries no binding.
   */
  setMvuVariables(sessionId: string, variables: Record<string, string>): TavernBindingData {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error(`tavern: session ${JSON.stringify(sessionId)} is not attached`)
    const binding = foldBinding(session.events)
    if (binding === null) throw new Error(`tavern: session ${JSON.stringify(sessionId)} has no binding`)
    const next: TavernBindingData = { ...binding, mvuVariables: { ...variables } }
    session.append('tavern/binding', next)
    return next
  }

  /**
   * Replace one session's user persona text (SillyTavern Persona), injected
   * into the prompt (the `personaDescription` marker / a persona block).
   * @param sessionId - the attached session to update.
   * @param persona - the persona text; blank clears it.
   * @returns the new binding.
   * @throws when the session is unattached or carries no binding.
   */
  setPersona(sessionId: string, persona: string): TavernBindingData {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error(`tavern: session ${JSON.stringify(sessionId)} is not attached`)
    const binding = foldBinding(session.events)
    if (binding === null) throw new Error(`tavern: session ${JSON.stringify(sessionId)} has no binding`)
    const text = persona.trim()
    const { persona: _dropped, ...rest } = binding
    const next: TavernBindingData = { ...rest, ...(text.length === 0 ? {} : { persona: text }) }
    session.append('tavern/binding', next)
    return next
  }

  /**
   * Import a SillyTavern Chat JSONL export into an attached session: the
   * header row is skipped, then each message row is appended as a user or
   * assistant message (is_user true → user, else assistant). Malformed rows
   * are skipped; the conversation must not have started yet.
   * @param sessionId - the attached session to fill.
   * @param content - the UTF-8 JSONL text.
   * @returns how many messages were imported.
   * @throws when the session is unattached, or the log already has messages.
   */
  importChat(sessionId: string, content: string): number {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (session === undefined) throw new Error(`tavern: session ${JSON.stringify(sessionId)} is not attached`)
    if (session.events.some(event => event.type === 'user/message' || event.type === 'assistant/message')) {
      throw new Error('tavern: the session already has messages; import into a fresh session')
    }
    const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0)
    let imported = 0
    let turn = 0
    let step = 0
    for (const [index, line] of lines.entries()) {
      if (index === 0) continue // header row
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof row !== 'object' || row === null) continue
      const record = row as Record<string, unknown>
      const mes = typeof record.mes === 'string' ? record.mes : ''
      if (mes.length === 0) continue
      const isUser = record.is_user === true
      const messageId = `import-${index}` as never
      if (isUser) {
        session.append('user/message', {
          id: messageId,
          role: 'user',
          content: [{ type: 'text', text: mes }],
          source: { kind: 'user' },
        }, { surfaceOp: 'append' })
        turn += 1
        step = 0
      } else {
        session.append('assistant/message', {
          turn,
          step,
          message: {
            id: messageId,
            role: 'assistant',
            content: [{ type: 'text', text: mes }],
            source: { kind: 'model', provider: 'dsh-tavern', model: 'import' },
          },
        }, { surfaceOp: 'append' })
        step += 1
      }
      imported += 1
    }
    return imported
  }

  /**
   * The binding folded from one attached session's log.
   * @param sessionId - the session to fold.
   * @returns the binding, or null when the session is unattached or unbinding.
   */
  bindingOf(sessionId: string): TavernBindingData | null {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    return session === undefined ? null : foldBinding(session.events)
  }

  /**
   * Audit every attached session's binding against the store files.
   * @returns the dangling references found.
   */
  checkBindings(): DanglingBinding[] {
    const dangling: DanglingBinding[] = []
    for (const session of this.ctx.sessions.list()) {
      const binding = foldBinding(session.events)
      if (binding === null) continue
      for (const id of binding.worldbookIds) {
        if (this.storeFile('worldbooks', 'worldbook', id) === undefined) {
          dangling.push({ sessionId: session.id, kind: 'worldbook', id })
        }
      }
      if (binding.characterId !== null && this.storeFile('characters', 'character', binding.characterId) === undefined) {
        dangling.push({ sessionId: session.id, kind: 'character', id: binding.characterId })
      }
    }
    return dangling
  }

  /** Parse one stored character file by its extension. */
  private characterFile(file: string, extension: string): CharacterProfile {
    const data = readFileSync(file)
    return extension === 'png'
      ? parseCharacterPng(data)
      : parseCharacterJson(parseJson(new TextDecoder().decode(data), 'character'))
  }

  /** Scan one store directory, parsing every file of one extension. */
  private scanStore<T>(directory: 'worldbooks' | 'characters' | 'presets' | 'jailbreaks', extension: string, project: (file: string, id: string) => T): T[] {
    return readdirSync(join(this.root, directory))
      .filter(name => name.endsWith(`.${extension}`))
      .filter(name => !name.endsWith(`.override.${extension}`))
      .map(name => project(join(this.root, directory, name), name.slice(0, -extension.length - 1)))
  }

  /** The existing store file of one id, or undefined. */
  private storeFile(directory: 'worldbooks' | 'characters' | 'presets' | 'jailbreaks', kind: 'worldbook' | 'character' | 'preset' | 'jailbreak' | 'jailbreak', id: string): string | undefined {
    validateId(kind as 'worldbook' | 'character', id)
    return STORE_EXTENSIONS[directory]
      .map(candidate => join(this.root, directory, `${id}.${candidate}`))
      .find(existsSync)
  }

  /** Delete one store file, blocked while any attached session binds it. */
  private deleteFile(directory: 'worldbooks' | 'characters' | 'presets' | 'jailbreaks', kind: 'worldbook' | 'character' | 'preset' | 'jailbreak' | 'jailbreak', id: string): void {
    validateId(kind as 'worldbook' | 'character', id)
    const bound = this.boundSessions(kind, id)
    if (bound.length > 0) {
      throw new Error(`tavern: ${kind} ${JSON.stringify(id)} is still bound by session(s) ${bound.join(', ')}`)
    }
    const file = this.storeFile(directory, kind, id)
    if (file === undefined) throw new Error(`tavern: ${kind} ${JSON.stringify(id)} not found`)
    rmSync(file)
  }

  /** Every attached session whose folded binding references one store id. */
  private boundSessions(kind: 'worldbook' | 'character' | 'preset' | 'jailbreak' | 'jailbreak', id: string): string[] {
    const sessions: string[] = []
    for (const session of this.ctx.sessions.list()) {
      const binding = foldBinding(session.events)
      if (binding === null) continue
      const references = kind === 'jailbreak'
        ? binding.jailbreakId === (id as JailbreakId)
        : kind === 'worldbook'
        ? binding.worldbookIds.includes(id as WorldBookId)
        : kind === 'character'
          ? binding.characterId === (id as CharacterId) || (binding.characterIds ?? []).includes(id as CharacterId)
          : binding.presetId === (id as PromptPresetId)
      if (references) sessions.push(session.id)
    }
    return sessions
  }
}

/** Parse one JSON import with a boundary-naming error. */
function parseJson(content: string, kind: 'worldbook' | 'character'): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`tavern: ${kind} content is not valid JSON`, { cause: error })
  }
}

export default TavernService
