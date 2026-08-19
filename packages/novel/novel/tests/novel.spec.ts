import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NovelService } from '../src/index.ts'
import type { LoreId, SceneId, StoryId, StoryTime, SubjectId, ThreadId, VowId } from '../src/types.ts'

let ctxs: Context[] = []
let roots: string[] = []

afterEach(async () => {
  await Promise.all(ctxs.map(ctx => ctx.fiber.dispose()))
  ctxs = []
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

async function service(): Promise<NovelService> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-'))
  roots.push(root)
  const ctx = new Context()
  ctxs.push(ctx)
  await ctx.plugin(NovelService, { root })
  return ctx.novel
}

function time(year: number, month = 1, day = 1): StoryTime {
  return { year, month, day }
}

function option(label: string, pros = '', cons = ''): { label: string; pros: string; cons: string } {
  return { label, pros, cons }
}

function corrupt(novel: NovelService, sql: string): void {
  novel.db.exec('PRAGMA foreign_keys = OFF')
  try {
    novel.db.exec(sql)
  } finally {
    novel.db.exec('PRAGMA foreign_keys = ON')
  }
}

describe('world engine', () => {
  it('creates subjects with trimmed names and summaries, validating kind and name', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: ' Aya ', summary: ' the archer ' })
    expect(subject).toEqual({
      id: 'subject-1',
      kind: 'character',
      name: 'Aya',
      summary: 'the archer',
    })
    expect(novel.createSubject({ kind: 'faction', name: 'The Order' }).id).toBe('subject-2')
    expect(() => novel.createSubject({ kind: 'house' as never, name: 'X' })).toThrow(/unknown subject kind/)
    expect(() => novel.createSubject({ kind: 'object', name: '  ' })).toThrow(/must be non-empty/)
  })

  it('lists subjects in id order and fetches by id', async () => {
    const novel = await service()
    novel.createSubject({ kind: 'character', name: 'B' })
    novel.createSubject({ kind: 'character', name: 'A' })
    expect(novel.listSubjects().map(subject => subject.name)).toEqual(['B', 'A'])
    expect(novel.getSubject('subject-1' as SubjectId)?.name).toBe('B')
    expect(novel.getSubject('subject-99' as SubjectId)).toBeUndefined()
  })

  it('records world events with validated titles, changes, and story times', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    const event = novel.recordWorldEvent({
      storyTime: time(1200, 3, 4),
      title: ' The duel ',
      summary: ' A night fight ',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'false' }],
    })
    expect(event).toEqual({
      id: 'event-1',
      storyTime: time(1200, 3, 4),
      title: 'The duel',
      summary: 'A night fight',
    })
    expect(novel.listWorldEvents()).toEqual([event])
    expect(() => novel.recordWorldEvent({ storyTime: time(1200), title: ' ' })).toThrow(/must be non-empty/)
    expect(() => novel.recordWorldEvent({
      storyTime: time(1200), title: 'T',
      changes: [{ subjectId: subject.id, field: ' ', value: 'x' }],
    })).toThrow(/must be non-empty/)
    expect(() => novel.recordWorldEvent({
      storyTime: time(1200), title: 'T',
      changes: [
        { subjectId: subject.id, field: 'alive', value: 'false' },
        { subjectId: subject.id, field: 'alive', value: 'true' },
      ],
    })).toThrow(/repeats subject field/)
    expect(() => novel.recordWorldEvent({
      storyTime: time(1200), title: 'T',
      changes: [{ subjectId: 'subject-9' as SubjectId, field: 'alive', value: 'false' }],
    })).toThrow(/unknown subject/)
    expect(() => novel.recordWorldEvent({
      storyTime: { year: 13, month: 0, day: 1 }, title: 'T',
    })).toThrow(/novel: story/)
  })

  it('folds subject state at any story time, last write per field winning', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'location', name: 'Kyoto', summary: 'a quiet capital' })
    novel.recordWorldEvent({
      storyTime: time(1200, 1, 1), title: 'Arrival',
      changes: [{ subjectId: subject.id, field: 'status', value: 'peaceful' }],
    })
    novel.recordWorldEvent({
      storyTime: time(1200, 6, 1), title: 'Fire',
      changes: [
        { subjectId: subject.id, field: 'status', value: 'burning' },
        { subjectId: subject.id, field: 'burned', value: 'east quarter' },
      ],
    })
    novel.recordWorldEvent({
      storyTime: time(1201, 1, 1), title: 'Quiet',
      changes: [{ subjectId: subject.id, field: 'status', value: 'quiet again' }],
    })
    const atFire = novel.subjectStateAt(subject.id, time(1200, 6, 1))
    expect(atFire?.fields).toEqual({ status: 'burning', burned: 'east quarter' })
    expect(atFire?.updatedAt).toEqual(time(1200, 6, 1))
    expect(novel.subjectStateAt(subject.id, time(1200, 3, 1))?.fields).toEqual({ status: 'peaceful' })
    expect(novel.subjectStateAt(subject.id, time(1200, 6, 2))?.fields.status).toBe('burning')
    expect(novel.subjectStateAt(subject.id, time(1201))?.fields.status).toBe('quiet again')
    expect(() => novel.subjectStateAt(subject.id, { year: 2020, month: 0, day: 1 })).toThrow(/novel: story/)
  })

  it('folds by story time, not insertion order, when events arrive out of order', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    novel.recordWorldEvent({
      storyTime: time(1200, 6, 1), title: 'Later recorded first',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'false' }],
    })
    novel.recordWorldEvent({
      storyTime: time(1200, 1, 1), title: 'Earlier recorded second',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'true' }],
    })
    expect(novel.subjectState(subject.id)?.fields).toEqual({ alive: 'false' })
    expect(novel.subjectStateAt(subject.id, time(1200, 3, 1))?.fields).toEqual({ alive: 'true' })
  })

  it('folds the latest state, or the baseline when no event touched the subject', async () => {
    const novel = await service()
    const untouched = novel.createSubject({ kind: 'faction', name: 'The Order' })
    const touched = novel.createSubject({ kind: 'character', name: 'Aya' })
    expect(novel.subjectState('subject-99' as SubjectId)).toBeUndefined()
    expect(novel.subjectState(untouched.id)).toEqual({
      subject: untouched,
      fields: {},
      updatedAt: null,
    })
    novel.recordWorldEvent({
      storyTime: time(1200), title: 'Duel',
      changes: [{ subjectId: touched.id, field: 'alive', value: 'false' }],
    })
    expect(novel.subjectState(touched.id)?.fields).toEqual({ alive: 'false' })
  })

  it('reports the latest story time and the whole world state', async () => {
    const novel = await service()
    expect(novel.latestStoryTime()).toBeNull()
    expect(novel.worldState()).toEqual({ at: null, subjects: [] })
    novel.createSubject({ kind: 'character', name: 'Aya' })
    novel.recordWorldEvent({ storyTime: time(1200, 2, 2), title: 'A' })
    novel.recordWorldEvent({ storyTime: time(1200, 1, 1), title: 'B' })
    expect(novel.latestStoryTime()).toEqual(time(1200, 2, 2))
    const state = novel.worldState()
    expect(state.at).toEqual(time(1200, 2, 2))
    expect(state.subjects).toHaveLength(1)
    expect(state.subjects[0]?.subject.name).toBe('Aya')
  })

  it('folds the whole world at any story time and lists the event log with changes', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    novel.recordWorldEvent({
      storyTime: time(1200, 1, 1), title: 'Arrival',
      changes: [{ subjectId: subject.id, field: 'status', value: 'calm' }],
    })
    novel.recordWorldEvent({
      storyTime: time(1200, 6, 1), title: 'Fire',
      changes: [
        { subjectId: subject.id, field: 'status', value: 'burning' },
        { subjectId: subject.id, field: 'injured', value: 'left arm' },
      ],
    })
    const early = novel.worldStateAt(time(1200, 3, 1))
    expect(early.at).toEqual(time(1200, 3, 1))
    expect(early.subjects[0]?.fields).toEqual({ status: 'calm' })
    const atFire = novel.worldStateAt(time(1200, 6, 1))
    expect(atFire.subjects[0]?.fields).toEqual({ status: 'burning', injured: 'left arm' })
    expect(() => novel.worldStateAt({ year: 2020, month: 0, day: 1 })).toThrow(/novel: story/)

    const history = novel.listWorldHistory()
    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({
      id: 'event-1',
      storyTime: time(1200, 1, 1),
      title: 'Arrival',
      summary: '',
      changes: [{ subjectId: subject.id, field: 'status', value: 'calm' }],
    })
    expect(history[1]?.changes).toHaveLength(2)
    expect(novel.listWorldHistory(subject.id)).toHaveLength(2)
    const other = novel.createSubject({ kind: 'faction', name: 'Order' })
    expect(novel.listWorldHistory(other.id)).toEqual([])
  })
})

