import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { JsonValue } from '@deepseek-ai/dsh-tools'
import { NovelService } from '@deepseek-ai/dsh-novel'
import * as tools from '../src/index.ts'

const testToolSignal = new AbortController().signal

let ctxs: Context[] = []
let roots: string[] = []

afterEach(async () => {
  await Promise.all(ctxs.map(ctx => ctx.fiber.dispose()))
  ctxs = []
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

async function setup(includeLintTool = true, withNovel = true): Promise<Context> {
  const ctx = new Context()
  ctxs.push(ctx)
  if (withNovel) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-novel-tools-'))
    roots.push(root)
    await ctx.plugin(NovelService, { root })
  }
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tools, { includeLintTool })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

async function value(ctx: Context, name: string, args: unknown): Promise<Record<string, unknown>> {
  const result = await call(ctx, name, args)
  if (result.isError) throw new Error(`expected ${name} to succeed: ${result.error?.message ?? 'unknown error'}`)
  return result.value as Record<string, unknown>
}

describe('novel tools registration', () => {
  it('registers the twenty-four tools with the lint tool surfaced by default', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual([
      'world_subject',
      'world_event',
      'world_state',
      'world_history',
      'plot_story',
      'plot_thread',
      'plot_scene',
      'plot_list',
      'lore_register',
      'lore_list',
      'lore_context',
      'nb_import',
      'nb_export',
      'manuscript_write',
      'manuscript_read',
      'vow_plant',
      'vow_advance',
      'vow_payoff',
      'vow_abandon',
      'vow_list',
      'decision_record',
      'decision_list',
      'chapter_info',
      'novel_lint',
    ])
  })

  it('hides the lint tool when includeLintTool is false', async () => {
    const ctx = await setup(false)
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('novel_lint')
    expect(ctx.tools.schemas()).toHaveLength(23)
  })

  const VALID_ARGS: Record<string, unknown> = {
    world_subject: { kind: 'character', name: 'Aya' },
    world_event: { storyTime: '1200.01.01', title: 'T' },
    world_state: {},
    world_history: {},
    plot_story: { title: 'S' },
    plot_thread: { storyId: 'story-1', title: 'T' },
    plot_scene: { threadId: 'thread-1', title: 'X' },
    plot_list: {},
    lore_register: { category: 'world', title: 'X', content: 'y' },
    lore_list: {},
    lore_context: {},
    nb_import: { root: 'C:/nope' },
    nb_export: { root: 'C:/nope' },
    manuscript_write: { number: 1, title: 'T' },
    manuscript_read: {},
    vow_plant: { title: 'Blade', promise: 'returns', at: '1200.01.01' },
    vow_advance: { vowId: 'vow-1', at: '1200.01.01', detail: 'x' },
    vow_payoff: { vowId: 'vow-1', at: '1200.01.01', detail: 'x' },
    vow_abandon: { vowId: 'vow-1', at: '1200.01.01', detail: 'x' },
    vow_list: {},
    decision_record: { context: 'c', options: [{ label: 'a' }] },
    decision_list: {},
    chapter_info: { number: 1, title: 'T' },
    novel_lint: { text: 'x' },
  }

  it.each([
    'world_subject', 'world_event', 'world_state', 'world_history',
    'plot_story', 'plot_thread', 'plot_scene', 'plot_list',
    'lore_register', 'lore_list', 'lore_context', 'nb_import', 'nb_export',
    'manuscript_write', 'manuscript_read',
    'vow_plant',
    'vow_advance', 'vow_payoff', 'vow_abandon', 'vow_list',
    'decision_record', 'decision_list', 'chapter_info',
  ])('reports the missing runtime for %s when the service is not mounted', async (name) => {
    const ctx = await setup(true, false)
    const result = await call(ctx, name, VALID_ARGS[name])
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('requires the novel workspace service')
  })

  it('lints prose without the service, since novel_lint is pure text analysis', async () => {
    const ctx = await setup(true, false)
    const result = await call(ctx, 'novel_lint', { text: 'Then, she ran.' })
    expect(result.isError).toBe(false)
    expect((result.value as { hits: unknown }).hits).toBeDefined()
  })
})

