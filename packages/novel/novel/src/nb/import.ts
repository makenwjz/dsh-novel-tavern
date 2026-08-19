/**
 * Import a neuro-book project into the DSH novel workspace: `lorebook/`
 * markdown becomes omniscient canon entries, and the project SQLite's World
 * Engine tables (`WorldSubject` / `WorldSlice` / `WorldPatch`) become DSH
 * subjects and story-timed world events. Import is additive and uses only the
 * public service API, so it never touches the DSH store directly.
 * @module @deepseek-ai/dsh-novel/nb/import
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NovelService } from '../index.ts'
import type { LoreCategory, SubjectId, SubjectKind } from '../types.ts'
import { instantToStoryTime } from './calendar.ts'
import { readWorldRows, type NbWorldRows } from './project-sqlite.ts'

/** The result of one import. */
export interface NbImportReport {
  /** Canon lore entries imported from `lorebook/` markdown. */
  readonly loreImported: number
  /** Subjects registered from the World Engine table. */
  readonly subjectsImported: number
  /** World events recorded from slices. */
  readonly eventsImported: number
  /** Patch rows skipped because their op is not representable as a DSH field overwrite. */
  readonly patchesSkipped: number
  /** Subjects referenced by patches but absent from the World Engine table. */
  readonly unknownSubjects: number
  /** The project root that was read. */
  readonly root: string
}

/** neuro-book lorebook top-level directories → DSH lore categories. */
const LORE_DIRECTORY_TO_CATEGORY: Readonly<Record<string, LoreCategory>> = {
  world: 'world',
  character: 'character',
  location: 'location',
  faction: 'faction',
  item: 'item',
  event: 'event',
  system: 'system',
  instruction: 'instruction',
  note: 'note',
}

/** neuro-book subject types → DSH subject kinds (unknown types fold to object). */
function mapKind(type: string): SubjectKind {
  switch (type) {
    case 'character': return 'character'
    case 'location': return 'location'
    case 'faction': return 'faction'
    default: return 'object'
  }
}

/** One JSON Pointer path → one DSH field name (`/equipment/weapon` → `equipment.weapon`). */
function fieldFromPath(path: string): string {
  return path.replace(/^\//, '').replace(/\//g, '.')
}

/** Strip YAML frontmatter and the leading H1 from one lorebook markdown body. */
function stripMarkdownShell(body: string): string {
  let text = body.replace(/^\uFEFF/, '')
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      text = text.slice(end + 4).replace(/^\n+/, '')
    }
  }
  return text.replace(/^#\s+[^\n]+\n+/, '').trim()
}

/** Scan `lorebook/` recursively into (category, title, content) entries. */
function scanLorebook(root: string): Array<{ category: LoreCategory; title: string; content: string }> {
  const entries: Array<{ category: LoreCategory; title: string; content: string }> = []
  const base = join(root, 'lorebook')
  if (!existsSync(base)) return entries
  const walk = (directory: string, topLevel: string, relative: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      if (name === 'index.md') continue
      if (name.endsWith('.md')) {
        const title = name.slice(0, -3)
        entries.push({
          category: LORE_DIRECTORY_TO_CATEGORY[topLevel] ?? 'note',
          title: relative.length === 0 ? title : `${relative}/${title}`,
          content: stripMarkdownShell(readFileSync(path, 'utf8')),
        })
      } else if (topLevel.length === 0) {
        // First-level directories are the category; files directly under them
        // carry no relative sub-path.
        walk(path, name, '')
      } else {
        walk(path, topLevel, relative.length === 0 ? name : `${relative}/${name}`)
      }
    }
  }
  walk(base, '', '')
  return entries
}

/** Convert the World Engine rows into DSH store writes via the public API. */
function importWorldRows(
  novel: NovelService,
  rows: NbWorldRows,
  report: MutableReport,
): void {
  const subjectIdByNb = new Map<string, string>()
  for (const subject of rows.subjects) {
    const created = novel.createSubject({
      kind: mapKind(subject.type),
      name: subject.name.length > 0 ? subject.name : subject.id,
    })
    subjectIdByNb.set(subject.id, created.id)
    report.subjectsImported += 1
  }
  for (const slice of rows.slices) {
    const changes: Array<{ subjectId: SubjectId; field: string; value: string }> = []
    const seen = new Set<string>()
    for (const patch of rows.patches.filter(candidate => candidate.sliceId === slice.id)) {
      if (patch.op !== 'replace') {
        report.patchesSkipped += 1
        continue
      }
      const dshSubjectId = subjectIdByNb.get(patch.subjectId)
      if (dshSubjectId === undefined) {
        report.unknownSubjects += 1
        continue
      }
      const key = `${dshSubjectId}\u0000${patch.path}`
      if (seen.has(key)) continue
      seen.add(key)
      const raw = patch.value === null ? '' : JSON.parse(patch.value)
      changes.push({
        subjectId: dshSubjectId as SubjectId,
        field: fieldFromPath(patch.path),
        value: typeof raw === 'string' ? raw : JSON.stringify(raw),
      })
    }
    novel.recordWorldEvent({
      storyTime: instantToStoryTime(slice.instant),
      title: slice.title.length > 0 ? slice.title : `event @ ${slice.instant}`,
      summary: slice.summary,
      changes,
    })
    report.eventsImported += 1
  }
}

