/**
 * Read and write the neuro-book World Engine tables (`WorldSubject`,
 * `WorldSlice`, `WorldPatch`) of a project SQLite. The table contract matches
 * neuro-book's `prisma/project.schema.prisma`; reads guard every table and
 * column through `PRAGMA table_info` so real projects with schema drift stay
 * readable, and writes create the tables (when absent) with the same DDL.
 * @module @deepseek-ai/dsh-novel/nb/project-sqlite
 */

import { DatabaseSync } from 'node:sqlite'

/** One neuro-book world subject row. */
export interface NbWorldSubjectRow {
  /** Stable subject id (refs point at it). */
  readonly id: string
  /** Schema subject type: character, location, faction, ... */
  readonly type: string
  /** Human-readable name (display only; state lives in slices). */
  readonly name: string
}

/** One neuro-book world slice row. */
export interface NbWorldSliceRow {
  /** Slice id (cuid in real projects; minted here). */
  readonly id: string
  /** Unique time truth source, seconds since the project calendar epoch. */
  readonly instant: bigint
  /** Slice title. */
  readonly title: string
  /** Slice summary. */
  readonly summary: string
  /** Slice kind: event / init / backstory (display only). */
  readonly kind: string
}

/** One neuro-book world patch row. */
export interface NbWorldPatchRow {
  /** Patch id (cuid in real projects; minted here). */
  readonly id: string
  /** Owning slice id. */
  readonly sliceId: string
  /** Target subject id. */
  readonly subjectId: string
  /** Denormalized instant of the owning slice. */
  readonly instant: bigint
  /** Application order within the slice. */
  readonly seq: number
  /** JSON Pointer path, for example `/hp` or `/equipment/weapon`. */
  readonly path: string
  /** Patch operation: replace / increment / remove / append. */
  readonly op: string
  /** JSON-encoded payload; null for a bare remove. */
  readonly value: string | null
}

/** The world rows of one project, kept in a shape ready for DSH conversion. */
export interface NbWorldRows {
  readonly subjects: readonly NbWorldSubjectRow[]
  readonly slices: readonly NbWorldSliceRow[]
  readonly patches: readonly NbWorldPatchRow[]
}

/** The exact World-table DDL, matching neuro-book's project schema. */
const WORLD_DDL = `
  CREATE TABLE IF NOT EXISTS "WorldSubject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS "WorldSlice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instant" BIGINT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'event',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "WorldSlice_instant_key" ON "WorldSlice"("instant");
  CREATE INDEX IF NOT EXISTS "WorldSlice_instant_idx" ON "WorldSlice"("instant");
  CREATE TABLE IF NOT EXISTS "WorldPatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sliceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "instant" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "value" TEXT,
    "summary" TEXT,
    "text" TEXT,
    "vector" BLOB,
    "model" TEXT,
    CONSTRAINT "WorldPatch_sliceId_fkey" FOREIGN KEY ("sliceId") REFERENCES "WorldSlice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldPatch_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "WorldSubject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "WorldPatch_subjectId_instant_seq_idx" ON "WorldPatch"("subjectId", "instant", "seq");
`

/** The columns each table is read through (documented contract). */
const WORLD_COLUMNS = {
  'WorldSubject': ['id', 'type', 'name'],
  'WorldSlice': ['id', 'instant', 'title', 'summary', 'kind'],
  'WorldPatch': ['id', 'sliceId', 'subjectId', 'instant', 'seq', 'path', 'op', 'value'],
} as const

/** Whether a table exists and carries the documented columns. */
function hasTable(db: DatabaseSync, table: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.length === 0) return false
  const names = new Set(columns.map(column => column.name))
  return WORLD_COLUMNS[table as keyof typeof WORLD_COLUMNS].every(column => names.has(column))
}

/** Create the World tables when absent (idempotent). */
export function ensureWorldTables(db: DatabaseSync): void {
  db.exec(WORLD_DDL)
}

/** Read the world rows of one project database, tolerating missing tables. */
export function readWorldRows(db: DatabaseSync): NbWorldRows {
  const subjects: NbWorldSubjectRow[] = []
  const slices: NbWorldSliceRow[] = []
  const patches: NbWorldPatchRow[] = []
  if (hasTable(db, 'WorldSubject')) {
    for (const row of db.prepare('SELECT id, type, name FROM "WorldSubject" ORDER BY id').all() as
      { id: string; type: string; name: string }[]) {
      subjects.push({ id: row.id, type: row.type, name: row.name })
    }
  }
  if (hasTable(db, 'WorldSlice')) {
    for (const row of db.prepare('SELECT id, instant, title, summary, kind FROM "WorldSlice" ORDER BY instant').all() as
      { id: string; instant: bigint; title: string; summary: string; kind: string }[]) {
      slices.push({
        id: row.id,
        instant: typeof row.instant === 'bigint' ? row.instant : BigInt(row.instant),
        title: row.title,
        summary: row.summary,
        kind: row.kind,
      })
    }
  }
  if (hasTable(db, 'WorldPatch')) {
    for (const row of db.prepare(
      'SELECT id, sliceId, subjectId, instant, seq, path, op, value FROM "WorldPatch" ORDER BY instant, seq',
    ).all() as {
      id: string
      sliceId: string
      subjectId: string
      instant: bigint
      seq: number
      path: string
      op: string
      value: string | null
    }[]) {
      patches.push({
        id: row.id,
        sliceId: row.sliceId,
        subjectId: row.subjectId,
        instant: typeof row.instant === 'bigint' ? row.instant : BigInt(row.instant),
        seq: row.seq,
        path: row.path,
        op: row.op,
        value: row.value,
      })
    }
  }
  return { subjects, slices, patches }
}

/** Write the world rows in one transaction, creating tables when absent. */
export function writeWorldRows(db: DatabaseSync, rows: NbWorldRows): void {
  ensureWorldTables(db)
  db.exec('PRAGMA foreign_keys = ON')
  const insertSubject = db.prepare('INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)')
  const insertSlice = db.prepare(
    'INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)',
  )
  const insertPatch = db.prepare(`
    INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    for (const subject of rows.subjects) {
      insertSubject.run(subject.id, subject.type, subject.name)
    }
    for (const slice of rows.slices) {
      insertSlice.run(slice.id, slice.instant, slice.title, slice.summary, slice.kind)
    }
    for (const patch of rows.patches) {
      insertPatch.run(
        patch.id, patch.sliceId, patch.subjectId, patch.instant, patch.seq, patch.path, patch.op, patch.value,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