describe('world engine tools', () => {
  it('registers subjects through world_subject', async () => {
    const ctx = await setup()
    const subject = await value(ctx, 'world_subject', {
      kind: 'character', name: ' Aya ', summary: ' the archer ',
    })
    expect(subject).toEqual({ id: 'subject-1', kind: 'character', name: 'Aya', summary: 'the archer' })
    const bad = await call(ctx, 'world_subject', { kind: 'house', name: 'X' })
    expect(bad.isError).toBe(true)
    expect(bad.error?.message).toContain('must be one of')
  })

  it('records events through world_event and folds state through world_state', async () => {
    const ctx = await setup()
    const subject = await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    const event = await value(ctx, 'world_event', {
      storyTime: '1200.01.01',
      title: ' Duel ',
      summary: 'night fight',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'false' }],
    })
    expect(event).toEqual({ id: 'event-1', storyTime: '1200.01.01', title: 'Duel', summary: 'night fight' })
    const state = await value(ctx, 'world_state', {})
    expect(state.at).toBe('1200.01.01')
    const subjects = state.subjects as { subject: { name: string }; fields: Record<string, string> }[]
    expect(subjects[0]?.subject.name).toBe('Aya')
    expect(subjects[0]?.fields).toEqual({ alive: 'false' })
    const empty = await value(ctx, 'world_state', {})
    expect(empty.at).toBe('1200.01.01')
    const before = await value(ctx, 'world_event', { storyTime: '1199.12.31', title: 'Pro', changes: [{ subjectId: subject.id, field: 'alive', value: 'true' }] })
    expect(before.id).toBe('event-2')
    const folded = await value(ctx, 'world_state', {})
    const entries = folded.subjects as { subject: { name: string }; fields: Record<string, string> }[]
    expect(entries[0]?.fields).toEqual({ alive: 'false' })
    expect(folded.at).toBe('1200.01.01')
  })

  it('folds world_state at a given story time and reads the log through world_history', async () => {
    const ctx = await setup()
    const subject = await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    await value(ctx, 'world_event', {
      storyTime: '1200.01.01', title: 'Arrival',
      changes: [{ subjectId: subject.id, field: 'status', value: 'calm' }],
    })
    await value(ctx, 'world_event', {
      storyTime: '1200.06.01', title: 'Fire',
      changes: [{ subjectId: subject.id, field: 'status', value: 'burning' }],
    })
    const at = await value(ctx, 'world_state', { at: '1200.03.01' })
    expect(at.at).toBe('1200.03.01')
    const subjects = at.subjects as { subject: { name: string }; fields: Record<string, string> }[]
    expect(subjects[0]?.fields).toEqual({ status: 'calm' })
    const latest = await value(ctx, 'world_state', {})
    expect(latest.at).toBe('1200.06.01')
    const history = await value(ctx, 'world_history', {})
    const events = history.events as {
      id: string
      storyTime: string
      title: string
      changes: { subjectId: string; field: string; value: string }[]
    }[]
    expect(events.map(event => event.title)).toEqual(['Arrival', 'Fire'])
    expect(events[1]?.changes).toEqual([{ subjectId: subject.id, field: 'status', value: 'burning' }])
    const filtered = await value(ctx, 'world_history', { subjectId: subject.id })
    expect(filtered.events as unknown[]).toHaveLength(2)
    const badAt = await call(ctx, 'world_state', { at: 'garbage' })
    expect(badAt.isError).toBe(true)
  })

  it('rejects malformed story times and unknown subjects through world_event', async () => {
    const ctx = await setup()
    await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    const badTime = await call(ctx, 'world_event', { storyTime: '999999.01.01', title: 'T' })
    expect(badTime.isError).toBe(true)
    expect(badTime.error?.message).toContain('novel: story')
    const badSubject = await call(ctx, 'world_event', {
      storyTime: '1200.01.01', title: 'T',
      changes: [{ subjectId: 'subject-9', field: 'alive', value: 'false' }],
    })
    expect(badSubject.isError).toBe(true)
    expect(badSubject.error?.message).toContain('unknown subject')
  })
})

