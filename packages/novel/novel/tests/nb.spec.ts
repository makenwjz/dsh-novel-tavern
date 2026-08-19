import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { NovelService } from '../src/index.ts'
import { exportNeuroBookProject, importNeuroBookProject } from '../src/nb/index.ts'
import type { StoryTime } from '../src/types.ts'

let ctxs: Context[] = []
let roots: string[] = []

afterEach(async () => {
  await Promise.all(ctxs.map(ctx => ctx.fiber.dispose()))
  ctxs = []
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

async function service(): Promise<NovelService> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-nb-'))
  roots.push(root)
  const ctx = new Context()
  ctxs.push(ctx)
  await ctx.plugin(NovelService, { root })
  return ctx.novel
}

function time(year: number, month = 1, day = 1): StoryTime {
  return { year, month, day }
}

/** A DSH store with one subject, two events, and both lore layers. */
async function seededStore(): Promise<NovelService> {
  const novel = await service()
  const aya = novel.createSubject({ kind: 'character', name: 'Aya' })
  novel.recordWorldEvent({
    storyTime: time(1200, 1, 1), title: 'Arrival',
    changes: [{ subjectId: aya.id, field: 'status', value: 'calm' }],
  })
  novel.recordWorldEvent({
    storyTime: time(1200, 6, 1), title: 'Fire',
    changes: [
      { subjectId: aya.id, field: 'status', value: 'burning' },
      { subjectId: aya.id, field: 'injured', value: 'left arm' },
    ],
  })
  novel.registerLore({ category: 'world', title: '灵气规则', content: '灵气会枯竭' })
  novel.registerLore({ category: 'character', title: 'Aya 的身世', content: '她是剑灵转世', omniscient: false, subjectId: aya.id })
  return novel
}

describe('neuro-book export', () => {
  it('writes lorebook markdown, scoped-lore archives, the world SQLite, and a JSONL mirror', async () => {
    const novel = await seededStore()
    const target = await mkdtemp(join(tmpdir(), 'dsh-nb-export-'))
    roots.push(target)

    const report = exportNeuroBookProject(novel, target)
    expect(report.loreWritten).toBe(1)
    expect(report.scopedLoreWritten).toBe(1)
    expect(report.subjectsExported).toBe(1)
    expect(report.slicesExported).toBe(2)
    expect(report.patchesExported).toBe(3)
    expect(report.sqlitePath).toBe(join(target, '.nbook', 'project.sqlite'))

    const ruleMarkdown = await readFile(join(target, 'lorebook', 'world', '灵气规则.md'), 'utf8')
    expect(ruleMarkdown).toContain('# 灵气规则')
    expect(ruleMarkdown).toContain('灵气会枯竭')
    const scopedMarkdown = await readFile(join(target, 'reference', 'dsh-scoped-lore', 'subject-1', 'Aya 的身世.md'), 'utf8')
    expect(scopedMarkdown).toContain('她是剑灵转世')

    const db = new DatabaseSync(report.sqlitePath, { readOnly: true })
    try {
      const subjects = db.prepare('SELECT id, type, name FROM "WorldSubject"').all() as { id: string; type: string; name: string }[]
      expect(subjects).toEqual([{ id: 'dsh-subject-1', type: 'character', name: 'Aya' }])
      const slices = db.prepare('SELECT id, instant, title FROM "WorldSlice" ORDER BY instant').all() as { id: string; instant: bigint; title: string }[]
      expect(slices.map(slice => slice.title)).toEqual(['Arrival', 'Fire'])
      const patches = db.prepare('SELECT path, op, value FROM "WorldPatch" ORDER BY instant, seq').all() as { path: string; op: string; value: string }[]
      // Within one slice, seq follows the DSH change order (alphabetical by field).
      expect(patches).toEqual([
        { path: '/status', op: 'replace', value: '"calm"' },
        { path: '/injured', op: 'replace', value: '"left arm"' },
        { path: '/status', op: 'replace', value: '"burning"' },
      ])
    } finally {
      db.close()
    }

    const jsonl = await readFile(report.jsonlPath, 'utf8')
    expect(jsonl.split('\n').filter(line => line.length > 0)).toHaveLength(1 + 2 + 3)
  })
})

describe('neuro-book import', () => {
  it('round-trips an exported project back into a fresh store', async () => {
    const source = await seededStore()
    const project = await mkdtemp(join(tmpdir(), 'dsh-nb-project-'))
    roots.push(project)
    exportNeuroBookProject(source, project)

    const novel = await service()
    const report = importNeuroBookProject(novel, project)
    expect(report.loreImported).toBe(1)
    expect(report.subjectsImported).toBe(1)
    expect(report.eventsImported).toBe(2)
    expect(report.patchesSkipped).toBe(0)

    expect(novel.listSubjects()[0]?.name).toBe('Aya')
    const state = novel.worldState()
    expect(state.at).toEqual(time(1200, 6, 1))
    expect(state.subjects[0]?.fields).toEqual({ status: 'burning', injured: 'left arm' })
    expect(novel.listLore({ omniscient: true }).map(entry => entry.title)).toEqual(['灵气规则'])
    expect(novel.listLore({ omniscient: true })[0]?.content).toBe('灵气会枯竭')
    expect(novel.listWorldEvents().map(event => event.title)).toEqual(['Arrival', 'Fire'])
  })

  it('imports a lorebook-only project (no World Engine sqlite)', async () => {
    const project = await mkdtemp(join(tmpdir(), 'dsh-nb-lore-'))
    roots.push(project)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(project, 'lorebook', 'world'), { recursive: true })
    mkdirSync(join(project, 'lorebook', 'faction'), { recursive: true })
    writeFileSync(join(project, 'lorebook', 'world', '剑冢.md'), '# 剑冢\n\n北境埋着断剑。\n', 'utf8')
    writeFileSync(join(project, 'lorebook', 'faction', '玄天宗.md'), '---\nkind: faction\n---\n# 玄天宗\n\n天下第一大派。\n', 'utf8')
    writeFileSync(join(project, 'lorebook', 'index.md'), '# index', 'utf8')

    const novel = await service()
    const report = importNeuroBookProject(novel, project)
    expect(report.loreImported).toBe(2)
    const lore = novel.listLore({ omniscient: true })
    expect(lore.map(entry => `${entry.category}:${entry.title}`)).toEqual(['faction:玄天宗', 'world:剑冢'])
    expect(lore.find(entry => entry.title === '剑冢')?.content).toBe('北境埋着断剑。')
    expect(lore.find(entry => entry.title === '玄天宗')?.content).toBe('天下第一大派。')
  })

  it('tolerates a project with only the WorldSubject table and skips non-replace ops', async () => {
    const project = await mkdtemp(join(tmpdir(), 'dsh-nb-partial-'))
    roots.push(project)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(project, '.nbook'), { recursive: true })
    const db = new DatabaseSync(join(project, '.nbook', 'project.sqlite'))
    db.exec(`
      CREATE TABLE "WorldSubject" ("id" TEXT NOT NULL PRIMARY KEY, "type" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "WorldSubject" ("id", "type", "name") VALUES ('erina', 'character', 'Erina');
    `)
    db.close()

    const novel = await service()
    const report = importNeuroBookProject(novel, project)
    expect(report.subjectsImported).toBe(1)
    expect(report.eventsImported).toBe(0)
    expect(novel.listSubjects()[0]?.name).toBe('Erina')
  })
})
