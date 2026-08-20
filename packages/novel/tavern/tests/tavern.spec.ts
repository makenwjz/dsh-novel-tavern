import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TavernService from '../src/index.ts'
import type { CharacterId, TavernBindingData, WorldBookId } from '../src/types.ts'

const WORLD_BOOK: Record<string, unknown> = {
  name: '青鸾山志',
  entries: [
    {
      keys: ['青鸾'],
      content: '青鸾是护山灵兽，栖于青鸾山。',
      constant: false,
      enabled: true,
    },
    {
      content: '山门禁地，常年云雾。',
      constant: true,
      enabled: true,
    },
  ],
}

const CHARACTER: Record<string, unknown> = {
  name: 'Aya',
  description: '冷面剑修',
  personality: '寡言',
  scenario: '黄昏的剑冢',
  first_mes: '*拔出剑* {{char}}在此，{{user}}。',
  mes_example: 'Aya: 剑不是用来问的。',
  system_prompt: '不得提及现实世界',
  post_history_instructions: '保持冷淡',
}

const roots: string[] = []

/** Mount the real store beside a real session registry and prompt service. */
async function mount(root = mkdtempSync(join(tmpdir(), 'dsh-tavern-')), config: Partial<Record<string, unknown>> = {}): Promise<{ ctx: Context; tavern: TavernService }> {
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TavernService, { root, activationTextLimit: 4000, lean: false, ...config })
  return { ctx, tavern: ctx.tavern }
}

