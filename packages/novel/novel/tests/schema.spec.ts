import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NOVEL_SCHEMA_VERSION, openDatabase } from '../src/schema.ts'

let roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-schema-'))
  roots.push(root)
  return root
}

describe('novel store schema', () => {
  it('stamps a fresh in-memory database and creates every table', () => {
    const db = openDatabase(':memory:')
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(NOVEL_SCHEMA_VERSION)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]).map(row => row.name)
    expect(tables).toEqual([
      'chapters',
      'decisions',
      'lore_entries',
      'manuscript',
      'scenes',
      'stories',
      'subjects',
      'threads',
      'vow_transitions',
      'vows',
      'world_changes',
      'world_events',
    ])
    db.close()
  })

  it('creates missing directories and the owner-only database file', async () => {
    const root = await tmpRoot()
    const dbPath = join(root, 'deep', 'nested', 'state.sqlite')
    const db = openDatabase(dbPath)
    db.exec("INSERT INTO subjects (id, kind, name, summary) VALUES ('subject-1', 'character', 'Aya', '')")
    db.close()
    const reopen = openDatabase(dbPath)
    const rows = reopen.prepare('SELECT id FROM subjects').all()
    expect(rows).toEqual([{ id: 'subject-1' }])
    reopen.close()
  })

  it('rejects a database stamped with an incompatible schema version', async () => {
    const root = await tmpRoot()
    const dbPath = join(root, 'state.sqlite')
    const db = openDatabase(dbPath)
    db.exec(`PRAGMA user_version = ${NOVEL_SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => openDatabase(dbPath)).toThrow(/schema version \d+, incompatible/)
  })

  it('rejects a database path that is a directory', async () => {
    const root = await tmpRoot()
    const dbPath = join(root, 'state.sqlite')
    await mkdir(dbPath)
    expect(() => openDatabase(dbPath)).toThrow()
  })
})
