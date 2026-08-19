/**
 * Export the DSH novel workspace into a neuro-book-shaped project: canon lore
 * entries become `lorebook/<category>/` markdown, character-scoped entries are
 * archived under `reference/dsh-scoped-lore/`, and the world engine (subjects
 * and story-timed events with their field changes) becomes `WorldSubject` /
 * `WorldSlice` / `WorldPatch` rows in `.nbook/project.sqlite`, plus a portable
 * JSONL mirror. Only the public service API is read; the store itself is never
 * modified.
 * @module @deepseek-ai/dsh-novel/nb/export
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NovelService } from '../index.ts'
import { storyTimeToInstant } from './calendar.ts'
import {
  writeWorldRows,
  type NbWorldPatchRow,
  type NbWorldSliceRow,
  type NbWorldSubjectRow,
} from './project-sqlite.ts'

/** The result of one export. */
export interface NbExportReport {
  /** Omniscient lore entries written as `lorebook/` markdown. */
  readonly loreWritten: number
  /** Character-scoped lore entries archived under `reference/`. */
  readonly scopedLoreWritten: number
  /** Subjects written to the World Engine tables. */
  readonly subjectsExported: number
  /** Slices written (one per DSH world event). */
  readonly slicesExported: number
  /** Patch rows written. */
  readonly patchesExported: number
  /** The written project SQLite path. */
  readonly sqlitePath: string
  /** The written portable JSONL path. */
  readonly jsonlPath: string
  /** The project root that was written. */
  readonly root: string
}

/** Turn a lore title into a safe filename stem. */
function slugify(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

/** The mutable builder shape of an export report. */
type MutableExportReport = {
  loreWritten: number
  scopedLoreWritten: number
  subjectsExported: number
  slicesExported: number
  patchesExported: number
  sqlitePath: string
  jsonlPath: string
  root: string
}

/** Export the DSH novel workspace into one neuro-book-shaped project root. */
export function exportNeuroBookProject(novel: NovelService, root: string): NbExportReport {
  const resolved = resolve(root)
  const report: MutableExportReport = {
    loreWritten: 0,
    scopedLoreWritten: 0,
    subjectsExported: 0,
    slicesExported: 0,
    patchesExported: 0,
    sqlitePath: '',
    jsonlPath: '',
    root: resolved,
  }

  const lorebookBase = join(resolved, 'lorebook')
  for (const entry of novel.listLore({ omniscient: true })) {
    const directory = join(lorebookBase, entry.category)
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `${slugify(entry.title)}.md`),
      `# ${entry.title}\n\n${entry.content}\n`,
      'utf8',
    )
    report.loreWritten += 1
  }
  for (const entry of novel.listLore({ omniscient: false })) {
    const directory = join(resolved, 'reference', 'dsh-scoped-lore', entry.subjectId ?? 'unknown')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `${slugify(entry.title)}.md`),
      `# ${entry.title}\n\n${entry.content}\n`,
      'utf8',
    )
    report.scopedLoreWritten += 1
  }

  const subjectIdByDsh = new Map<string, string>()
  const subjects: NbWorldSubjectRow[] = novel.listSubjects().map((subject) => {
    const id = `dsh-${subject.id}`
    subjectIdByDsh.set(subject.id, id)
    return { id, type: subject.kind, name: subject.name }
  })
  const slices: NbWorldSliceRow[] = []
  const patches: NbWorldPatchRow[] = []
  for (const event of novel.listWorldHistory()) {
    const sliceId = `dsh-slice-${event.id}`
    const instant = storyTimeToInstant(event.storyTime)
    slices.push({ id: sliceId, instant, title: event.title, summary: event.summary, kind: 'event' })
    event.changes.forEach((change, seq) => {
      const nbSubjectId = subjectIdByDsh.get(change.subjectId)
      if (nbSubjectId === undefined) return
      patches.push({
        id: `dsh-patch-${event.id}-${seq}`,
        sliceId,
        subjectId: nbSubjectId,
        instant,
        seq,
        path: `/${change.field.replace(/\./g, '/')}`,
        op: 'replace',
        value: JSON.stringify(change.value),
      })
    })
  }
  report.subjectsExported = subjects.length
  report.slicesExported = slices.length
  report.patchesExported = patches.length

  const sqliteDirectory = join(resolved, '.nbook')
  mkdirSync(sqliteDirectory, { recursive: true })
  const sqlitePath = join(sqliteDirectory, 'project.sqlite')
  const db = new DatabaseSync(sqlitePath)
  try {
    writeWorldRows(db, { subjects, slices, patches })
  } finally {
    db.close()
  }
  report.sqlitePath = sqlitePath

  const jsonlPath = join(resolved, 'world-engine-export.jsonl')
  const lines: string[] = []
  for (const subject of subjects) {
    lines.push(JSON.stringify({ kind: 'subject', id: subject.id, type: subject.type, name: subject.name }))
  }
  for (const slice of slices) {
    lines.push(JSON.stringify({
      kind: 'slice', id: slice.id, instant: Number(slice.instant),
      title: slice.title, summary: slice.summary, sliceKind: slice.kind,
    }))
  }
  for (const patch of patches) {
    lines.push(JSON.stringify({
      kind: 'patch', id: patch.id, sliceId: patch.sliceId, subjectId: patch.subjectId,
      instant: Number(patch.instant), seq: patch.seq, path: patch.path, op: patch.op, value: patch.value,
    }))
  }
  writeFileSync(jsonlPath, `${lines.join('\n')}\n`, 'utf8')
  report.jsonlPath = jsonlPath

  return report
}
