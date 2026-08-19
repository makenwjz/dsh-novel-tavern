import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { CharacterId, WorldBookId } from '@deepseek-ai/dsh-tavern/types'
import { TavernController, type TavernSnapshot } from '../src/client/tavern-store.ts'

function resultOk<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

function resultError(message: string): { result: { ok: false; error: { code: string; message: string; details: {} } } } {
  return { result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

/** Loose tavern face: the controller is the typed boundary; cases script responses freely. */
function apiOverrides(tavern: Record<string, unknown>): Pick<IApiClient, 'tavern'> {
  return { tavern } as unknown as Pick<IApiClient, 'tavern'>
}

const WORLD = { id: 'worldbook-w1' as WorldBookId, name: '青鸾山志', entryCount: 2 }
const CARD = { id: 'character-c1' as CharacterId, name: 'Aya', format: 'json' as const }
const BINDING = { mode: 'tavern' as const, worldbookIds: [WORLD.id], characterId: CARD.id }

describe('TavernController', () => {
  it('loads a snapshot in one round trip', async () => {
    const notify = vi.fn()
    const api = apiOverrides({
      listWorldBooks: vi.fn(async () => resultOk({ worldbooks: [WORLD] })),
      listCharacters: vi.fn(async () => resultOk({ characters: [CARD] })),
      lean: vi.fn(async () => resultOk({ lean: true })),
    })
    const snapshot: TavernSnapshot = await new TavernController(api, notify).load()
    expect(snapshot).toEqual({ worldbooks: [WORLD], characters: [CARD], lean: true })
    expect(notify).not.toHaveBeenCalled()
  })

  it('fails loud when any load call errors', async () => {
    const api = apiOverrides({
      listWorldBooks: vi.fn(async () => resultError('boom')),
      listCharacters: vi.fn(async () => resultOk({ characters: [] })),
      lean: vi.fn(async () => resultOk({ lean: false })),
    })
    await expect(new TavernController(api, vi.fn()).load()).rejects.toThrow('boom')
  })

  it('toggles lean and notifies', async () => {
    const notify = vi.fn()
    const api = apiOverrides({
      setLean: vi.fn(async (request: { lean: boolean }) => resultOk({ lean: request.lean })),
    })
    await new TavernController(api, notify).setLean(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(api.tavern.setLean).toHaveBeenCalledWith({ lean: true })
  })

  it('fails loud when the lean toggle errors', async () => {
    const notify = vi.fn()
    const api = apiOverrides({ setLean: vi.fn(async () => resultError('no tavern store')) })
    await expect(new TavernController(api, notify).setLean(false)).rejects.toThrow('no tavern store')
    expect(notify).not.toHaveBeenCalled()
  })

  it('imports a worldbook and notifies', async () => {
    const notify = vi.fn()
    const api = apiOverrides({ importWorldBook: vi.fn(async () => resultOk({ worldbook: WORLD })) })
    await new TavernController(api, notify).importWorldBook('{"name":"b","entries":[]}')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails loud when the worldbook import errors', async () => {
    const api = apiOverrides({ importWorldBook: vi.fn(async () => resultError('not valid JSON')) })
    await expect(new TavernController(api, vi.fn()).importWorldBook('x')).rejects.toThrow('not valid JSON')
  })

  it('imports a character card and notifies', async () => {
    const notify = vi.fn()
    const api = apiOverrides({ importCharacter: vi.fn(async () => resultOk({ character: CARD })) })
    await new TavernController(api, notify).importCharacter('card.png', 'aGk=')
    expect(api.tavern.importCharacter).toHaveBeenCalledWith({ fileName: 'card.png', bytesB64: 'aGk=' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails loud when the character import errors', async () => {
    const api = apiOverrides({ importCharacter: vi.fn(async () => resultError('bad card')) })
    await expect(new TavernController(api, vi.fn()).importCharacter('card.json', 'AA==')).rejects.toThrow('bad card')
  })

  it('reads a binding, null included', async () => {
    const api = apiOverrides({ binding: vi.fn(async () => resultOk({ binding: BINDING })) })
    expect(await new TavernController(api, vi.fn()).binding('s1')).toEqual(BINDING)
    const none = apiOverrides({ binding: vi.fn(async () => resultOk({ binding: null })) })
    expect(await new TavernController(none, vi.fn()).binding('s2')).toBeNull()
  })

  it('fails loud when the binding read errors', async () => {
    const api = apiOverrides({ binding: vi.fn(async () => resultError('session-not-found')) })
    await expect(new TavernController(api, vi.fn()).binding('missing')).rejects.toThrow('session-not-found')
  })

  it('starts roleplay and notifies', async () => {
    const notify = vi.fn()
    const api = apiOverrides({ startRoleplay: vi.fn(async () => resultOk({ binding: BINDING })) })
    await new TavernController(api, notify).startRoleplay('s1', [CARD.id], [WORLD.id])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails loud when roleplay start errors', async () => {
    const api = apiOverrides({ startRoleplay: vi.fn(async () => resultError('tavern-not-found')) })
    await expect(new TavernController(api, vi.fn()).startRoleplay('s1', [CARD.id], [])).rejects.toThrow('tavern-not-found')
  })

  it('stops roleplay and notifies', async () => {
    const notify = vi.fn()
    const api = apiOverrides({ stopRoleplay: vi.fn(async () => resultOk({ binding: null })) })
    await new TavernController(api, notify).stopRoleplay('s1')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails loud when roleplay stop errors', async () => {
    const api = apiOverrides({ stopRoleplay: vi.fn(async () => resultError('boom')) })
    await expect(new TavernController(api, vi.fn()).stopRoleplay('s1')).rejects.toThrow('boom')
  })
})