describe('plot vows', () => {
  it('plants vows with validated inputs, minting stable ids', async () => {
    const novel = await service()
    const vow = novel.plantVow({
      title: ' The blade ',
      promise: ' the blade will return ',
      at: time(1200, 1, 1),
      payoffTarget: ' Chapter 12 ',
      note: ' planted with Misaki ',
    })
    expect(vow.id).toBe('vow-1')
    expect(vow.title).toBe('The blade')
    expect(vow.promise).toBe('the blade will return')
    expect(vow.payoffTarget).toBe('Chapter 12')
    expect(vow.note).toBe('planted with Misaki')
    expect(vow.status).toBe('planted')
    expect(vow.plantedAt).toEqual(time(1200, 1, 1))
    expect(novel.plantVow({ title: 'B', promise: 'b', at: time(1201) }).id).toBe('vow-2')
    expect(() => novel.plantVow({ title: ' ', promise: 'p', at: time(1200) })).toThrow(/must be non-empty/)
    expect(() => novel.plantVow({ title: 'T', promise: ' ', at: time(1200) })).toThrow(/must be non-empty/)
    expect(() => novel.plantVow({ title: 'T', promise: 'p', at: { year: 0, month: 13, day: 1 } }))
      .toThrow(/novel: story/)
  })

  it('advances, pays off, and abandons vows with history, guarding statuses', async () => {
    const novel = await service()
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1200, 1, 1) })
    expect(novel.advanceVow(vow.id, { at: time(1200, 2, 1), detail: ' hint of the forge ' }).status)
      .toBe('advanced')
    expect(novel.payOffVow(vow.id, { at: time(1201, 1, 1), detail: 'forged anew' }).status).toBe('paid_off')
    expect(() => novel.payOffVow(vow.id, { at: time(1202), detail: 'again' }))
      .toThrow(/is paid_off and cannot be payoffd/)
    expect(() => novel.abandonVow(vow.id, { at: time(1202), detail: 'x' }))
      .toThrow(/is paid_off and cannot be abandond/)
    expect(() => novel.advanceVow(vow.id, { at: time(1202), detail: 'x' }))
      .toThrow(/is paid_off and cannot be advanced/)
    const dropped = novel.plantVow({ title: 'Mask', promise: 'remains', at: time(1200, 1, 2) })
    expect(novel.abandonVow(dropped.id, { at: time(1201, 1, 1), detail: 'cut' }).status).toBe('abandoned')
    expect(() => novel.abandonVow(dropped.id, { at: time(1201, 1, 2), detail: 'again' }))
      .toThrow(/is abandoned and cannot be abandond/)
  })

  it('rejects transitions on unknown vows and with empty details', async () => {
    const novel = await service()
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1200) })
    expect(() => novel.advanceVow('vow-99' as VowId, { at: time(1200), detail: 'x' })).toThrow(/unknown vow/)
    expect(() => novel.advanceVow(vow.id, { at: time(1200), detail: ' ' })).toThrow(/must be non-empty/)
    expect(() => novel.abandonVow(vow.id, { at: { year: 1, month: 0, day: 1 }, detail: 'x' }))
      .toThrow(/novel: story/)
  })

  it('lists vows with full transition history, optionally filtered by status', async () => {
    const novel = await service()
    const kept = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1200, 1, 1) })
    const dropped = novel.plantVow({ title: 'Mask', promise: 'remains', at: time(1200, 1, 2) })
    novel.advanceVow(kept.id, { at: time(1200, 2, 1), detail: 'hint of the forge' })
    novel.payOffVow(kept.id, { at: time(1201, 1, 1), detail: 'forged anew' })
    novel.abandonVow(dropped.id, { at: time(1201, 1, 1), detail: 'cut' })
    expect(novel.listVows()).toHaveLength(2)
    const [first, second] = novel.listVows()
    expect(first?.vow.id).toBe(kept.id)
    expect(first?.transitions.map(transition => transition.action)).toEqual(['plant', 'advance', 'payoff'])
    expect(first?.transitions[1]?.detail).toBe('hint of the forge')
    expect(second?.transitions).toEqual([
      { action: 'plant', at: time(1200, 1, 2), detail: '' },
      { action: 'abandon', at: time(1201, 1, 1), detail: 'cut' },
    ])
    expect(novel.listVows({ status: 'abandoned' }).map(entry => entry.vow.id)).toEqual([dropped.id])
    expect(novel.listVows({ status: 'paid_off' }).map(entry => entry.vow.id)).toEqual([kept.id])
    expect(novel.listVows({ status: 'planted' })).toEqual([])
  })
})