/** One attached session carrying a binding. */
function bind(ctx: Context, data: TavernBindingData): ReturnType<typeof ctx.sessions.create> {
  const session = ctx.sessions.create()
  session.append('tavern/binding', data)
  return session
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('TavernService store', () => {
  it('creates the store directories and validates its config schema', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-config-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TavernService, { root, activationTextLimit: 20, lean: false })
    expect(existsSync(join(root, 'worldbooks'))).toBe(true)
    expect(existsSync(join(root, 'characters'))).toBe(true)
    await expect(ctx.plugin(TavernService, { root: 42 as never, activationTextLimit: 4000 } as never)).rejects.toThrow()
    await expect(ctx.plugin(TavernService, { root, activationTextLimit: 0, lean: false })).rejects.toThrow()
  })

  it('imports worldbooks, lists them, and re-export parses the stored bytes', async () => {
    const { tavern } = await mount()
    const view = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    expect(view.name).toBe('青鸾山志')
    expect(view.entryCount).toBe(2)
    expect(view.id).toMatch(/^worldbook-[0-9a-f-]{36}$/)
    expect(tavern.listWorldBooks()).toEqual([view])
    expect(tavern.worldBook(view.id).entries).toHaveLength(2)
    expect(() => tavern.importWorldBook('not json')).toThrow(/not valid JSON/)
  })

  it('imports PNG and JSON character cards, listing them name-sorted', async () => {
    const { tavern } = await mount()
    const json = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    expect(json.format).toBe('json')
    expect(json.name).toBe('Aya')
    expect(tavern.characterProfile(json.id).firstMes).toContain('{{char}}')
    expect(tavern.listCharacters()).toEqual([json])
    expect(() => tavern.importCharacter('card.json', new TextEncoder().encode('x'))).toThrow(/not valid JSON/)
    const png = tavern.importCharacter('card.PNG', pngCard(JSON.stringify(CHARACTER)))
    expect(png.format).toBe('png')
    expect(tavern.characterProfile(png.id).name).toBe('Aya')
  })

  it('imports a card with an embedded worldbook into the worldbook store', async () => {
    const { tavern } = await mount()
    const card = {
      ...CHARACTER,
      character_book: {
        name: '剑冢设定',
        entries: [
          { keys: ['剑冢'], content: '北境埋着断剑', comment: '地点' },
          { keys: ['灵气'], content: '灵气会枯竭', use_regex: false, position: 1, display_index: 2 },
        ],
      },
    }
    const character = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(card)))
    expect(character.name).toBe('Aya')
    const books = tavern.listWorldBooks()
    expect(books).toHaveLength(1)
    expect(books[0]?.name).toBe('剑冢设定')
    expect(books[0]?.entryCount).toBe(2)
  })

  it('lists characters across extensions in name order', async () => {
    const { tavern } = await mount()
    const first = tavern.importCharacter('b.json', new TextEncoder().encode(JSON.stringify({ name: 'B' })))
    const second = tavern.importCharacter('a.json', new TextEncoder().encode(JSON.stringify({ name: 'A' })))
    expect(tavern.listCharacters().map(row => row.id)).toEqual([second.id, first.id])
  })

  it('fails loud on a corrupt stored worldbook or character', async () => {
    const { tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    writeFileSync(join(tavern.root, 'worldbooks', `${book.id}.json`), 'not json', 'utf-8')
    expect(() => tavern.listWorldBooks()).toThrow(/not valid JSON/)
    expect(() => tavern.worldBook(book.id)).toThrow(/not valid JSON/)
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    writeFileSync(join(tavern.root, 'characters', `${card.id}.json`), 'not json')
    expect(() => tavern.listCharacters()).toThrow(/not valid JSON/)
  })

  it('deletes unbound store objects but blocks while a session binds them', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    bind(ctx, { mode: 'novel', worldbookIds: [book.id], characterId: null })
    bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: card.id })
    ctx.sessions.create()
    expect(() => tavern.deleteWorldBook(book.id)).toThrow(/still bound/)
    expect(() => tavern.deleteCharacter(card.id)).toThrow(/still bound/)
    expect(() => tavern.deleteWorldBook('worldbook-missing' as WorldBookId)).toThrow(/not found/)
    expect(() => tavern.deleteCharacter('character-missing' as CharacterId)).toThrow(/not found/)
    expect(() => tavern.deleteWorldBook('w!!' as WorldBookId)).toThrow(/invalid worldbook id/)
    expect(() => tavern.deleteCharacter('c!!' as CharacterId)).toThrow(/invalid character id/)
    const unbound = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    tavern.deleteWorldBook(unbound.id)
    expect(tavern.listWorldBooks().map(row => row.id)).not.toContain(unbound.id)
  })

  it('toggles one worldbook entry enabled flag in the stored file', async () => {
    const { tavern } = await mount()
    const named = {
      name: '带名世界书',
      entries: [
        { name: '第一章·总览', keys: ['青鸾'], content: '青鸾是护山灵兽。', enabled: true },
        { name: '第一章·日常', keys: ['山门'], content: '山门禁地。', enabled: true },
      ],
    }
    const book = tavern.importWorldBook(JSON.stringify(named))
    expect(tavern.worldBook(book.id).entries[0]?.enabled).toBe(true)
    expect(tavern.setWorldBookEntryEnabled(book.id, '第一章·总览', false)).toBe(true)
    expect(tavern.worldBook(book.id).entries[0]?.enabled).toBe(false)
    expect(tavern.worldBook(book.id).entries[1]?.enabled).toBe(true)
    expect(() => tavern.setWorldBookEntryEnabled(book.id, '不存在', true)).toThrow(/no entry named/)
    expect(() => tavern.setWorldBookEntryEnabled('worldbook-missing' as WorldBookId, 'x', true)).toThrow(/not found/)
  })

  it('resolves character profiles by json or png extension', async () => {
    const { tavern } = await mount()
    const json = tavern.importCharacter('a.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    expect(tavern.characterProfile(json.id).name).toBe('Aya')
    expect(() => tavern.characterProfile('character-missing' as CharacterId)).toThrow(/not found/)
    expect(() => tavern.characterProfile('c!!' as CharacterId)).toThrow(/invalid character id/)
  })

  it('activates lore across the bound books', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    const session = bind(ctx, { mode: 'novel', worldbookIds: [book.id], characterId: null })
    const activated = tavern.activatedLore(tavern.bindingOf(session.id)!, '青鸾飞过')
    expect(activated.map(match => match.entry.content)).toEqual(['青鸾是护山灵兽，栖于青鸾山。', '山门禁地，常年云雾。'])
    expect(activated[0]?.bookName).toBe('青鸾山志')
  })

  it('caps the injected lore at the activation character budget', async () => {
    const { ctx, tavern } = await mount(undefined, { activationCharBudget: 500 })
    const big = {
      name: '大世界书',
      entries: [
        { keys: [], content: '常驻设定一'.repeat(50), constant: true },
        { keys: [], content: '常驻设定二'.repeat(50), constant: true },
        { keys: [], content: '常驻设定三'.repeat(50), constant: true },
      ],
    }
    const book = tavern.importWorldBook(JSON.stringify(big))
    const session = bind(ctx, { mode: 'novel', worldbookIds: [book.id], characterId: null })
    const activated = tavern.activatedLore(tavern.bindingOf(session.id)!, '任意文本')
    const total = activated.reduce((sum, match) => sum + match.entry.content.length, 0)
    // Three 250-char constant entries against a 500-char budget keep the first two.
    expect(activated.map(match => match.entry.content)).toEqual(['常驻设定一'.repeat(50), '常驻设定二'.repeat(50)])
    expect(total).toBe(500)
    // Config validation rejects an absurdly small budget.
    await expect(ctx.plugin(TavernService, { root: mkdtempSync(join(tmpdir(), 'dsh-tavern-bad-')), activationCharBudget: 10 } as never)).rejects.toThrow()
  })

  it('writes the opening message into a fresh session and refuses after the chat starts', async () => {
    const { ctx, tavern } = await mount()
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null })
    expect(tavern.setGreeting(session.id, '月光下，她推开了门。')).toBe(true)
    const opening = session.events.find(event => event.type === 'assistant/message')
    expect(opening).toBeDefined()
    const message = (opening as { data: { message: { content: Array<{ text?: string }> } } }).data.message
    expect(message.content[0]?.text).toBe('月光下，她推开了门。')
    // A second write is refused (the opening already exists).
    expect(() => tavern.setGreeting(session.id, '另一版开场')).toThrow(/already written/)
    // Once the user speaks, the opening can no longer be written.
    const started = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null })
    started.append('user/message', {
      id: 'm-1' as never,
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    expect(() => tavern.setGreeting(started.id, '迟到开场')).toThrow(/already started/)
    // Blank greetings and unattached sessions fail loud.
    expect(() => tavern.setGreeting(started.id, '  ')).toThrow(/must not be empty/)
    expect(() => tavern.setGreeting('missing-session', '开场')).toThrow(/not attached/)
  })

  it('stores and folds per-session MVU variables', async () => {
    const { ctx, tavern } = await mount()
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null })
    const binding = tavern.setMvuVariables(session.id, { game_mode: '1', playthrough: '2', scene_name: '01-噩梦与觉醒' })
    expect(binding.mvuVariables).toEqual({ game_mode: '1', playthrough: '2', scene_name: '01-噩梦与觉醒' })
    const folded = tavern.bindingOf(session.id)
    expect(folded?.mvuVariables).toEqual({ game_mode: '1', playthrough: '2', scene_name: '01-噩梦与觉醒' })
    // Replacing replaces the map wholesale.
    const replaced = tavern.setMvuVariables(session.id, { playthrough: '3' })
    expect(replaced.mvuVariables).toEqual({ playthrough: '3' })
    expect(() => tavern.setMvuVariables('missing', {})).toThrow(/not attached/)
  })

  it('stores and clears the per-session persona', async () => {
    const { ctx, tavern } = await mount()
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null })
    expect(tavern.setPersona(session.id, '我是深夜码字的用户，说话简短。').persona).toBe('我是深夜码字的用户，说话简短。')
    expect(tavern.bindingOf(session.id)?.persona).toBe('我是深夜码字的用户，说话简短。')
    // Blank clears the persona.
    expect(tavern.bindingOf(tavern.setPersona(session.id, '   ').mode === 'tavern' ? session.id : session.id)?.persona).toBeUndefined()
    expect(() => tavern.setPersona('missing', 'x')).toThrow(/not attached/)
  })

  it('imports a SillyTavern Chat JSONL export into a fresh session', async () => {
    const { ctx, tavern } = await mount()
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null })
    const jsonl = [
      JSON.stringify({ chat_metadata: {}, char_name: 'Aya' }),
      JSON.stringify({ name: 'Aya', is_user: false, mes: '你来了。' }),
      JSON.stringify({ name: 'User', is_user: true, mes: '嗯。' }),
      JSON.stringify({ name: 'Aya', is_user: false, mes: '那就开始吧。' }),
      'not-json',
      JSON.stringify({ name: 'Aya', is_user: false, mes: '' }),
    ].join('\n')
    expect(tavern.importChat(session.id, jsonl)).toBe(3)
    const rows = session.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    expect(rows.map(row => row.type)).toEqual(['assistant/message', 'user/message', 'assistant/message'])
    // A session that already has messages refuses the import.
    expect(() => tavern.importChat(session.id, jsonl)).toThrow(/already has messages/)
    expect(() => tavern.importChat('missing', jsonl)).toThrow(/not attached/)
  })

  it('imports, lists, and deletes prompt presets with bound-session guard', async () => {
    const { ctx, tavern } = await mount()
    const presetSource = JSON.stringify({
      name: '测试预设',
      prompts: [{ identifier: 'p1', name: '一', role: 'system', content: '你是 {{char}}。' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'p1', enabled: true }] }],
    })
    const view = tavern.importPromptPreset(presetSource)
    expect(view.name).toBe('测试预设')
    expect(view.promptCount).toBe(1)
    expect(tavern.listPromptPresets().map(row => row.id)).toContain(view.id)
    // A session binding the preset blocks deletion.
    bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: null, presetId: view.id })
    expect(() => tavern.deletePromptPreset(view.id)).toThrow(/still bound/)
    // An unbound preset deletes cleanly.
    const unbound = tavern.importPromptPreset(JSON.stringify({ name: '空', prompts: [], prompt_order: [{ character_id: 100001, order: [] }] }))
    tavern.deletePromptPreset(unbound.id)
    expect(tavern.listPromptPresets().map(row => row.id)).not.toContain(unbound.id)
    expect(() => tavern.importPromptPreset('{}')).toThrow(/prompts and prompt_order/)
  })

  it('folds bindings from the session log and audits dangling references', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    bind(ctx, { mode: 'tavern', worldbookIds: [book.id], characterId: card.id })
    bind(ctx, { mode: 'novel', worldbookIds: ['worldbook-missing' as never], characterId: null })
    bind(ctx, { mode: 'novel', worldbookIds: [], characterId: 'character-missing' as never })
    expect(tavern.checkBindings()).toEqual([
      { sessionId: expect.any(String), kind: 'worldbook', id: 'worldbook-missing' },
      { sessionId: expect.any(String), kind: 'character', id: 'character-missing' },
    ])
    const unattached = ctx.sessions.create()
    expect(tavern.bindingOf(unattached.id)).toBeNull()
    expect(tavern.bindingOf('missing-session')).toBeNull()
  })
})

