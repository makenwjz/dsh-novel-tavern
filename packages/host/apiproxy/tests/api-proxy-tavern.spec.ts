import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import TavernService from '@deepseek-ai/dsh-tavern'
import type { CharacterId, TavernBindingData, WorldBookId } from '@deepseek-ai/dsh-tavern/types'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { crc32 } from '../../../novel/tavern/src/png.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`tavern-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectError(response: RpcResponse<unknown>): { code: string; message: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return response.result.error
}

const WORLD_BOOK = JSON.stringify({
  name: '青鸾山志',
  entries: [
    { keys: ['青鸾'], content: '青鸾是护山灵兽。', constant: false, enabled: true },
    { content: '山门禁地。', constant: true, enabled: true },
  ],
})

const CHARACTER = JSON.stringify({
  name: 'Aya',
  description: '冷面剑修',
  personality: '寡言',
  scenario: '黄昏的剑冢',
  first_mes: '*拔出剑* {{char}}在此。',
  mes_example: 'Aya: 剑不是用来问的。',
})

function chunk(type: string, data: number[]): number[] {
  const length = [(data.length >>> 24) & 0xFF, (data.length >>> 16) & 0xFF, (data.length >>> 8) & 0xFF, data.length & 0xFF]
  const payload = [...length, ...[...type].map(char => char.charCodeAt(0)), ...data]
  const crc = crc32(Uint8Array.from(payload.slice(4)))
  return [...payload, (crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF]
}

function cardPng(characterJson: string): Uint8Array {
  const envelope = JSON.stringify({ spec: 'chara_card_v3', data: JSON.parse(characterJson) })
  const payload = [...'ccv3'].map(char => char.charCodeAt(0)).concat(0, 1, 0, 0, 0)
    .concat([...deflateSync(Buffer.from(envelope, 'utf-8'))])
  const card = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...chunk('iTXt', payload)]
  return Uint8Array.from(card)
}

async function harness(noTavern = false, withSessionTitle = false): Promise<{ api: ReturnType<typeof createApiProxy>; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  if (withSessionTitle) {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  }
  if (!noTavern) {
    await ctx.plugin(TavernService, { root: mkdtempSync(join(tmpdir(), 'dsh-apiproxy-tavern-')), activationTextLimit: 4000, lean: false })
  }
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: mkdtempSync(join(tmpdir(), 'dsh-apiproxy-tavern-cwd-')),
  })
  return { api, ctx }
}