describe('creative decisions', () => {
  it('records decisions with validated options', async () => {
    const novel = await service()
    const decision = novel.recordDecision({
      context: ' How does Aya survive the fire? ',
      options: [
        option(' escape through the roof ', ' fast ', ' risky '),
        option('hide in the cistern'),
      ],
    })
    expect(decision.id).toBe('decision-1')
    expect(decision.context).toBe('How does Aya survive the fire?')
    expect(decision.options).toEqual([
      { label: 'escape through the roof', pros: 'fast', cons: 'risky' },
      { label: 'hide in the cistern', pros: '', cons: '' },
    ])
    expect(decision.status).toBe('open')
    expect(decision.chosen).toBeNull()
    expect(decision.rationale).toBe('')
    expect(decision.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(() => novel.recordDecision({ context: ' ', options: [option('a')] })).toThrow(/must be non-empty/)
    expect(() => novel.recordDecision({ context: 'c', options: [] })).toThrow(/at least one option/)
    expect(() => novel.recordDecision({
      context: 'c',
      options: [option('a'), option('a')],
    })).toThrow(/repeats option label/)
    expect(() => novel.recordDecision({ context: 'c', options: [option(' ')] })).toThrow(/must be non-empty/)
  })

  it('closes decisions by choosing an existing option, once', async () => {
    const novel = await service()
    const decision = novel.recordDecision({
      context: 'c',
      options: [option('roof', 'fast'), option('cistern')],
    })
    const closed = novel.decide(decision.id, { chosen: ' roof ', rationale: ' height wins ' })
    expect(closed.status).toBe('decided')
    expect(closed.chosen).toBe('roof')
    expect(closed.rationale).toBe('height wins')
    const bare = novel.recordDecision({ context: 'c', options: [option('a')] })
    expect(novel.decide(bare.id, { chosen: 'a' }).rationale).toBe('')
    const undecided = novel.recordDecision({ context: 'c', options: [option('a')] })
    expect(() => novel.decide('decision-9' as never, { chosen: 'a' })).toThrow(/unknown decision/)
    expect(() => novel.decide(decision.id, { chosen: 'a' })).toThrow(/already decided/)
    expect(() => novel.decide(undecided.id, { chosen: 'nope' })).toThrow(/has no option/)
  })

  it('lists decisions newest first', async () => {
    const novel = await service()
    const first = novel.recordDecision({ context: 'a', options: [option('x')] })
    const second = novel.recordDecision({ context: 'b', options: [option('y')] })
    expect(novel.listDecisions().map(decision => decision.id)).toEqual([second.id, first.id])
  })
})

describe('chapter knowledge control', () => {
  it('inserts and updates chapters, keeping omitted knowledge fields', async () => {
    const novel = await service()
    const inserted = novel.upsertChapter({
      number: 3,
      title: ' The fire ',
      readerKnows: ' the blade is lost ',
    })
    expect(inserted).toEqual({
      number: 3,
      title: 'The fire',
      readerKnows: 'the blade is lost',
      protagonistKnows: '',
      mustConceal: '',
      mayHint: '',
    })
    const updated = novel.upsertChapter({
      number: 3,
      title: 'The fire',
      protagonistKnows: 'Aya lives',
      mustConceal: 'the return',
    })
    expect(updated.readerKnows).toBe('the blade is lost')
    expect(updated.protagonistKnows).toBe('Aya lives')
    expect(updated.mustConceal).toBe('the return')
    const cleared = novel.upsertChapter({
      number: 3,
      title: 'The fire',
      readerKnows: '',
      protagonistKnows: '',
      mustConceal: '',
      mayHint: 'the forge',
    })
    expect(cleared.readerKnows).toBe('')
    expect(cleared.mayHint).toBe('the forge')
  })

  it('validates chapter inputs', async () => {
    const novel = await service()
    expect(() => novel.upsertChapter({ number: 0, title: 'T' })).toThrow(/positive integer/)
    expect(() => novel.upsertChapter({ number: 1.5, title: 'T' })).toThrow(/positive integer/)
    expect(() => novel.upsertChapter({ number: 1, title: ' ' })).toThrow(/must be non-empty/)
  })

  it('fetches and lists chapters in number order', async () => {
    const novel = await service()
    expect(novel.getChapter(2)).toBeUndefined()
    novel.upsertChapter({ number: 2, title: 'Second' })
    novel.upsertChapter({ number: 1, title: 'First' })
    expect(novel.getChapter(2)?.title).toBe('Second')
    expect(novel.listChapters().map(chapter => chapter.title)).toEqual(['First', 'Second'])
  })
})

describe('markdown export', () => {
  it('writes deterministic exports over an empty store', async () => {
    const novel = await service()
    const paths = await novel.exportMarkdown()
    expect(paths).toHaveLength(7)
    const state = await readFile(join(novel.root, 'world-engine', 'state.md'), 'utf8')
    expect(state).toContain('As of: the beginning of the story')
    expect(await readFile(join(novel.root, 'world-engine', 'subjects.md'), 'utf8'))
      .toBe(await readFile(join(novel.root, 'world-engine', 'subjects.md'), 'utf8'))
  })

  it('renders every document from a populated store', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    novel.recordWorldEvent({
      storyTime: time(1200), title: 'Duel', summary: 'night fight',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'false' }],
    })
    const vow = novel.plantVow({
      title: 'Blade', promise: 'returns', at: time(1200), payoffTarget: 'Chapter 12', note: 'keep',
    })
    novel.payOffVow(vow.id, { at: time(1201), detail: 'forged anew' })
    const decision = novel.recordDecision({
      context: 'survival', options: [option('roof', 'fast', 'risky')],
    })
    novel.decide(decision.id, { chosen: 'roof', rationale: 'height wins' })
    novel.upsertChapter({
      number: 1, title: 'The fire', readerKnows: 'the blade is lost', mayHint: 'the forge',
    })
    await novel.exportMarkdown()
    const subjects = await readFile(join(novel.root, 'world-engine', 'subjects.md'), 'utf8')
    expect(subjects).toContain('## Aya (subject-1) [character]')
    const events = await readFile(join(novel.root, 'world-engine', 'events.md'), 'utf8')
    expect(events).toContain('1200.01.01 — Duel (event-1)')
    expect(events).toContain('Summary: night fight')
    const state = await readFile(join(novel.root, 'world-engine', 'state.md'), 'utf8')
    expect(state).toContain('As of: 1200.01.01')
    expect(state).toContain('alive: false')
    const vows = await readFile(join(novel.root, 'plot', 'vows.md'), 'utf8')
    expect(vows).toContain('## Blade (vow-1) — paid_off')
    expect(vows).toContain('Payoff target: Chapter 12')
    expect(vows).toContain('- payoff (1201.01.01) — forged anew')
    const decisions = await readFile(join(novel.root, 'decisions', 'decisions.md'), 'utf8')
    expect(decisions).toContain('Chosen: roof')
    expect(decisions).toContain('- roof (pros: fast) (cons: risky)')
    const chapters = await readFile(join(novel.root, 'chapters', 'chapters.md'), 'utf8')
    expect(chapters).toContain('## Chapter 1 — The fire')
    expect(chapters).toContain('Reader knows: the blade is lost')
    expect(chapters).toContain('Protagonist knows: -')
  })
})