describe('plot structure tools', () => {
  it('builds a story/thread/scene tree and reads it back with vow statuses', async () => {
    const ctx = await setup()
    const story = await value(ctx, 'plot_story', { title: ' 主线的复仇 ', summary: ' 少年寻仇 ' })
    expect(story).toEqual({ id: 'story-1', title: '主线的复仇', summary: '少年寻仇' })
    const thread = await value(ctx, 'plot_thread', { storyId: story.id, title: '剑冢线' })
    expect(thread.id).toBe('thread-1')
    const subject = await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    const vow = await value(ctx, 'vow_plant', { title: 'Blade', promise: 'returns', at: '1199.01.01' })
    const scene = await value(ctx, 'plot_scene', {
      threadId: thread.id, title: '夜闯剑冢', at: '1200.06.01', location: '剑冢',
      subjectIds: [subject.id], vowIds: [vow.id],
    })
    expect(scene.id).toBe('scene-1')
    expect(scene.at).toBe('1200.06.01')
    const updated = await value(ctx, 'plot_scene', { id: scene.id, status: 'writing' })
    expect(updated.status).toBe('writing')
    const tree = await value(ctx, 'plot_list', {})
    const stories = tree.stories as {
      id: string
      threads: {
        id: string
        scenes: {
          id: string
          title: string
          at: string | null
          status: string
          subjectIds: string[]
          vows: { vowId: string; status: string; overdue: boolean }[]
        }[]
      }[]
    }[]
    expect(stories).toHaveLength(1)
    const scenes = stories[0]?.threads[0]?.scenes ?? []
    expect(scenes[0]?.title).toBe('夜闯剑冢')
    expect(scenes[0]?.subjectIds).toEqual([subject.id])
    expect(scenes[0]?.vows).toEqual([{ vowId: vow.id, title: 'Blade', status: 'planted', overdue: true }])
    const badStory = await call(ctx, 'plot_thread', { storyId: 'story-9', title: 'T' })
    expect(badStory.isError).toBe(true)
    expect(badStory.error?.message).toContain('unknown story')
    const badScene = await call(ctx, 'plot_scene', { threadId: thread.id, title: 'X', subjectIds: ['subject-9'] })
    expect(badScene.isError).toBe(true)
    expect(badScene.error?.message).toContain('unknown subject')
  })
})

describe('canon lorebook tools', () => {
  it('registers lore, lists it with filters, and reads knowledge contexts', async () => {
    const ctx = await setup()
    const subject = await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    const rule = await value(ctx, 'lore_register', { category: 'world', title: '灵气规则', content: '灵气会枯竭' })
    expect(rule).toEqual({
      id: 'lore-1', category: 'world', title: '灵气规则', content: '灵气会枯竭',
      omniscient: true, subjectId: null,
    })
    const secret = await value(ctx, 'lore_register', {
      category: 'character', title: 'Aya 的身世', content: '她是剑灵转世',
      omniscient: false, subjectId: subject.id,
    })
    expect(secret.omniscient).toBe(false)
    const listed = await value(ctx, 'lore_list', {})
    expect(listed.entries as unknown[]).toHaveLength(2)
    const scoped = await value(ctx, 'lore_list', { subjectId: subject.id })
    expect((scoped.entries as { id: string }[]).map(entry => entry.id)).toEqual([secret.id])
    const context = await value(ctx, 'lore_context', { subjectId: subject.id })
    const view = context as {
      subject: { name: string } | null
      omniscient: { title: string }[]
      scoped: { title: string }[]
    }
    expect(view.subject?.name).toBe('Aya')
    expect(view.omniscient.map(entry => entry.title)).toEqual(['灵气规则'])
    expect(view.scoped.map(entry => entry.title)).toEqual(['Aya 的身世'])
    const badScoped = await call(ctx, 'lore_register', {
      category: 'character', title: 'X', content: 'y', omniscient: false,
    })
    expect(badScoped.isError).toBe(true)
    expect(badScoped.error?.message).toContain('requires a subject')
    const badContext = await call(ctx, 'lore_context', { subjectId: 'subject-9' })
    expect(badContext.isError).toBe(true)
    expect(badContext.error?.message).toContain('unknown subject')
  })
})