describe('tavern store domain', () => {
  it('answers tavern-not-available without the store composed', async () => {
    const { api } = await harness(true)
    expect((await api.tavern.listWorldBooks(request({}))).result.ok).toBe(false)
    expect(expectError(await api.tavern.listWorldBooks(request({}))).code).toBe('tavern-not-available')
  })

  it('imports, lists, and deletes worldbooks', async () => {
    const { api } = await harness()
    expect(expectOk(await api.tavern.listWorldBooks(request({}))).worldbooks).toEqual([])
    const view = expectOk(await api.tavern.importWorldBook(request({ content: WORLD_BOOK }))).worldbook
    expect(view.name).toBe('青鸾山志')
    expect(view.entryCount).toBe(2)
    expect(expectOk(await api.tavern.listWorldBooks(request({}))).worldbooks).toEqual([view])
    const invalid = await api.tavern.importWorldBook(request({ content: 'not json' }))
    expect(expectError(invalid)).toMatchObject({ code: 'tavern-import-invalid', details: { kind: 'worldbook' } })
    expect(expectOk(await api.tavern.deleteWorldBook(request({ id: view.id }))).deleted).toBe(true)
    expect(expectOk(await api.tavern.listWorldBooks(request({}))).worldbooks).toEqual([])
    const missing = await api.tavern.deleteWorldBook(request({ id: 'worldbook-missing' as WorldBookId }))
    expect(expectError(missing)).toMatchObject({ code: 'tavern-not-found', details: { kind: 'worldbook' } })
  })

  it('imports JSON and PNG character cards and deletes them', async () => {
    const { api } = await harness()
    expect(expectOk(await api.tavern.listCharacters(request({}))).characters).toEqual([])
    const json = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER, 'utf-8').toString('base64'),
    }))).character
    expect(json.format).toBe('json')
    expect(json.name).toBe('Aya')
    const png = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.png',
      bytesB64: Buffer.from(cardPng(CHARACTER)).toString('base64'),
    }))).character
    expect(png.format).toBe('png')
    const invalid = await api.tavern.importCharacter(request({
      fileName: 'card.png',
      bytesB64: Buffer.from('not a png').toString('base64'),
    }))
    expect(expectError(invalid)).toMatchObject({ code: 'tavern-import-invalid', details: { kind: 'character' } })
    expect(expectOk(await api.tavern.deleteCharacter(request({ id: png.id }))).deleted).toBe(true)
    expect(expectOk(await api.tavern.listCharacters(request({}))).characters).toEqual([json])
  })

  it('refuses to delete an object a binding references', async () => {
    const { api, ctx } = await harness()
    const book = expectOk(await api.tavern.importWorldBook(request({ content: WORLD_BOOK }))).worldbook
    const card = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER, 'utf-8').toString('base64'),
    }))).character
    const session = ctx.sessions.create()
    session.append('tavern/binding', { mode: 'tavern', worldbookIds: [book.id], characterId: card.id })
    const refused = await api.tavern.deleteWorldBook(request({ id: book.id }))
    expect(expectError(refused)).toMatchObject({
      code: 'tavern-still-bound',
      details: { kind: 'worldbook', sessions: [session.id] },
    })
    expect(expectError(await api.tavern.deleteCharacter(request({ id: card.id }))).code).toBe('tavern-still-bound')
  })
})

describe('tavern binding domain', () => {
  it('reads, sets, and stops a session binding', async () => {
    const { api, ctx } = await harness()
    const book = expectOk(await api.tavern.importWorldBook(request({ content: WORLD_BOOK }))).worldbook
    const card = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER, 'utf-8').toString('base64'),
    }))).character
    const session = ctx.sessions.create()
    expect(expectOk(await api.tavern.binding(request({ sessionId: session.id }))).binding).toBeNull()
    const binding: TavernBindingData = { mode: 'tavern', worldbookIds: [book.id], characterId: card.id }
    const echo = expectOk(await api.tavern.setBinding(request({ sessionId: session.id, binding }))).binding
    expect(echo).toEqual(binding)
    expect(expectOk(await api.tavern.binding(request({ sessionId: session.id }))).binding).toEqual(binding)
    const stopped = expectOk(await api.tavern.stopRoleplay(request({ sessionId: session.id }))).binding
    expect(stopped).toEqual({ mode: 'novel', worldbookIds: [book.id], characterId: null })
    expect(expectOk(await api.tavern.stopRoleplay(request({ sessionId: session.id }))).binding)
      .toEqual({ mode: 'novel', worldbookIds: [book.id], characterId: null })
  })

  it('starts roleplay in tavern mode and validates references before logging', async () => {
    const { api, ctx } = await harness()
    const book = expectOk(await api.tavern.importWorldBook(request({ content: WORLD_BOOK }))).worldbook
    const session = ctx.sessions.create()
    const started = await api.tavern.startRoleplay(request({
      sessionId: session.id,
      characterId: 'character-missing' as CharacterId,
      worldbookIds: [book.id],
    }))
    expect(expectError(started)).toMatchObject({ code: 'tavern-not-found', details: { kind: 'character' } })
    expect(expectOk(await api.tavern.binding(request({ sessionId: session.id }))).binding).toBeNull()
    const card = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER, 'utf-8').toString('base64'),
    }))).character
    const live = expectOk(await api.tavern.startRoleplay(request({
      sessionId: session.id,
      characterId: card.id,
      worldbookIds: [book.id],
    }))).binding
    expect(live).toEqual({ mode: 'tavern', worldbookIds: [book.id], characterId: card.id })
    expect(expectError(await api.tavern.setBinding(request({
      sessionId: session.id,
      binding: { mode: 'novel', worldbookIds: ['worldbook-missing' as WorldBookId], characterId: null },
    }))).code).toBe('tavern-not-found')
  })

  it('answers session-not-found for unknown sessions', async () => {
    const { api } = await harness()
    const sessionId = 'session-missing' as never
    expect(expectError(await api.tavern.binding(request({ sessionId }))).code).toBe('session-not-found')
    expect(expectError(await api.tavern.setBinding(request({
      sessionId,
      binding: { mode: 'novel', worldbookIds: [], characterId: null },
    }))).code).toBe('session-not-found')
  })
})