describe('durable consistency', () => {
  it('reports a clean store', async () => {
    const novel = await service()
    expect(novel.checkIntegrity()).toEqual({
      orphanChanges: 0,
      orphanTransitions: 0,
      unparsableStoryTimes: [],
      payoffWithoutTransition: [],
      unparsableSceneLists: [],
    })
  })

  it('reports orphaned world_changes and vow_transitions rows', async () => {
    const novel = await service()
    novel.createSubject({ kind: 'character', name: 'Aya' })
    corrupt(novel, `
      INSERT INTO world_changes (event_seq, subject_id, field, value) VALUES (999, 'subject-1', 'alive', 'false');
      INSERT INTO vow_transitions (vow_id, seq, action, at_story, detail) VALUES ('vow-x', 1, 'plant', '100000.01.01', '');
    `)
    const report = novel.checkIntegrity()
    expect(report.orphanChanges).toBe(1)
    expect(report.orphanTransitions).toBe(1)
  })

  it.each([
    ['world event story time', "INSERT INTO world_events (id, story_time, title, summary) VALUES ('event-x', 'garbage', 'T', '')"],
    ['vow planting time', "INSERT INTO vows (id, title, promise, planted_at, status, payoff_target, note) VALUES ('vow-x', 'T', 'p', 'garbage', 'planted', '', '')"],
  ])('reports an unparsable %s', async (_label, sql) => {
    const novel = await service()
    corrupt(novel, sql)
    expect(novel.checkIntegrity().unparsableStoryTimes).toEqual(['garbage'])
  })

  it('reports an unparsable transition story time', async () => {
    const novel = await service()
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1200) })
    corrupt(novel,
      `INSERT INTO vow_transitions (vow_id, seq, action, at_story, detail) VALUES ('${vow.id}', 2, 'advance', 'garbage', 'x')`,
    )
    expect(novel.checkIntegrity().unparsableStoryTimes).toEqual(['garbage'])
  })

  it('reports a paid-off vow without a payoff transition', async () => {
    const novel = await service()
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1200) })
    corrupt(novel, `UPDATE vows SET status = 'paid_off' WHERE id = '${vow.id}'`)
    expect(novel.checkIntegrity().payoffWithoutTransition).toEqual([vow.id])
  })
})

