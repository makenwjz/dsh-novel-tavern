import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier of one imported lorebook, minted by the service. */
export type WorldBookId = Branded<'tavern:worldbook'>
/** Opaque identifier of one imported character card, minted by the service. */
export type CharacterId = Branded<'tavern:character'>
/** The per-session injection mode: novel writing or tavern roleplay. */
export type TavernMode = 'novel' | 'tavern'

/** One SillyTavern lorebook entry normalized to the supported field subset. */
export interface LorebookEntry {
  /** The entry's display name (cards address entries by name to toggle them). */
  readonly name: string
  /** Keywords that activate the entry; a non-selective entry with none can never activate. */
  readonly keys: string[]
  /** Secondary keywords required in addition when `selective` is true. */
  readonly secondaryKeys: string[]
  /** Editor note, never injected into prompts. */
  readonly comment: string
  /** The entry body injected when the entry activates. */
  readonly content: string
  /** Always-active entry, independent of keywords. */
  readonly constant: boolean
  /** Requires at least one secondary keyword alongside a primary match. */
  readonly selective: boolean
  /** Lower values inject earlier; equal values keep import order. */
  readonly insertionOrder: number
  /** Disabled entries never activate. */
  readonly enabled: boolean
  /** Case-sensitive keyword matching; false matches case-insensitively. */
  readonly caseSensitive: boolean
  /** Activation stage: absent or 0 activates on every stage, a positive value only on the matching binding stage. */
  readonly stage?: number
}

/** One parsed SillyTavern lorebook (JSON worldbook import). */
export interface Lorebook {
  /** The worldbook name shown in management lists. */
  readonly name: string
  /** The entries in import order. */
  readonly entries: LorebookEntry[]
}

/** One entry activated against a text window, with the keywords that matched. */
export interface ActivatedLore {
  /** The owning worldbook's id. */
  readonly bookId: WorldBookId
  /** The owning worldbook's name for prompt attribution. */
  readonly bookName: string
  /** The activated entry. */
  readonly entry: LorebookEntry
  /** The primary keywords that matched the text window. */
  readonly matchedKeys: string[]
}

/** The character card fields the store projects. */
export interface CharacterProfile {
  /** The character's name; `{{char}}` substitutes to it. */
  readonly name: string
  /** Free-form character description. */
  readonly description: string
  /** Personality traits. */
  readonly personality: string
  /** The opening scene or setting the card establishes. */
  readonly scenario: string
  /** The character's first message; tavern mode opens with it. */
  readonly firstMes: string
  /** Example dialogue lines showing tone and style. */
  readonly mesExample: string
  /** System-level instructions the card carries. */
  readonly systemPrompt: string
  /** Post-history instructions the card carries. */
  readonly postHistoryInstructions: string
  /** Alternate greeting messages. */
  readonly alternateGreetings: string[]
  /** Card tags. */
  readonly tags: string[]
  /** Card author. */
  readonly creator: string
  /** Card format version: `2`, `3`, or the card's own value. */
  readonly characterVersion: string
  /** MVU-style status variables from `extensions.mvu.variables`, injected as a status block. */
  readonly mvuVariables: Readonly<Record<string, string>>
}

/** One lorebook row in management lists. */
export interface WorldBookView {
  /** The stored lorebook's id. */
  readonly id: WorldBookId
  /** The lorebook's name. */
  readonly name: string
  /** The number of entries it holds. */
  readonly entryCount: number
}

/** One character row in management lists. */
export interface CharacterView {
  /** The stored card's id. */
  readonly id: CharacterId
  /** The card's character name. */
  readonly name: string
  /** The file format the card was imported as. */
  readonly format: 'json' | 'png'
}

/** One worldbook entry in the project explorer view. */
export interface WorldBookEntryView {
  /** The entry's display name (cards address entries by name). */
  readonly name: string
  /** Keywords that activate the entry. */
  readonly keys: readonly string[]
  /** The entry body. */
  readonly content: string
  /** The editor note. */
  readonly comment: string
  /** Whether the entry is enabled in the stored file. */
  readonly enabled: boolean
}

/** One character row in the project explorer view. */
export interface CharacterProjectView {
  /** The stored card's id. */
  readonly id: CharacterId
  /** The card's character name. */
  readonly name: string
  /** The file format the card was imported as. */
  readonly format: 'json' | 'png'
  /** The card's raw `extensions` object (scripts, MVU, tool fields). */
  readonly extensions: Readonly<Record<string, unknown>>
  /** Whether the card carries an embedded portrait image (PNG cards do). */
  readonly hasAvatar: boolean
  /** The card's opening messages: first_mes plus every alternate greeting. */
  readonly greetings: readonly string[]
}

/** One worldbook in the project explorer view, with its entries. */
export interface WorldBookProjectView {
  /** The stored lorebook's id. */
  readonly id: WorldBookId
  /** The lorebook's name. */
  readonly name: string
  /** The entries, in import order. */
  readonly entries: readonly WorldBookEntryView[]
}

/** The full project explorer tree: worldbooks with entries and characters with extensions. */
export interface TavernProjectTree {
  /** The imported worldbooks. */
  readonly worldbooks: readonly WorldBookProjectView[]
  /** The imported character cards. */
  readonly characters: readonly CharacterProjectView[]
}

/** The per-session binding, recorded as a `tavern/binding` session event. */
export interface TavernBindingData {
  /** The injection mode: novel writing or tavern roleplay. */
  readonly mode: TavernMode
  /** Worldbooks whose activated entries inject into the session's prompts. */
  readonly worldbookIds: WorldBookId[]
  /** The character card to roleplay in tavern mode; null in novel mode. */
  readonly characterId: CharacterId | null
  /** The character cards to roleplay in multi-character mode; takes precedence over `characterId`. */
  readonly characterIds?: CharacterId[]
  /** The lorebook activation stage; entries with a matching positive stage activate. */
  readonly stage?: number
  /** Worldbook entry NAMES this session keeps disabled, regardless of keywords.
   *  Cards drive this through their frontend (e.g. playthrough/chapter toggles)
   *  to switch which lore context stays active. */
  readonly disabledEntryNames?: string[]
  /** The session's MVU variable state (SillyTavern card variables), injected
   *  into the prompt as `## 角色状态`. Cards update it through the bridge
   *  (`replaceMvuData`) and through the model's `<json_patch>` blocks. */
  readonly mvuVariables?: Readonly<Record<string, string>>
}

/** One dangling binding reference found by the invariant check. */
export interface DanglingBinding {
  /** The session whose binding carries the dangling reference. */
  readonly sessionId: string
  /** Which store the reference targets. */
  readonly kind: 'worldbook' | 'character'
  /** The referenced id with no matching store file. */
  readonly id: string
}

/** Structured model-assessed quality score of one character card. */
export interface CardScore {
  /** Overall 0-10 quality rating. */
  readonly overall: number
  /** 0-10 clarity rating. */
  readonly clarity: number
  /** 0-10 internal-consistency rating. */
  readonly consistency: number
  /** 0-10 token-efficiency rating. */
  readonly tokenEfficiency: number
  /** Free-form improvement note. */
  readonly note: string
}
