/**
 * Data layer of the tavern surface: every tavern-domain API call the browser
 * panel needs, normalized to plain snapshots and loud failures. Components
 * keep zero api knowledge; this controller is the one place the wire meets
 * the panel.
 * @module @deepseek-ai/dsh-client-ui-novel/tavern-store
 */

import type { IApiClient, RpcResult, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  CharacterId,
  CharacterView,
  TavernBindingData,
  WorldBookId,
  WorldBookView,
} from '@deepseek-ai/dsh-tavern/types'

/** One immutable tavern surface snapshot. */
export interface TavernSnapshot {
  /** Imported lorebooks in name order. */
  readonly worldbooks: WorldBookView[]
  /** Imported character cards in name order. */
  readonly characters: CharacterView[]
  /** Whether the lean prompt toggle is on. */
  readonly lean: boolean
}

/** Throw the stable failure of one RPC result, if any. */
function rejectUnlessOk<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * The tavern domain's browser data layer. Every method resolves one RPC and
 * calls `notify` after a mutation so the panel can reload a fresh snapshot.
 * @param api - the connection's API client (tavern domain only).
 * @param notify - change notification the owner wires to a reload.
 */
export class TavernController {
  constructor(
    private readonly api: Pick<IApiClient, 'tavern'>,
    private readonly notify: () => void,
  ) {}

  /**
   * Load one full snapshot in one round trip.
   * @returns worldbooks, characters, and the lean toggle.
   */
  async load(): Promise<TavernSnapshot> {
    const [worldbooks, characters, lean] = await Promise.all([
      this.api.tavern.listWorldBooks({}),
      this.api.tavern.listCharacters({}),
      this.api.tavern.lean({}),
    ])
    return {
      worldbooks: rejectUnlessOk(worldbooks.result).worldbooks,
      characters: rejectUnlessOk(characters.result).characters,
      lean: rejectUnlessOk(lean.result).lean,
    }
  }

  /** Toggle the lean prompt (and the automatic-title off-switch it drives). */
  async setLean(lean: boolean): Promise<void> {
    rejectUnlessOk((await this.api.tavern.setLean({ lean })).result)
    this.notify()
  }

  /** Import one SillyTavern lorebook JSON export. */
  async importWorldBook(content: string): Promise<void> {
    rejectUnlessOk((await this.api.tavern.importWorldBook({ content })).result)
    this.notify()
  }

  /** Delete one lorebook, failing loud while any session's binding references it. */
  async deleteWorldBook(id: WorldBookId): Promise<void> {
    rejectUnlessOk((await this.api.tavern.deleteWorldBook({ id })).result)
    this.notify()
  }

  /** Import one character card file (JSON text or PNG bytes) as base64. */
  async importCharacter(fileName: string, bytesB64: string): Promise<void> {
    rejectUnlessOk((await this.api.tavern.importCharacter({ fileName, bytesB64 })).result)
    this.notify()
  }

  /** Delete one character card, failing loud while any session's binding references it. */
  async deleteCharacter(id: CharacterId): Promise<void> {
    rejectUnlessOk((await this.api.tavern.deleteCharacter({ id })).result)
    this.notify()
  }

  /** Read one session's binding. */
  async binding(sessionId: string): Promise<TavernBindingData | null> {
    return rejectUnlessOk((await this.api.tavern.binding({ sessionId: sessionId as SessionId })).result).binding
  }

  /** Enter tavern mode on one session, roleplaying the selected character cards. */
  async startRoleplay(sessionId: string, characterIds: CharacterId[], worldbookIds: WorldBookId[]): Promise<void> {
    rejectUnlessOk((await this.api.tavern.startRoleplay({ sessionId: sessionId as SessionId, characterIds, worldbookIds })).result)
    this.notify()
  }

  /** Leave tavern mode on one session, keeping its lorebook binding. */
  async stopRoleplay(sessionId: string): Promise<void> {
    rejectUnlessOk((await this.api.tavern.stopRoleplay({ sessionId: sessionId as SessionId })).result)
    this.notify()
  }
}