describe('tavern lean domain', () => {
  it('reads and toggles the lean state', async () => {
    const { api } = await harness()
    expect(expectOk(await api.tavern.lean(request({}))).lean).toBe(false)
    expect(expectOk(await api.tavern.setLean(request({ lean: true }))).lean).toBe(true)
    expect(expectOk(await api.tavern.lean(request({}))).lean).toBe(true)
    expect(expectOk(await api.tavern.setLean(request({ lean: false }))).lean).toBe(false)
  })

  it('answers tavern-not-available without the store composed', async () => {
    const { api } = await harness(true)
    expect(expectError(await api.tavern.lean(request({}))).code).toBe('tavern-not-available')
    expect(expectError(await api.tavern.setLean(request({ lean: true }))).code).toBe('tavern-not-available')
  })

  it('mirrors lean into the session-title automatic toggle when composed', async () => {
    const { api, ctx } = await harness(false, true)
    const spy = vi.spyOn(ctx.sessionTitle, 'setAutomatic')
    expect(expectOk(await api.tavern.setLean(request({ lean: true }))).lean).toBe(true)
    expect(spy).toHaveBeenCalledWith(false)
    expect(expectOk(await api.tavern.setLean(request({ lean: false }))).lean).toBe(false)
    expect(spy).toHaveBeenCalledWith(true)
  })

  it('advances a bound session stage and refuses unattached or unbinding ones', async () => {
    const { api, ctx } = await harness()
    const book = expectOk(await api.tavern.importWorldBook(request({ content: WORLD_BOOK }))).worldbook
    expect(expectError(await api.tavern.advanceStage(request({ sessionId: 'missing' as never }))).code).toBe('session-not-found')
    const unbinding = ctx.sessions.create()
    expect(expectError(await api.tavern.advanceStage(request({ sessionId: unbinding.id }))).code).toBe('bad-request')
    const session = ctx.sessions.create()
    session.append('tavern/binding', { mode: 'novel', worldbookIds: [book.id], characterId: null })
    const advanced = expectOk(await api.tavern.advanceStage(request({ sessionId: session.id }))).binding
    expect(advanced).toEqual({ mode: 'novel', worldbookIds: [book.id], characterId: null, stage: 1 })
  })

  it('scores a character card through the llm service', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(UserQuestionService)
    ctx.provide('llm' as never, {
      stream: async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' } as never
        yield { type: 'text-delta', index: 0, text: '{"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":"ok"}' } as never
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":"ok"}' } } as never
        yield { type: 'finish', reason: { kind: 'stop' } } as never
      },
    } as never)
    await ctx.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-apiproxy-tavern-score-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'score-model',
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: mkdtempSync(join(tmpdir(), 'dsh-apiproxy-tavern-score-cwd-')),
    })
    const card = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER).toString('base64'),
    }))).character
    const score = expectOk(await api.tavern.scoreCharacter(request({ id: card.id }))).score
    expect(score).toEqual({ overall: 8, clarity: 9, consistency: 7, tokenEfficiency: 6, note: 'ok' })
  })

  it('folds a scoring failure into internal', async () => {
    const { api } = await harness()
    const card = expectOk(await api.tavern.importCharacter(request({
      fileName: 'card.json',
      bytesB64: Buffer.from(CHARACTER).toString('base64'),
    }))).character
    const failed = await api.tavern.scoreCharacter(request({ id: card.id }))
    expect(failed.result.ok).toBe(false)
    if (!failed.result.ok) expect(failed.result.error.code).toBe('internal')
  })
})
