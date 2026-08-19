/**
 * tavern domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId.
 *
 * The tavern store is process-wide (one lorebook + character card store per
 * host), while the binding is per-session: `tavern/binding` session events
 * are the durable source of truth, so every read folds them back from the
 * log and every write appends one event. Store mutations (import/delete)
 * need no session; binding reads and writes name one.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CardScore, CharacterId, TavernBindingData, WorldBookId } from '@deepseek-ai/dsh-tavern/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One lorebook list row: the store view minus the entry bodies. */
export interface TavernWorldBookView {
  readonly id: WorldBookId
  readonly name: string
  readonly entryCount: number
}

/** One character card list row: the store view minus the profile fields. */
export interface TavernCharacterView {
  readonly id: CharacterId
  readonly name: string
  readonly format: 'json' | 'png'
}

/** The wire form of a per-session tavern binding. */
export type TavernBindingWire = TavernBindingData

/**
 * tavern-domain unary methods. Store reads and imports are pure store
 * operations; binding methods fold or append `tavern/binding` events, and
 * startRoleplay additionally ensures the session's agent is live so the
 * prompt section renders the roleplay directive on the next turn.
 */
export interface TavernApi {
  /** List the imported lorebooks in name order. */
  listWorldBooks(request: RpcRequest<{}>): Promise<RpcResponse<{ worldbooks: TavernWorldBookView[] }>>

  /** Import one SillyTavern lorebook JSON export into the store. */
  importWorldBook(request: RpcRequest<{ content: string }>): Promise<RpcResponse<{ worldbook: TavernWorldBookView }>>

  /** Delete a lorebook, failing loud while any session's binding references it. */
  deleteWorldBook(request: RpcRequest<{ id: WorldBookId }>): Promise<RpcResponse<{ deleted: true }>>

  /** Toggle one worldbook entry's enabled flag in the stored file. */
  setWorldBookEntryEnabled(request: RpcRequest<{ id: WorldBookId; entryName: string; enabled: boolean }>): Promise<RpcResponse<{ updated: true }>>

  /** List the imported character cards in name order. */
  listCharacters(request: RpcRequest<{}>): Promise<RpcResponse<{ characters: TavernCharacterView[] }>>

  /** Import one character card: JSON text or PNG bytes (`chara`/`ccv3` text chunk). */
  importCharacter(request: RpcRequest<{ fileName: string; bytesB64: string }>):
  Promise<RpcResponse<{ character: TavernCharacterView }>>

  /** Delete a character card, failing loud while any session's binding references it. */
  deleteCharacter(request: RpcRequest<{ id: CharacterId }>): Promise<RpcResponse<{ deleted: true }>>

  /** Fold the session's latest binding from its log (null when none). */
  binding(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ binding: TavernBindingWire | null }>>

  /**
   * Replace the session's binding: every referenced store id must exist and
   * the payload must be a well-formed binding; the committed event is the
   * echo.
   */
  setBinding(request: RpcRequest<{ sessionId: SessionId; binding: TavernBindingWire }>):
  Promise<RpcResponse<{ binding: TavernBindingWire }>>

  /** Enter tavern mode: ensure the session's agent, then bind it to the roleplay. */
  startRoleplay(request: RpcRequest<{
    sessionId: SessionId
    characterId?: CharacterId
    characterIds?: CharacterId[]
    worldbookIds: WorldBookId[]
  }>): Promise<RpcResponse<{ binding: TavernBindingWire }>>

  /** Leave tavern mode: keep the lorebook binding, drop the character. */
  stopRoleplay(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ binding: TavernBindingWire | null }>>

  /** Read the current lean toggle. */
  lean(request: RpcRequest<{}>): Promise<RpcResponse<{ lean: boolean }>>

  /**
   * Toggle lean mode: the tavern prompt section trims its character block, and
   * automatic session-title generation stops when the title service is composed.
   * @returns the resulting lean state.
   */
  setLean(request: RpcRequest<{ lean: boolean }>): Promise<RpcResponse<{ lean: boolean }>>

  /**
   * Advance one session's lorebook activation stage and record the new binding.
   * @returns the resulting binding.
   */
  advanceStage(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ binding: TavernBindingWire }>>

  /**
   * Write the character's opening message into the session log as its first
   * assistant message (the model continues from it).
   * @returns `{ appended: true }` when the opening was written.
   */
  setGreeting(request: RpcRequest<{ sessionId: SessionId; greeting: string }>): Promise<RpcResponse<{ appended: true }>>

  /**
   * Replace one session's MVU variable state (card variables injected into the
   * prompt). The card frontend drives it via the bridge; the model via
   * `<json_patch>` blocks.
   * @returns the resulting binding.
   */
  setMvu(request: RpcRequest<{ sessionId: SessionId; variables: Record<string, string> }>): Promise<RpcResponse<{ binding: TavernBindingWire }>>

  /**
   * Model-assess one character card's quality through the LLM service.
   * @returns the structured score.
   */
  scoreCharacter(request: RpcRequest<{ id: CharacterId }>): Promise<RpcResponse<{ score: CardScore }>>

  /** The project explorer tree: worldbooks with entries, characters with extension summaries. */
  projectTree(request: RpcRequest<{}>):
  Promise<RpcResponse<{ worldbooks: TavernWorldBookProjectView[]; characters: TavernCharacterProjectView[] }>>

  /** The stored character card's portrait image as base64 PNG bytes. */
  characterImage(request: RpcRequest<{ id: CharacterId }>): Promise<RpcResponse<{ bytesB64: string }>>
}

/** One worldbook entry in the project explorer tree. */
export interface TavernWorldBookEntryView {
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

/** One worldbook in the project explorer tree. */
export interface TavernWorldBookProjectView {
  /** The stored lorebook's id. */
  readonly id: WorldBookId
  /** The lorebook's name. */
  readonly name: string
  /** The entries, in import order. */
  readonly entries: readonly TavernWorldBookEntryView[]
}

/** One character in the project explorer tree. */
export interface TavernCharacterProjectView {
  /** The stored card's id. */
  readonly id: CharacterId
  /** The card's character name. */
  readonly name: string
  /** The file format the card was imported as. */
  readonly format: 'json' | 'png'
  /** The card's raw extension fields (scripts, MVU, tool fields). */
  readonly extensions: Record<string, unknown>
  /** Whether the card carries an embedded portrait image (PNG cards do). */
  readonly hasAvatar: boolean
  /** The card's opening messages: first_mes plus every alternate greeting. */
  readonly greetings: readonly string[]
}