/** One line of the portable world-engine JSONL export. */
type JsonlRecord = {
  readonly kind: 'subject' | 'slice' | 'patch'
  readonly id?: string
  readonly type?: string
  readonly name?: string
  readonly instant?: string | number
  readonly title?: string
  readonly summary?: string
  readonly sliceKind?: string
  readonly sliceId?: string
  readonly subjectId?: string
  readonly seq?: number
  readonly path?: string
  readonly op?: string
  readonly value?: string | null
}

/** Load the portable JSONL world export into an in-memory World-table database. */
function loadJsonlWorld(jsonlPath: string): NbWorldRows {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE "WorldSubject" ("id" TEXT NOT NULL PRIMARY KEY, "type" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '');
      CREATE TABLE "WorldSlice" ("id" TEXT NOT NULL PRIMARY KEY, "instant" BIGINT NOT NULL, "title" TEXT NOT NULL DEFAULT '', "summary" TEXT NOT NULL DEFAULT '', "kind" TEXT NOT NULL DEFAULT 'event');
      CREATE TABLE "WorldPatch" ("id" TEXT NOT NULL PRIMARY KEY, "sliceId" TEXT NOT NULL, "subjectId" TEXT NOT NULL, "instant" BIGINT NOT NULL, "seq" INTEGER NOT NULL DEFAULT 0, "path" TEXT NOT NULL, "op" TEXT NOT NULL, "value" TEXT);
    `)
    for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue
      const record = JSON.parse(line) as JsonlRecord
      if (record.kind === 'subject') {
        db.prepare('INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)')
          .run(record.id ?? '', record.type ?? 'object', record.name ?? '')
      } else if (record.kind === 'slice') {
        db.prepare('INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)')
          .run(
            record.id ?? '', BigInt(record.instant ?? 0), record.title ?? '',
            record.summary ?? '', record.sliceKind ?? 'event',
          )
      } else if (record.kind === 'patch') {
        db.prepare('INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value") VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            record.id ?? '', record.sliceId ?? '', record.subjectId ?? '', BigInt(record.instant ?? 0),
            record.seq ?? 0, record.path ?? '', record.op ?? '', record.value ?? null,
          )
      }
    }
    return readWorldRows(db)
  } finally {
    db.close()
  }
}

/** The mutable builder shape of an import report. */
type MutableReport = {
  loreImported: number
  subjectsImported: number
  eventsImported: number
  patchesSkipped: number
  unknownSubjects: number
  root: string
}

/** Import one neuro-book project into the DSH novel workspace. */
export function importNeuroBookProject(novel: NovelService, root: string): NbImportReport {
  const resolved = resolve(root)
  const report: MutableReport = {
    loreImported: 0,
    subjectsImported: 0,
    eventsImported: 0,
    patchesSkipped: 0,
    unknownSubjects: 0,
    root: resolved,
  }
  for (const entry of scanLorebook(resolved)) {
    novel.registerLore({
      category: entry.category,
      title: entry.title,
      content: entry.content,
      omniscient: true,
    })
    report.loreImported += 1
  }
  const sqlitePath = join(resolved, '.nbook', 'project.sqlite')
  const jsonlPath = join(resolved, 'world-engine-export.jsonl')
  if (existsSync(sqlitePath)) {
    const db = new DatabaseSync(sqlitePath, { readOnly: true })
    try {
      importWorldRows(novel, readWorldRows(db), report)
    } finally {
      db.close()
    }
  } else if (existsSync(jsonlPath)) {
    // The SQLite form is authoritative when both exist; the JSONL mirror is
    // the fallback for sqlite-less copies of an export.
    importWorldRows(novel, loadJsonlWorld(jsonlPath), report)
  }
  return report
}
