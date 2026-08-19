import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import TavernService from '../src/index.ts'
import * as tavernInvariant from '../src/invariant.ts'

const WORLD_BOOK: Record<string, unknown> = {
  name: '青鸾山志',
  entries: [{ keys: ['青鸾'], content: '青鸾是护山灵兽。' }],
}

const CHARACTER: Record<string, unknown> = { name: 'Aya' }

const roots: string[] = []

/** One manual invariant tree: store, service, and the companion under test. */
async function mount(): Promise<{ ctx: Context; tavern: TavernService }> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-invariant-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(TavernService, { root, activationTextLimit: 4000, lean: false })
  return { ctx, tavern: ctx.tavern }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('tavern invariant companion', () => {
  it('boots clean when every attached binding resolves to stored files', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const session = ctx.sessions.create()
    session.append('tavern/binding', { mode: 'tavern', worldbookIds: [book.id], characterId: card.id })
    await expect(ctx.plugin(tavernInvariant)).resolves.toBeDefined()
  })

  it('fails loud on a dangling worldbook reference', async () => {
    const { ctx } = await mount()
    const session = ctx.sessions.create()
    session.append('tavern/binding', { mode: 'novel', worldbookIds: ['worldbook-missing' as never], characterId: null })
    await expect(ctx.plugin(tavernInvariant)).rejects.toThrow(/worldbook-missing/)
  })

  it('fails loud on a dangling character reference', async () => {
    const { ctx } = await mount()
    const session = ctx.sessions.create()
    session.append('tavern/binding', { mode: 'tavern', worldbookIds: [], characterId: 'character-missing' as never })
    await expect(ctx.plugin(tavernInvariant)).rejects.toThrow(/character-missing/)
  })

  it('ignores sessions without a binding', async () => {
    const { ctx } = await mount()
    ctx.sessions.create()
    await expect(ctx.plugin(tavernInvariant)).resolves.toBeDefined()
  })
})