describe('neuro-book interop tools', () => {
  it('imports a lorebook-only project through nb_import and exports through nb_export', async () => {
    const ctx = await setup()
    const project = await mkdtemp(join(tmpdir(), 'dsh-nb-tools-'))
    roots.push(project)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(project, 'lorebook', 'world'), { recursive: true })
    writeFileSync(join(project, 'lorebook', 'world', '剑冢.md'), '# 剑冢\n\n北境埋着断剑。\n', 'utf8')
    const imported = await value(ctx, 'nb_import', { root: project })
    expect(imported.loreImported).toBe(1)
    const lore = await value(ctx, 'lore_list', {})
    expect(lore.entries as unknown[]).toEqual([{
      id: 'lore-1', category: 'world', title: '剑冢', content: '北境埋着断剑。', omniscient: true, subjectId: null,
    }])

    const target = await mkdtemp(join(tmpdir(), 'dsh-nb-tools-out-'))
    roots.push(target)
    const exported = await value(ctx, 'nb_export', { root: target })
    expect(exported.loreWritten).toBe(1)
    expect(exported.subjectsExported).toBe(0)
    const missing = await value(ctx, 'nb_import', { root: 'C:/definitely-missing' })
    expect(missing.loreImported).toBe(0)
  })
})

describe('manuscript tools', () => {
  it('writes and reads chapter drafts', async () => {
    const ctx = await setup()
    const saved = await value(ctx, 'manuscript_write', { number: 1, title: '黎明', content: '第一章正文' })
    expect(saved.number).toBe(1)
    expect(saved.content).toBe('第一章正文')
    await value(ctx, 'manuscript_write', { number: 2, title: '风暴', content: '第二章正文' })
    const all = await value(ctx, 'manuscript_read', {})
    expect((all.entries as { number: number }[]).map(entry => entry.number)).toEqual([1, 2])
    const one = await value(ctx, 'manuscript_read', { number: 2 })
    expect((one.entries as { title: string }[])[0]?.title).toBe('风暴')
    const none = await value(ctx, 'manuscript_read', { number: 9 })
    expect(none.entries as unknown[]).toEqual([])
  })
})

describe('plot vow tools', () => {
  it('plants, advances, pays off, and lists vows', async () => {
    const ctx = await setup()
    const vow = await value(ctx, 'vow_plant', {
      title: 'Blade', promise: 'returns', at: '1200.01.01', payoffTarget: 'Chapter 12', note: 'keep',
    })
    expect(vow.id).toBe('vow-1')
    expect(vow.status).toBe('planted')
    const advanced = await value(ctx, 'vow_advance', { vowId: 'vow-1', at: '1200.02.01', detail: 'hint of the forge' })
    expect(advanced.status).toBe('advanced')
    const paid = await value(ctx, 'vow_payoff', { vowId: 'vow-1', at: '1201.01.01', detail: 'forged anew' })
    expect(paid.status).toBe('paid_off')
    const ledger = await value(ctx, 'vow_list', {})
    const ledgers = ledger.ledgers as { vow: { id: string }; transitions: { action: string; at: string }[] }[]
    expect(ledgers[0]?.vow.id).toBe('vow-1')
    expect(ledgers[0]?.transitions.map(t => t.action)).toEqual(['plant', 'advance', 'payoff'])
    expect(ledgers[0]?.transitions[1]?.at).toBe('1200.02.01')
    const paidOnly = await value(ctx, 'vow_list', { status: 'paid_off' })
    expect((paidOnly.ledgers as { vow: { id: string } }[]).map(l => l.vow.id)).toEqual(['vow-1'])
  })

  it('guards vow statuses through the transition tools', async () => {
    const ctx = await setup()
    await value(ctx, 'vow_plant', { title: 'Blade', promise: 'returns', at: '1200.01.01' })
    await value(ctx, 'vow_advance', { vowId: 'vow-1', at: '1200.02.01', detail: 'hint' })
    await value(ctx, 'vow_payoff', { vowId: 'vow-1', at: '1201.01.01', detail: 'forged anew' })
    const again = await call(ctx, 'vow_payoff', { vowId: 'vow-1', at: '1202.01.01', detail: 'x' })
    expect(again.isError).toBe(true)
    expect(again.error?.message).toContain('is paid_off and cannot be payoffd')
    const unknown = await call(ctx, 'vow_advance', { vowId: 'vow-9', at: '1200.01.01', detail: 'x' })
    expect(unknown.isError).toBe(true)
    expect(unknown.error?.message).toContain('unknown vow')
  })

  it('abandons vows through vow_abandon', async () => {
    const ctx = await setup()
    await value(ctx, 'vow_plant', { title: 'Mask', promise: 'remains', at: '1200.01.01' })
    const abandoned = await value(ctx, 'vow_abandon', { vowId: 'vow-1', at: '1201.01.01', detail: 'cut' })
    expect(abandoned.status).toBe('abandoned')
    const again = await call(ctx, 'vow_abandon', { vowId: 'vow-1', at: '1201.01.02', detail: 'x' })
    expect(again.isError).toBe(true)
    expect(again.error?.message).toContain('is abandoned and cannot be abandond')
  })
})