describe('tavern:context prompt section', () => {
  it('injects the character and activated lore into the assembly', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify(WORLD_BOOK))
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [book.id], characterId: card.id })
    session.append('user/message', {
      id: 'm-1' as never,
      role: 'user',
      content: [{ type: 'text', text: '青鸾在哪？' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    const agent = { session } as never
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent })
    const section = assembly.sections.find(candidate => candidate.name === 'tavern:context')
    expect(section?.text).toContain('## 角色扮演设定')
    expect(section?.text).toContain('你现在扮演 Aya。')
    expect(section?.text).toContain('## 已激活的世界书设定')
    expect(section?.text).toContain('《青鸾山志》：青鸾是护山灵兽，栖于青鸾山。')
    expect(section?.text).toContain('*拔出剑* Aya在此，用户。')
  })

  it('renders nothing without an agent or without a binding', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify({ name: '剑冢', entries: [{ keys: ['无此词'], content: 'x' }] }))
    const bare = ctx.sessions.create()
    const agent = { session: bare } as never
    const assembly = async (candidate: never) => (await ctx.systemPrompt.assemble({ scope: candidate, agent: candidate }))
      .sections.find(section => section.name === 'tavern:context')?.text

    const unnamed = await ctx.systemPrompt.assemble({} as never)
    expect(unnamed.sections.find(section => section.name === 'tavern:context')?.text).toBe('')
    expect(await assembly(agent)).toBe('')
    const novel = ctx.sessions.create()
    novel.append('tavern/binding', { mode: 'novel', worldbookIds: [book.id], characterId: null })
    expect(await assembly({ session: novel } as never)).toBe('')
  })

  it('degrades to an empty section when the store file disappears', async () => {
    const { ctx, tavern } = await mount()
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: card.id })
    rmSync(join(tavern.root, 'characters', `${card.id}.json`))
    const agent = { session } as never
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent })
    expect(assembly.sections.find(candidate => candidate.name === 'tavern:context')?.text).toBe('')
  })

  it('renders the trimmed character block when configured lean', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-lean-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TavernService, { root, activationTextLimit: 4000, lean: true })
    const card = ctx.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: card.id })
    const agent = { session } as never
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent })
    const text = assembly.sections.find(candidate => candidate.name === 'tavern:context')?.text ?? ''
    expect(text).toContain('你现在扮演 Aya。\n')
    expect(text).toContain('- 人物介绍: 冷面剑修')
    expect(text).toContain('开场白开始：')
    expect(text).not.toContain('- 性格:')
    expect(text).not.toContain('- 背景:')
    expect(text).not.toContain('- 对话示例:')
  })

  it('toggles the trimmed character block at runtime via setLean', async () => {
    const { ctx, tavern } = await mount()
    expect(tavern.lean).toBe(false)
    const card = tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [], characterId: card.id })
    const agent = { session } as never
    const assemble = async (): Promise<string> =>
      (await ctx.systemPrompt.assemble({ scope: agent, agent }))
        .sections.find(candidate => candidate.name === 'tavern:context')?.text ?? ''
    expect(await assemble()).toContain('- 性格:')
    tavern.setLean(true)
    expect(tavern.lean).toBe(true)
    const trimmed = await assemble()
    expect(trimmed).toContain('你现在扮演 Aya。\n')
    expect(trimmed).not.toContain('- 性格:')
    tavern.setLean(false)
    expect(await assemble()).toContain('- 性格:')
  })

  it('filters lorebook activation by the binding stage and advances it', async () => {
    const { ctx, tavern } = await mount()
    const book = tavern.importWorldBook(JSON.stringify({
      name: '阶段',
      entries: [
        { keys: ['通用'], content: '通用条目。' },
        { keys: ['阶段二'], content: '阶段二条目。', stage: 2 },
        { keys: ['阶段三'], content: '阶段三条目。', stage: 3 },
      ],
    }))
    const session = bind(ctx, { mode: 'tavern', worldbookIds: [book.id], characterId: null })
    const activate = (text: string): string[] =>
      tavern.activatedLore(tavern.bindingOf(session.id)!, text).map(match => match.entry.content)
    expect(activate('通用 阶段二 阶段三')).toEqual(['通用条目。'])
    tavern.advanceStage(session.id)
    expect(activate('通用 阶段二 阶段三')).toEqual(['通用条目。'])
    tavern.advanceStage(session.id)
    expect(activate('通用 阶段二 阶段三')).toEqual(['通用条目。', '阶段二条目。'])
  })

  it('refuses to advance an unattached or unbinding session', async () => {
    const { ctx, tavern } = await mount()
    expect(() => tavern.advanceStage('missing')).toThrow(/not attached/)
    const session = ctx.sessions.create()
    expect(() => tavern.advanceStage(session.id)).toThrow(/no binding/)
  })

  it('renders every bound character in multi-character mode', async () => {
    const { ctx, tavern } = await mount()
    const aya = tavern.importCharacter('aya.json', new TextEncoder().encode(JSON.stringify({ ...CHARACTER, name: 'Aya' })))
    const rin = tavern.importCharacter('rin.json', new TextEncoder().encode(JSON.stringify({ ...CHARACTER, name: 'Rin', description: '刀客' })))
    const session = bind(ctx, {
      mode: 'tavern', worldbookIds: [], characterId: null, characterIds: [aya.id, rin.id],
    })
    const agent = { session } as never
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent })
    const text = assembly.sections.find(candidate => candidate.name === 'tavern:context')?.text ?? ''
    expect(text).toContain('你现在扮演 Aya。')
    expect(text).toContain('你现在扮演 Rin。')
    expect(text).toContain('- 人物介绍: 刀客')
  })

  it('scores a card through the llm service and fails loud without it', async () => {
    const base = await mount()
    await expect(base.tavern.scoreCharacter('character-x' as never)).rejects.toThrow(/scoreProvider/)

    const root = mkdtempSync(join(tmpdir(), 'dsh-tavern-score-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TavernService, { root, activationTextLimit: 4000, lean: false })
    const withoutRoute = ctx.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(ctx.tavern.scoreCharacter(withoutRoute.id)).rejects.toThrow(/scoreProvider/)

    const noLlm = new Context()
    await noLlm.plugin(SessionStore)
    await noLlm.plugin(SystemPrompt)
    await noLlm.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score-nollm-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'm',
    })
    const routed = noLlm.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(noLlm.tavern.scoreCharacter(routed.id)).rejects.toThrow(/llm service/)

    const scoreCtx = new Context()
    await scoreCtx.plugin(SessionStore)
    await scoreCtx.plugin(SystemPrompt)
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '评分如下 {"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":"建议精简"}' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '评分如下 {"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":"建议精简"}' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const stream = vi.fn(async function* () { yield* chunks })
    scoreCtx.provide('llm' as never, { stream } as never)
    await scoreCtx.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score2-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'score-model', scoreMaxTokens: 300,
    })
    const card = scoreCtx.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    const signal = new AbortController().signal
    const score = await scoreCtx.tavern.scoreCharacter(card.id, signal)
    expect(score).toEqual({ overall: 8, clarity: 9, consistency: 7, tokenEfficiency: 6, note: '建议精简' })
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ provider: 'test', model: 'score-model', maxTokens: 300, signal }))
  })

  it('fails loud on a failing or malformed scoring response', async () => {
    const failing = new Context()
    await failing.plugin(SessionStore)
    await failing.plugin(SystemPrompt)
    failing.provide('llm' as never, {
      stream: vi.fn(async function* () {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'e', message: 'model down' } } } as StreamChunk
      }),
    } as never)
    await failing.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score3-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'm',
    })
    const card = failing.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(failing.tavern.scoreCharacter(card.id)).rejects.toThrow(/model down/)

    const malformed = new Context()
    await malformed.plugin(SessionStore)
    await malformed.plugin(SystemPrompt)
    malformed.provide('llm' as never, {
      stream: vi.fn(async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
        yield { type: 'text-delta', index: 0, text: 'not json' } as StreamChunk
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'not json' } } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }),
    } as never)
    await malformed.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score4-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'm',
    })
    const bad = malformed.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(malformed.tavern.scoreCharacter(bad.id)).rejects.toThrow(/no parseable JSON/)

    const badFields = new Context()
    await badFields.plugin(SessionStore)
    await badFields.plugin(SystemPrompt)
    badFields.provide('llm' as never, {
      stream: vi.fn(async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
        yield { type: 'text-delta', index: 0, text: '{"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":5}' } as StreamChunk
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"overall":8,"clarity":9,"consistency":7,"tokenEfficiency":6,"note":5}' } } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }),
    } as never)
    await badFields.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score5-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'm',
    })
    const typed = badFields.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(badFields.tavern.scoreCharacter(typed.id)).resolves.toMatchObject({ overall: 8, note: '' })

    const badNumber = new Context()
    await badNumber.plugin(SessionStore)
    await badNumber.plugin(SystemPrompt)
    badNumber.provide('llm' as never, {
      stream: vi.fn(async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
        yield { type: 'text-delta', index: 0, text: '{"overall":"eight","clarity":9,"consistency":7,"tokenEfficiency":6,"note":"n"}' } as StreamChunk
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"overall":"eight","clarity":9,"consistency":7,"tokenEfficiency":6,"note":"n"}' } } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }),
    } as never)
    await badNumber.plugin(TavernService, {
      root: mkdtempSync(join(tmpdir(), 'dsh-tavern-score6-')), activationTextLimit: 4000, lean: false,
      scoreProvider: 'test', scoreModel: 'm',
    })
    const badOverall = badNumber.tavern.importCharacter('card.json', new TextEncoder().encode(JSON.stringify(CHARACTER)))
    await expect(badNumber.tavern.scoreCharacter(badOverall.id)).rejects.toThrow(/invalid "overall"/)
  })

  it('disposes the section registration with its fiber', async () => {
    const root = new Context()
    await root.plugin(SessionStore)
    await root.plugin(SystemPrompt)
    const tavernFiber = root.plugin(TavernService, { root: mkdtempSync(join(tmpdir(), 'dsh-tavern-hmr-')), activationTextLimit: 4000, lean: false })
    await tavernFiber
    const session = root.sessions.create()
    session.append('tavern/binding', { mode: 'novel', worldbookIds: [], characterId: null })
    const agent = { session } as never
    const before = await root.systemPrompt.assemble({ scope: agent, agent })
    expect(before.sections.some(candidate => candidate.name === 'tavern:context')).toBe(true)
    await tavernFiber.dispose()
    const after = await root.systemPrompt.assemble({ scope: agent, agent })
    expect(after.sections.some(candidate => candidate.name === 'tavern:context')).toBe(false)
  })
})

/** A minimal PNG carrying one JSON card in a `chara` tEXt chunk (UTF-8 bytes in the text chunk). */
function pngCard(json: string): Uint8Array {
  const data = [...Buffer.from('chara\0', 'latin1'), ...Buffer.from(json, 'utf-8')]
  const length = [(data.length >>> 24) & 0xFF, (data.length >>> 16) & 0xFF, (data.length >>> 8) & 0xFF, data.length & 0xFF]
  const payload = [...length, ...Buffer.from('tEXt', 'latin1'), ...data]
  const crc = crc32(Uint8Array.from(payload.slice(4)))
  return Uint8Array.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...payload,
    (crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF,
  ])
}

/** Table-walk CRC-32 for the fixture builder. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