describe('plot structure', () => {
  it('creates stories, threads, and scenes with stable ids and validation', async () => {
    const novel = await service()
    const story = novel.createStory({ title: ' 主线的复仇 ', summary: ' 少年寻仇 ' })
    expect(story).toEqual({ id: 'story-1', title: '主线的复仇', summary: '少年寻仇' })
    expect(() => novel.createStory({ title: '  ' })).toThrow(/story title must be non-empty/)
    expect(novel.listStories()).toEqual([story])
    expect(novel.getStory('story-9' as StoryId)).toBeUndefined()

    const thread = novel.createThread({ storyId: story.id, title: ' 剑冢线 ', summary: ' 夺剑 ' })
    expect(thread).toEqual({ id: 'thread-1', storyId: 'story-1', title: '剑冢线', summary: '夺剑', position: 0 })
    expect(() => novel.createThread({ storyId: 'story-9' as StoryId, title: 'X' })).toThrow(/unknown story/)
    expect(novel.listThreads()).toEqual([thread])
    expect(novel.listThreads(story.id)).toEqual([thread])

    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1199) })
    const scene = novel.createScene({
      threadId: thread.id, title: ' 夜闯剑冢 ', summary: ' 取剑 ',
      at: time(1200, 6, 1), location: '剑冢', subjectIds: [subject.id], vowIds: [vow.id],
    })
    expect(scene.id).toBe('scene-1')
    expect(scene.at).toEqual(time(1200, 6, 1))
    expect(scene.subjectIds).toEqual([subject.id])
    expect(scene.vowIds).toEqual([vow.id])
    expect(scene.status).toBe('planned')
    expect(() => novel.createScene({ threadId: 'thread-9' as ThreadId, title: 'X' })).toThrow(/unknown thread/)
    expect(() => novel.createScene({ threadId: thread.id, title: 'X', subjectIds: ['subject-9' as SubjectId] }))
      .toThrow(/unknown subject/)
    expect(() => novel.createScene({ threadId: thread.id, title: 'X', vowIds: ['vow-9' as VowId] }))
      .toThrow(/unknown vow/)
    expect(() => novel.createScene({ threadId: thread.id, title: 'X', status: 'done' as never }))
      .toThrow(/unknown scene status/)
  })

  it('updates a scene and folds the plot tree in position order', async () => {
    const novel = await service()
    const story = novel.createStory({ title: 'S' })
    const thread = novel.createThread({ storyId: story.id, title: 'T' })
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    const vow = novel.plantVow({ title: 'Blade', promise: 'returns', at: time(1199) })
    const first = novel.createScene({ threadId: thread.id, title: 'First', at: time(1200), subjectIds: [subject.id] })
    const second = novel.createScene({ threadId: thread.id, title: 'Second', vowIds: [vow.id], position: 2 })
    expect(second.position).toBe(2)
    const updated = novel.updateScene(first.id, { status: 'written', location: '剑冢', position: 1 })
    expect(updated.status).toBe('written')
    expect(updated.location).toBe('剑冢')
    expect(updated.position).toBe(1)
    expect(() => novel.updateScene('scene-9' as SceneId, { title: 'X' })).toThrow(/unknown scene/)
    expect(() => novel.updateScene(first.id, { status: 'done' as never })).toThrow(/unknown scene status/)
    const tree = novel.listPlot()
    expect(tree.stories).toHaveLength(1)
    expect(tree.stories[0]?.threads).toHaveLength(1)
    expect(tree.stories[0]?.threads[0]?.scenes.map(scene => scene.title)).toEqual(['First', 'Second'])
  })

  it('reports unparsable scene anchors and lists in the integrity report', async () => {
    const novel = await service()
    const story = novel.createStory({ title: 'S' })
    const thread = novel.createThread({ storyId: story.id, title: 'T' })
    const scene = novel.createScene({ threadId: thread.id, title: 'X' })
    corrupt(novel, `UPDATE scenes SET at_story = 'garbage' WHERE id = '${scene.id}'`)
    corrupt(novel, `UPDATE scenes SET subject_ids = '[' WHERE id = '${scene.id}'`)
    const report = novel.checkIntegrity()
    expect(report.unparsableStoryTimes).toEqual(['garbage'])
    expect(report.unparsableSceneLists).toEqual([scene.id])
  })
})