describe('creative decision tools', () => {
  it('records open decisions and closes them through decision_record', async () => {
    const ctx = await setup()
    const open = await value(ctx, 'decision_record', {
      context: 'How does Aya survive the fire?',
      options: [
        { label: 'escape through the roof', pros: 'fast', cons: 'risky' },
        { label: 'hide in the cistern' },
      ],
    })
    expect(open.id).toBe('decision-1')
    expect(open.status).toBe('open')
    const closed = await value(ctx, 'decision_record', {
      context: 'Aftermath',
      options: [{ label: 'leave the city' }],
      chosen: 'leave the city',
      rationale: 'the fire spread',
    })
    expect(closed.id).toBe('decision-2')
    expect(closed.status).toBe('decided')
    const list = await value(ctx, 'decision_list', {})
    const decisions = list.decisions as { id: string; status: string; chosen: string | null; rationale: string }[]
    expect(decisions.map(decision => decision.id)).toEqual(['decision-2', 'decision-1'])
    expect(decisions[0]?.chosen).toBe('leave the city')
    expect(decisions[0]?.rationale).toBe('the fire spread')
    expect(decisions[1]?.chosen).toBeNull()
  })

  it('rejects duplicate option labels through decision_record', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'decision_record', {
      context: 'c',
      options: [{ label: 'a' }, { label: 'a' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('repeats option label')
  })
})

describe('chapter knowledge control tools', () => {
  it('inserts chapters and keeps omitted knowledge fields through chapter_info', async () => {
    const ctx = await setup()
    const first = await value(ctx, 'chapter_info', { number: 3, title: ' The fire ', readerKnows: 'the blade is lost' })
    expect(first.title).toBe('The fire')
    expect(first.readerKnows).toBe('the blade is lost')
    expect(first.protagonistKnows).toBe('')
    const second = await value(ctx, 'chapter_info', { number: 3, title: 'The fire', protagonistKnows: 'Aya lives' })
    expect(second.readerKnows).toBe('the blade is lost')
    expect(second.protagonistKnows).toBe('Aya lives')
  })

  it('rejects invalid chapter numbers through chapter_info', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'chapter_info', { number: 0, title: 'T' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('positive integer')
  })
})

describe('novel_lint tool', () => {
  it('reports style hits with rule, severity, line, and excerpt', async () => {
    const ctx = await setup()
    const result = await value(ctx, 'novel_lint', {
      text: 'Suddenly she felt very afraid.\n\n突然，他立刻站了起来，顿时惊呼连连!!',
    })
    const hits = result.hits as { rule: string; severity: string; line: number; excerpt: string }[]
    expect(result.total).toBeGreaterThan(0)
    const english = hits.filter(hit => hit.rule.startsWith('en/'))
    expect(english.map(hit => hit.rule)).toContain('en/show-dont-tell')
    expect(english.map(hit => hit.rule)).toContain('en/feels-tells')
    const chinese = hits.filter(hit => hit.rule.startsWith('zh/'))
    expect(chinese.map(hit => hit.rule)).toContain('zh/banned-adverbs')
    expect(chinese.map(hit => hit.rule)).toContain('zh/exclamation-run')
    expect(hits[0]?.line).toBe(1)
    expect(hits[0]?.excerpt.length).toBeGreaterThan(0)
  })

  it('reports no hits for clean prose', async () => {
    const ctx = await setup()
    const result = await value(ctx, 'novel_lint', {
      text: 'The rain stopped. Aya crossed the wet street and reached the cistern.',
    })
    expect(result.total).toBe(0)
  })

  it('keeps threshold rules quiet below the threshold and truncates long excerpts', async () => {
    const ctx = await setup()
    const below = await value(ctx, 'novel_lint', {
      text: '“走吧。”他说。她点了点头说。',
    })
    const tags = (below.hits as { rule: string }[]).filter(hit => hit.rule === 'zh/tag-run')
    expect(tags).toHaveLength(0)
    const atThreshold = await value(ctx, 'novel_lint', {
      text: '“走。”甲说。“来。”乙说。“停。”丙说。',
    })
    const reported = (atThreshold.hits as { rule: string }[]).filter(hit => hit.rule === 'zh/tag-run')
    expect(reported).toHaveLength(1)
    const long = `${'w'.repeat(50)} ${'w'.repeat(50)} ${'x'.repeat(100)}`
    const truncated = await value(ctx, 'novel_lint', { text: long })
    const repeat = (truncated.hits as { excerpt: string }[]).find(hit => hit.excerpt.endsWith('…'))
    expect(repeat?.excerpt.length).toBe(97)
  })
})

describe('presentation and edge states', () => {
  it('presents every tool call and renders its result text', async () => {
    const ctx = await setup()
    const calls: [string, unknown][] = [
      ['world_subject', { kind: 'character', name: 'Aya' }],
      ['world_event', { storyTime: '1200.01.01', title: 'Duel' }],
      ['world_state', {}],
      ['vow_plant', { title: 'Blade', promise: 'returns', at: '1200.01.01' }],
      ['vow_advance', { vowId: 'vow-1', at: '1200.02.01', detail: 'hint' }],
      ['vow_payoff', { vowId: 'vow-1', at: '1201.01.01', detail: 'forged' }],
      ['vow_plant', { title: 'Mask', promise: 'remains', at: '1201.01.01' }],
      ['vow_abandon', { vowId: 'vow-2', at: '1201.02.01', detail: 'cut' }],
      ['vow_list', {}],
      ['decision_record', { context: 'c', options: [{ label: 'a' }] }],
      ['decision_list', {}],
      ['chapter_info', { number: 1, title: 'T' }],
      ['novel_lint', { text: 'x' }],
    ]
    for (const [name, args] of calls) {
      const def = ctx.tools.get(name)
      expect(def).toBeDefined()
      const result = await call(ctx, name, args)
      if (result.isError) throw new Error(`${name} failed: ${result.error?.message}`)
      const rendered = def?.output.render?.(args, result.value)
      const block = rendered?.[0]
      if (block !== undefined && block.type === 'text') {
        expect(block.text.length).toBeGreaterThan(0)
      }
      const presented = def?.presentCall?.(args)
      expect(presented?.card).toBe('generic')
      expect(presented?.title.length).toBeGreaterThan(0)
    }
  })

  it('reads an empty world as the beginning of the story', async () => {
    const ctx = await setup()
    const state = await value(ctx, 'world_state', {})
    expect(state).toEqual({ at: null, subjects: [] })
    const def = ctx.tools.get('world_state')
    const rendered = def?.output.render?.({} as const, state as JsonValue)
    const block = rendered?.[0]
    if (block !== undefined && block.type === 'text') {
      expect(block.text).toContain('beginning of the story')
    }
  })

  it('reports subjects never touched by an event as untracked state', async () => {
    const ctx = await setup()
    await value(ctx, 'world_subject', { kind: 'character', name: 'Aya' })
    const state = await value(ctx, 'world_state', {})
    const subjects = state.subjects as { updatedAt: string | null }[]
    expect(subjects[0]?.updatedAt).toBeNull()
  })

  it('closes a decision without a rationale', async () => {
    const ctx = await setup()
    const closed = await value(ctx, 'decision_record', {
      context: 'Next', options: [{ label: 'stay' }], chosen: 'stay',
    })
    expect(closed.status).toBe('decided')
  })

  it('carries conceal and hint knowledge fields through chapter_info', async () => {
    const ctx = await setup()
    const chapter = await value(ctx, 'chapter_info', {
      number: 3, title: 'The fire', mustConceal: 'the blade', mayHint: 'smoke',
    })
    expect(chapter.mustConceal).toBe('the blade')
    expect(chapter.mayHint).toBe('smoke')
  })
})
