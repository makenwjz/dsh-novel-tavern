/**
 * Schema and open-time helpers for the novel workspace store: the physical
 * layout version, the database open/configure sequence (permissions, pragmas,
 * version stamp/reject), and every table the domain owns.
 * @module @deepseek-ai/dsh-novel/schema
 */

import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`.
 * Bumped only on a breaking change to the table layout; any other version
 * rejects — this unreleased format has no migrations.
 */
export const NOVEL_SCHEMA_VERSION = 3

/**
 * Open the store database and ensure the schema. Missing directories and
 * database files are created owner-only; `:memory:` skips filesystem setup.
 * A zero `user_version` is stamped with {@link NOVEL_SCHEMA_VERSION}; every
 * other non-current version rejects rather than being migrated in place.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @returns the open handle with pragmas applied and every table ensured.
 */
export function openDatabase(path: string): DatabaseSync {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
    try {
      const fd = openSync(actual, 'wx', 0o600)
      closeSync(fd)
    } catch (error) {
      /* v8 ignore next -- Windows reports an existing directory as EEXIST; the peer SQLite open rejects it (SQLITE_CANTOPEN). */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const db = new DatabaseSync(actual)
  try {
    configureDatabase(db, actual)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  // `PRAGMA user_version` always returns exactly one row { user_version }.
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== 1 && onDisk !== 2 && onDisk !== NOVEL_SCHEMA_VERSION) {
    throw new Error(
      `novel: store at "${path}" has schema version ${onDisk}, incompatible with this build (${NOVEL_SCHEMA_VERSION})`,
    )
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id      TEXT PRIMARY KEY,
      kind    TEXT NOT NULL CHECK (kind IN ('character', 'location', 'faction', 'object')),
      name    TEXT NOT NULL CHECK (length(name) > 0),
      summary TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_events (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      id         TEXT NOT NULL UNIQUE,
      story_time TEXT NOT NULL,
      title      TEXT NOT NULL CHECK (length(title) > 0),
      summary    TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_changes (
      event_seq  INTEGER NOT NULL REFERENCES world_events(seq),
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      field      TEXT NOT NULL CHECK (length(field) > 0),
      value      TEXT NOT NULL,
      PRIMARY KEY (event_seq, subject_id, field)
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vows (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL CHECK (length(title) > 0),
      promise       TEXT NOT NULL CHECK (length(promise) > 0),
      planted_at    TEXT NOT NULL,
      status        TEXT NOT NULL CHECK (status IN ('planted', 'advanced', 'paid_off', 'abandoned')),
      payoff_target TEXT NOT NULL,
      note          TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vow_transitions (
      vow_id  TEXT NOT NULL REFERENCES vows(id),
      seq     INTEGER NOT NULL,
      action  TEXT NOT NULL CHECK (action IN ('plant', 'advance', 'payoff', 'abandon')),
      at_story TEXT NOT NULL,
      detail  TEXT NOT NULL,
      PRIMARY KEY (vow_id, seq)
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      context    TEXT NOT NULL CHECK (length(context) > 0),
      options    TEXT NOT NULL,
      chosen     TEXT,
      rationale  TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('open', 'decided'))
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      number           INTEGER PRIMARY KEY CHECK (number > 0),
      title            TEXT NOT NULL CHECK (length(title) > 0),
      reader_knows     TEXT NOT NULL,
      protagonist_knows TEXT NOT NULL,
      must_conceal     TEXT NOT NULL,
      may_hint         TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id      TEXT PRIMARY KEY,
      title   TEXT NOT NULL CHECK (length(title) > 0),
      summary TEXT NOT NULL DEFAULT ''
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id       TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id),
      title    TEXT NOT NULL CHECK (length(title) > 0),
      summary  TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT NOT NULL REFERENCES threads(id),
      title       TEXT NOT NULL CHECK (length(title) > 0),
      summary     TEXT NOT NULL DEFAULT '',
      at_story    TEXT,
      location    TEXT NOT NULL DEFAULT '',
      subject_ids TEXT NOT NULL DEFAULT '[]',
      vow_ids     TEXT NOT NULL DEFAULT '[]',
      position    INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL CHECK (status IN ('planned', 'writing', 'written')) DEFAULT 'planned'
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS lore_entries (
      id         TEXT PRIMARY KEY,
      category   TEXT NOT NULL CHECK (category IN ('world', 'character', 'location', 'faction', 'item', 'event', 'system', 'instruction', 'note')),
      title      TEXT NOT NULL CHECK (length(title) > 0),
      content    TEXT NOT NULL,
      omniscient INTEGER NOT NULL CHECK (omniscient IN (0, 1)),
      subject_id TEXT REFERENCES subjects(id)
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS manuscript (
      number     INTEGER PRIMARY KEY CHECK (number > 0),
      title      TEXT NOT NULL CHECK (length(title) > 0),
      content    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    ) STRICT
  `)
  if (onDisk === 0 || onDisk === 1 || onDisk === 2) {
    // Stamp fresh databases LAST: the stamp asserts the layout is complete,
    // so a failure above must leave the medium unstamped (a re-open after the
    // obstruction is cleared retries materialization from scratch). Older
    // stores carry the additive plot and lore tables created above and are
    // stamped to the current layout without touching their existing rows.
    db.exec(`PRAGMA user_version = ${NOVEL_SCHEMA_VERSION}`)
  }
}