describe('canon lorebook', () => {
  it('registers omniscient and character-scoped entries with validation', async () => {
    const novel = await service()
    const subject = novel.createSubject({ kind: 'character', name: 'Aya' })
    const rule = novel.registerLore({
      category: 'world', title: ' 灵气规则 ', content: ' 灵气会枯竭 ',
    })
    expect(rule).toEqual({
      id: 'lore-1',
      category: 'world',
      title: '灵气规则',
      content: '灵气会枯竭',
      omniscient: true,
      subjectId: null,
    })
    const secret = novel.registerLore({
      category: 'character', title: 'Aya 的身世', content: '她是剑灵转世',
      omniscient: false, subjectId: subject.id,
    })
    expect(secret.omniscient).toBe(false)
    expect(secret.subjectId).toBe(subject.id)
    expect(() => novel.registerLore({ category: 'house' as never, title: 'X', content: 'y' }))
      .toThrow(/unknown lore category/)
    expect(() => novel.registerLore({ category: 'world', title: '  ', content: 'y' }))
      .toThrow(/lore title must be non-empty/)
    expect(() => novel.registerLore({ category: 'world', title: 'X', content: '  ' }))
      .toThrow(/lore content must be non-empty/)
    expect(() => novel.registerLore({
      category: 'world', title: 'X', content: 'y', omniscient: true, subjectId: subject.id,
    })).toThrow(/cannot be scoped/)
    expect(() => novel.registerLore({ category: 'character', title: 'X', content: 'y', omniscient: false }))
      .toThrow(/requires a subject/)
    expect(() => novel.registerLore({
      category: 'character', title: 'X', content: 'y', omniscient: false, subjectId: 'subject-9' as SubjectId,
    })).toThrow(/unknown subject/)
  })

  it('lists, filters, updates, and reads knowledge contexts', async () => {
    const novel = await service()
    const aya = novel.createSubject({ kind: 'character', name: 'Aya' })
    const rin = novel.createSubject({ kind: 'character', name: 'Rin' })
    novel.registerLore({ category: 'world', title: '灵气规则', content: '灵气会枯竭' })
    novel.registerLore({ category: 'location', title: '剑冢', content: '埋着断剑' })
    const ayaSecret = novel.registerLore({
      category: 'character', title: 'Aya 的身世', content: '她是剑灵转世', omniscient: false, subjectId: aya.id,
    })
    novel.registerLore({ category: 'item', title: 'Rin 的刀', content: '刀有灵', omniscient: false, subjectId: rin.id })

    expect(novel.listLore()).toHaveLength(4)
    expect(novel.listLore({ category: 'world' })).toHaveLength(1)
    expect(novel.listLore({ subjectId: aya.id }).map(entry => entry.id)).toEqual([ayaSecret.id])
    expect(novel.listLore({ omniscient: true })).toHaveLength(2)
    expect(novel.listLore({ omniscient: false })).toHaveLength(2)

    const updated = novel.registerLore({ id: ayaSecret.id, category: 'character', title: 'Aya 的身世', content: '她是剑灵转世，也是最后一只青鸾' })
    expect(updated.content).toBe('她是剑灵转世，也是最后一只青鸾')
    expect(() => novel.registerLore({ id: 'lore-99' as LoreId, category: 'world', title: 'X', content: 'y' }))
      .toThrow(/unknown lore/)

    const ayaView = novel.loreContext(aya.id)
    expect(ayaView.subject?.name).toBe('Aya')
    expect(ayaView.omniscient.map(entry => entry.title)).toEqual(['灵气规则', '剑冢'])
    expect(ayaView.scoped.map(entry => entry.title)).toEqual(['Aya 的身世'])
    const bible = novel.loreContext()
    expect(bible.subject).toBeNull()
    expect(bible.scoped).toEqual([])
    expect(bible.omniscient).toHaveLength(2)
    expect(() => novel.loreContext('subject-9' as SubjectId)).toThrow(/unknown subject/)
  })
})

describe('manuscript', () => {
  it('upserts chapter drafts, reads them back in order, and exports them', async () => {
    const novel = await service()
    const first = novel.writeManuscript({ number: 1, title: ' 黎明 ', content: ' 第一章正文 ' })
    expect(first.title).toBe('黎明')
    expect(first.content).toBe('第一章正文')
    expect(first.updatedAt.length).toBeGreaterThan(0)
    const updated = novel.writeManuscript({ number: 1, title: '黎明' })
    expect(updated.content).toBe('第一章正文')
    novel.writeManuscript({ number: 2, title: '风暴', content: '第二章正文' })
    expect(novel.listManuscript().map(entry => entry.number)).toEqual([1, 2])
    expect(novel.readManuscript(3)).toBeUndefined()
    expect(() => novel.writeManuscript({ number: 1, title: ' ' })).toThrow(/manuscript title must be non-empty/)
    await novel.exportMarkdown()
    const doc = await readFile(join(novel.root, 'manuscript', 'manuscript.md'), 'utf8')
    expect(doc).toContain('## Chapter 1 — 黎明')
    expect(doc).toContain('第一章正文')
  })
})
