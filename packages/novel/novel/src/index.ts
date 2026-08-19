/**
 * Long-form fiction writing workspace service. Owns one SQLite store per
 * workspace directory (`state.sqlite`) holding the world engine (subjects and
 * story-timed events), the plot vow ledger, creative decisions, and chapter
 * knowledge control, plus deterministic Markdown exports of the same data.
 * Every mutation is a transaction; reads fold subject state at any story time.
 * @module @deepseek-ai/dsh-novel
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  renderChapters,
  renderDecisions,
  renderEvents,
  renderManuscript,
  renderState,
  renderSubjects,
  renderVows,
} from './markdown.ts'
import { openDatabase } from './schema.ts'
import { parseStoryTime, serializeStoryTime, validateStoryTime } from './story-time.ts'
import type {
  ChapterInfo,
  ChapterInput,
  Decision,
  DecisionId,
  DecisionOption,
  IntegrityReport,
  LoreCategory,
  LoreContext,
  LoreEntry,
  LoreId,
  LoreInput,
  Manuscript,
  ManuscriptInput,
  PlotTree,
  Scene,
  SceneId,
  SceneInput,
  ScenePatch,
  SceneStatus,
  Story,
  StoryId,
  StoryThread,
  Subject,
  SubjectId,
  SubjectKind,
  SubjectState,
  StoryTime,
  ThreadId,
  Vow,
  VowId,
  VowLedger,
  VowStatus,
  VowTransition,
  WorldEvent,
  WorldEventId,
  WorldEventInput,
  WorldEventLogEntry,
  WorldState,
} from './types.ts'

export { NOVEL_SCHEMA_VERSION } from './schema.ts'
export type * from './types.ts'

/** Plugin configuration. */
export interface Config {
  /**
   * Directory holding the store and Markdown exports. Relative paths resolve
   * against the process working directory (the workspace root in shipped
   * compositions). Defaults to `novel`.
   */
  root: string
}

/** Raw event row. */
type EventRow = { seq: number; id: string; story_time: string; title: string; summary: string }

/** Raw change row. */
type ChangeRow = { field: string; value: string; story_time: string }

/** Raw vow row. */
type VowRow = {
  id: string
  title: string
  promise: string
  planted_at: string
  status: string
  payoff_target: string
  note: string
}

/** Raw transition row. */
type TransitionRow = { action: string; at_story: string; detail: string }

/** Raw decision row. */
type DecisionRow = {
  id: string
  created_at: string
  context: string
  options: string
  chosen: string | null
  rationale: string
  status: string
}

/** Raw story row. */
type StoryRow = { id: string; title: string; summary: string }

/** Raw thread row. */
type ThreadRow = { id: string; story_id: string; title: string; summary: string; position: number }

/** Raw scene row. */
type SceneRow = {
  id: string
  thread_id: string
  title: string
  summary: string
  at_story: string | null
  location: string
  subject_ids: string
  vow_ids: string
  position: number
  status: string
}

/** Raw lore entry row. */
type LoreRow = {
  id: string
  category: string
  title: string
  content: string
  omniscient: number
  subject_id: string | null
}

/** Raw manuscript row. */
type ManuscriptRow = {
  number: number
  title: string
  content: string
  updated_at: string
}

const SUBJECT_KINDS: readonly SubjectKind[] = ['character', 'location', 'faction', 'object']

/** The scene writing states, as a runtime list for validation. */
const SCENE_STATUSES: readonly SceneStatus[] = ['planned', 'writing', 'written']

/** The canon lorebook categories, as a runtime list for validation. */
const LORE_CATEGORIES: readonly LoreCategory[] = [
  'world', 'character', 'location', 'faction', 'item', 'event', 'system', 'instruction', 'note',
]

/** Run one mutation under a transaction, rolling back on any throw. */
function withTransaction(db: DatabaseSync, run: () => void): void {
  db.exec('BEGIN')
  try {
    run()
    db.exec('COMMIT')
  } catch (error: unknown) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Mint the next `prefix-N` id for one entity table (tables never delete). */
function nextId(
  db: DatabaseSync,
  table: 'subjects' | 'world_events' | 'vows' | 'decisions' | 'stories' | 'threads' | 'scenes' | 'lore_entries',
): string {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  const prefix = table === 'subjects'
    ? 'subject'
    : table === 'world_events'
      ? 'event'
      : table === 'vows'
        ? 'vow'
        : table === 'decisions'
          ? 'decision'
          : table === 'stories'
            ? 'story'
            : table === 'threads'
              ? 'thread'
              : table === 'scenes'
                ? 'scene'
                : 'lore'
  return `${prefix}-${n + 1}`
}

/**
 * The novel writing workspace service, published on `ctx.novel`.
 *
 * Ids are minted by the service (`subject-1`, `event-1`, `vow-1`,
 * `decision-1`) and stable for the life of the store: nothing is ever
 * deleted, so the count-based sequence never reuses an id. Field values in
 * world changes are plain text.
 */
export class NovelService extends Service {
  static Config: z<Config> = z.object({
    root: z.string().default('novel'),
  })

  /** The store's root directory (resolved). */
  readonly root: string
  /**
   * The authoritative SQLite connection. Read access exists for the invariant
   * companion and tests; mutations go through the service methods.
   */
  readonly db: DatabaseSync

  /**
   * Open (or create) the store under `config.root`.
   * @param ctx - Cordis context that owns the service.
   * @param config - plugin configuration (schema-validated).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'novel')
    this.root = resolve(config.root)
    this.db = openDatabase(join(this.root, 'state.sqlite'))
    // Close the medium with the owning fiber so dispose releases the store files.
    ctx.effect(() => () => { this.db.close() })
  }

  /**
   * Register a subject in the world engine.
   * @param input - kind, non-empty name, and optional summary.
   * @returns the stored subject.
   */
  createSubject(input: { kind: SubjectKind; name: string; summary?: string }): Subject {
    if (!SUBJECT_KINDS.includes(input.kind)) {
      throw new Error(`novel: unknown subject kind ${JSON.stringify(input.kind)}`)
    }
    const name = input.name.trim()
    if (name.length === 0) throw new Error('novel: subject name must be non-empty')
    const summary = input.summary?.trim() ?? ''
    const id = nextId(this.db, 'subjects') as SubjectId
    this.db.prepare('INSERT INTO subjects (id, kind, name, summary) VALUES (?, ?, ?, ?)')
      .run(id, input.kind, name, summary)
    return { id, kind: input.kind, name, summary }
  }

  /**
   * Every registered subject, in id order.
   * @returns the subjects.
   */
  listSubjects(): Subject[] {
    return (this.db.prepare('SELECT id, kind, name, summary FROM subjects ORDER BY id').all() as
      { id: string; kind: SubjectKind; name: string; summary: string }[])
      .map(row => ({ id: row.id as SubjectId, kind: row.kind, name: row.name, summary: row.summary }))
  }

  /**
   * Fetch one subject by id.
   * @param id - the subject id.
   * @returns the subject, or `undefined` when unknown.
   */
  getSubject(id: SubjectId): Subject | undefined {
    const row = this.db.prepare('SELECT id, kind, name, summary FROM subjects WHERE id = ?').get(id) as
      | { id: string; kind: SubjectKind; name: string; summary: string }
      | undefined
    if (row === undefined) return undefined
    return { id: row.id as SubjectId, kind: row.kind, name: row.name, summary: row.summary }
  }

  /**
   * Fold one subject's state at the latest recorded story time.
   * @param id - the subject id.
   * @returns the folded state, or `undefined` when the subject is unknown.
   */
  subjectState(id: SubjectId): SubjectState | undefined {
    return this.foldSubject(id, null)
  }

  /**
   * Fold one subject's state at a given story time.
   * @param id - the subject id.
   * @param at - the fold point; events strictly after it are ignored.
   * @returns the folded state, or `undefined` when the subject is unknown.
   */
  subjectStateAt(id: SubjectId, at: StoryTime): SubjectState | undefined {
    validateStoryTime(at)
    return this.foldSubject(id, serializeStoryTime(at))
  }

  /**
   * Fold one subject's state, applying every change at or before the bound.
   * @param id - the subject id.
   * @param bound - serialized story-time bound, or `null` for the latest.
   * @returns the folded state, or `undefined` when the subject is unknown.
   */
  private foldSubject(id: SubjectId, bound: string | null): SubjectState | undefined {
    const subject = this.getSubject(id)
    if (subject === undefined) return undefined
    const rows = (bound === null
      ? this.db.prepare(`
          SELECT c.field AS field, c.value AS value, e.story_time AS story_time
          FROM world_changes c JOIN world_events e ON e.seq = c.event_seq
          WHERE c.subject_id = ?
          ORDER BY e.story_time
        `).all(id)
      : this.db.prepare(`
          SELECT c.field AS field, c.value AS value, e.story_time AS story_time
          FROM world_changes c JOIN world_events e ON e.seq = c.event_seq
          WHERE c.subject_id = ? AND e.story_time <= ?
          ORDER BY e.story_time
        `).all(id, bound)) as ChangeRow[]
    const fields: Record<string, string> = {}
    let updatedAt: StoryTime | undefined
    for (const row of rows) {
      fields[row.field] = row.value
      updatedAt = parseStoryTime(row.story_time)
    }
    return { subject, fields, updatedAt: updatedAt ?? null }
  }

  /**
   * The whole world at the latest recorded story time.
   * @returns the fold point and every subject's state at it.
   */
  worldState(): WorldState {
    const at = this.latestStoryTime()
    const bound = at === null ? null : serializeStoryTime(at)
    const subjects = this.listSubjects().flatMap((subject) => {
      const state = this.foldSubject(subject.id, bound)
      // A listed subject always exists; foldSubject only returns undefined for
      // unknown ids, which the listing cannot contain.
      /* v8 ignore next -- unreachable through the public API: listSubjects only returns existing rows. */
      return state === undefined ? [] : [state]
    })
    return { at, subjects }
  }

  /**
   * The whole world at a given story time. Events strictly after the fold
   * point are ignored, so past states (and retroactively backfilled ones)
   * are queryable exactly as they were then.
   * @param at - the fold point.
   * @returns the fold point and every subject's state at it.
   */
  worldStateAt(at: StoryTime): WorldState {
    validateStoryTime(at)
    const bound = serializeStoryTime(at)
    const subjects = this.listSubjects().flatMap((subject) => {
      const state = this.foldSubject(subject.id, bound)
      // A listed subject always exists; foldSubject only returns undefined for
      // unknown ids, which the listing cannot contain.
      /* v8 ignore next -- unreachable through the public API: listSubjects only returns existing rows. */
      return state === undefined ? [] : [state]
    })
    return { at, subjects }
  }

  /**
   * Record one world event and its subject changes in one transaction. A
   * change references an existing subject and a non-empty field; each
   * (subject, field) pair may appear once per event.
   * @param input - story time, title, summary, and subject changes.
   * @returns the stored event.
   */
  recordWorldEvent(input: WorldEventInput): WorldEvent {
    validateStoryTime(input.storyTime)
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: world event title must be non-empty')
    const summary = input.summary?.trim() ?? ''
    const changes = input.changes ?? []
    const seen = new Set<string>()
    for (const change of changes) {
      if (change.field.trim().length === 0) {
        throw new Error('novel: world event change fields must be non-empty')
      }
      const key = `${change.subjectId}\u0000${change.field}`
      if (seen.has(key)) {
        throw new Error(
          `novel: world event repeats subject field ${JSON.stringify(change.subjectId)}:${JSON.stringify(change.field)}`,
        )
      }
      seen.add(key)
      if (this.getSubject(change.subjectId) === undefined) {
        throw new Error(`novel: world event references unknown subject ${JSON.stringify(change.subjectId)}`)
      }
    }
    const id = nextId(this.db, 'world_events') as WorldEventId
    let seq = 0
    withTransaction(this.db, () => {
      seq = Number(this.db.prepare(
        'INSERT INTO world_events (id, story_time, title, summary) VALUES (?, ?, ?, ?)',
      ).run(id, serializeStoryTime(input.storyTime), title, summary).lastInsertRowid)
      const insert = this.db.prepare(
        'INSERT INTO world_changes (event_seq, subject_id, field, value) VALUES (?, ?, ?, ?)',
      )
      for (const change of changes) {
        insert.run(seq, change.subjectId, change.field.trim(), change.value)
      }
    })
    return { id, storyTime: input.storyTime, title, summary }
  }

  /**
   * Every recorded world event, in story order.
   * @returns the events.
   */
  listWorldEvents(): WorldEvent[] {
    return (this.db.prepare(
      'SELECT seq, id, story_time, title, summary FROM world_events ORDER BY seq',
    ).all() as EventRow[])
      .map(row => ({
        id: row.id as WorldEventId,
        storyTime: parseStoryTime(row.story_time),
        title: row.title,
        summary: row.summary,
      }))
  }

  /**
   * Every recorded world event with the subject changes it applied, in story
   * order, optionally filtered to the events that touched one subject.
   * @param subjectId - optional subject filter.
   * @returns the event log entries.
   */
  listWorldHistory(subjectId?: SubjectId): WorldEventLogEntry[] {
    const rows = (subjectId === undefined
      ? this.db.prepare(
        'SELECT seq, id, story_time, title, summary FROM world_events ORDER BY seq',
      ).all()
      : this.db.prepare(`
          SELECT e.seq AS seq, e.id AS id, e.story_time AS story_time, e.title AS title, e.summary AS summary
          FROM world_events e
          WHERE EXISTS (SELECT 1 FROM world_changes c WHERE c.event_seq = e.seq AND c.subject_id = ?)
          ORDER BY e.seq
        `).all(subjectId)) as EventRow[]
    const changes = this.db.prepare(
      'SELECT subject_id, field, value FROM world_changes WHERE event_seq = ? ORDER BY subject_id, field',
    )
    return rows.map(row => ({
      id: row.id as WorldEventId,
      storyTime: parseStoryTime(row.story_time),
      title: row.title,
      summary: row.summary,
      changes: (changes.all(row.seq) as Array<{ subject_id: string; field: string; value: string }>)
        .map(change => ({
          subjectId: change.subject_id as SubjectId,
          field: change.field,
          value: change.value,
        })),
    }))
  }

  /**
   * The latest recorded story time.
   * @returns the story time of the most recent event, or `null` when no
   *   event exists.
   */
  latestStoryTime(): StoryTime | null {
    const row = this.db.prepare(
      'SELECT story_time FROM world_events ORDER BY story_time DESC LIMIT 1',
    ).get() as { story_time: string } | undefined
    return row === undefined ? null : parseStoryTime(row.story_time)
  }

  /**
   * Plant a plot vow.
   * @param input - title, promise, planting story time, and optional target
   *   and note.
   * @returns the planted vow.
   */
  plantVow(input: {
    title: string
    promise: string
    at: StoryTime
    payoffTarget?: string
    note?: string
  }): Vow {
    validateStoryTime(input.at)
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: vow title must be non-empty')
    const promise = input.promise.trim()
    if (promise.length === 0) throw new Error('novel: vow promise must be non-empty')
    const payoffTarget = input.payoffTarget?.trim() ?? ''
    const note = input.note?.trim() ?? ''
    const id = nextId(this.db, 'vows') as VowId
    withTransaction(this.db, () => {
      this.db.prepare(
        'INSERT INTO vows (id, title, promise, planted_at, status, payoff_target, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, title, promise, serializeStoryTime(input.at), 'planted', payoffTarget, note)
      this.db.prepare(
        'INSERT INTO vow_transitions (vow_id, seq, action, at_story, detail) VALUES (?, ?, ?, ?, ?)',
      ).run(id, 1, 'plant', serializeStoryTime(input.at), '')
    })
    return { id, title, promise, plantedAt: input.at, status: 'planted', payoffTarget, note }
  }

  /**
   * Advance a vow: tighten its promise, keeping it open.
   * @param id - the vow id.
   * @param input - the story time and a non-empty detail of the advance.
   * @returns the updated vow.
   */
  advanceVow(id: VowId, input: { at: StoryTime; detail: string }): Vow {
    return this.transition(id, 'advance', input, 'advanced')
  }

  /**
   * Pay a vow off: resolve it.
   * @param id - the vow id.
   * @param input - the story time and a non-empty detail of the payoff.
   * @returns the updated vow.
   */
  payOffVow(id: VowId, input: { at: StoryTime; detail: string }): Vow {
    return this.transition(id, 'payoff', input, 'paid_off')
  }

  /**
   * Abandon a vow: drop it without resolving.
   * @param id - the vow id.
   * @param input - the story time and a non-empty detail of the abandonment.
   * @returns the updated vow.
   */
  abandonVow(id: VowId, input: { at: StoryTime; detail: string }): Vow {
    return this.transition(id, 'abandon', input, 'abandoned')
  }

  /**
   * Apply one lifecycle transition to a vow.
   * @param id - the vow id.
   * @param action - the lifecycle action.
   * @param input - the story time and detail of the action.
   * @param nextStatus - the status the action moves the vow to.
   * @returns the updated vow.
   */
  private transition(
    id: VowId,
    action: 'advance' | 'payoff' | 'abandon',
    input: { at: StoryTime; detail: string },
    nextStatus: Exclude<VowStatus, 'planted'>,
  ): Vow {
    validateStoryTime(input.at)
    const detail = input.detail.trim()
    if (detail.length === 0) throw new Error(`novel: vow ${action} detail must be non-empty`)
    const current = this.vowRow(id)
    if (current === undefined) throw new Error(`novel: unknown vow ${JSON.stringify(id)}`)
    withTransaction(this.db, () => {
      if (current.status !== 'planted' && current.status !== 'advanced') {
        throw new Error(`novel: vow ${JSON.stringify(id)} is ${current.status} and cannot be ${action}d`)
      }
      const { n } = this.db.prepare(
        'SELECT COUNT(*) AS n FROM vow_transitions WHERE vow_id = ?',
      ).get(id) as { n: number }
      this.db.prepare(
        'INSERT INTO vow_transitions (vow_id, seq, action, at_story, detail) VALUES (?, ?, ?, ?, ?)',
      ).run(id, n + 1, action, serializeStoryTime(input.at), detail)
      this.db.prepare('UPDATE vows SET status = ? WHERE id = ?').run(nextStatus, id)
    })
    return this.toVow(this.vowRow(id) as VowRow)
  }

  /**
   * List vows, optionally filtered by status, oldest planted first.
   * @param filter - optional status filter.
   * @returns each vow with its full transition history.
   */
  listVows(filter: { status?: VowStatus } = {}): VowLedger[] {
    const rows = (filter.status === undefined
      ? this.db.prepare(
        'SELECT id, title, promise, planted_at, status, payoff_target, note FROM vows ORDER BY planted_at, id',
      ).all()
      : this.db.prepare(
        'SELECT id, title, promise, planted_at, status, payoff_target, note FROM vows WHERE status = ? ORDER BY planted_at, id',
      ).all(filter.status)) as VowRow[]
    const transitions = this.db.prepare(
      'SELECT action, at_story, detail FROM vow_transitions WHERE vow_id = ? ORDER BY seq',
    )
    return rows.map(row => ({
      vow: this.toVow(row),
      transitions: (transitions.all(row.id) as TransitionRow[]).map(transition => ({
        action: transition.action as VowTransition['action'],
        at: parseStoryTime(transition.at_story),
        detail: transition.detail,
      })),
    }))
  }

  /**
   * Record a creative decision.
   * @param input - the context and at least one non-empty, unique option.
   * @returns the stored decision, open.
   */
  recordDecision(input: { context: string; options: DecisionOption[] }): Decision {
    const context = input.context.trim()
    if (context.length === 0) throw new Error('novel: decision context must be non-empty')
    const options = normalizeOptions(input.options)
    const id = nextId(this.db, 'decisions') as DecisionId
    const createdAt = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO decisions (id, created_at, context, options, chosen, rationale, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, createdAt, context, JSON.stringify(options), null, '', 'open')
    return { id, createdAt, context, options, chosen: null, rationale: '', status: 'open' }
  }

  /**
   * Close an open decision by choosing one of its options.
   * @param id - the decision id.
   * @param input - the chosen option label and an optional rationale.
   * @returns the updated decision.
   */
  decide(id: DecisionId, input: { chosen: string; rationale?: string }): Decision {
    const current = this.decisionRow(id)
    if (current === undefined) throw new Error(`novel: unknown decision ${JSON.stringify(id)}`)
    if (current.status !== 'open') {
      throw new Error(`novel: decision ${JSON.stringify(id)} is already ${current.status}`)
    }
    const chosen = input.chosen.trim()
    const options = JSON.parse(current.options) as DecisionOption[]
    if (!options.some(option => option.label === chosen)) {
      throw new Error(`novel: decision ${JSON.stringify(id)} has no option ${JSON.stringify(chosen)}`)
    }
    const rationale = input.rationale?.trim() ?? ''
    this.db.prepare('UPDATE decisions SET status = ?, chosen = ?, rationale = ? WHERE id = ?')
      .run('decided', chosen, rationale, id)
    return this.toDecision(this.decisionRow(id) as DecisionRow)
  }

  /**
   * Every recorded decision, newest recorded first.
   * @returns the decisions.
   */
  listDecisions(): Decision[] {
    return (this.db.prepare(
      'SELECT id, created_at, context, options, chosen, rationale, status FROM decisions ORDER BY created_at DESC, id DESC',
    ).all() as DecisionRow[]).map(row => this.toDecision(row))
  }

  /**
   * Insert a chapter or update the knowledge-control fields of an existing
   * one. Omitted knowledge fields keep their previous values on update.
   * @param input - the chapter number, title, and knowledge fields.
   * @returns the stored chapter.
   */
  upsertChapter(input: ChapterInput): ChapterInfo {
    if (!Number.isInteger(input.number) || input.number <= 0) {
      throw new Error('novel: chapter number must be a positive integer')
    }
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: chapter title must be non-empty')
    const current = this.getChapter(input.number)
    const readerKnows = input.readerKnows === undefined ? (current?.readerKnows ?? '') : input.readerKnows.trim()
    const protagonistKnows = input.protagonistKnows === undefined
      ? (current?.protagonistKnows ?? '')
      : input.protagonistKnows.trim()
    const mustConceal = input.mustConceal === undefined ? (current?.mustConceal ?? '') : input.mustConceal.trim()
    const mayHint = input.mayHint === undefined ? (current?.mayHint ?? '') : input.mayHint.trim()
    this.db.prepare(`
      INSERT INTO chapters (number, title, reader_knows, protagonist_knows, must_conceal, may_hint)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET
        title = excluded.title,
        reader_knows = excluded.reader_knows,
        protagonist_knows = excluded.protagonist_knows,
        must_conceal = excluded.must_conceal,
        may_hint = excluded.may_hint
    `).run(
      input.number,
      title,
      readerKnows,
      protagonistKnows,
      mustConceal,
      mayHint,
    )
    return this.getChapter(input.number) as ChapterInfo
  }

  /**
   * Fetch one chapter by number.
   * @param number - the chapter number.
   * @returns the stored chapter, or `undefined` when unknown.
   */
  getChapter(number: number): ChapterInfo | undefined {
    const row = this.db.prepare(
      'SELECT number, title, reader_knows, protagonist_knows, must_conceal, may_hint FROM chapters WHERE number = ?',
    ).get(number) as {
      number: number
      title: string
      reader_knows: string
      protagonist_knows: string
      must_conceal: string
      may_hint: string
    } | undefined
    return row === undefined ? undefined : {
      number: row.number,
      title: row.title,
      readerKnows: row.reader_knows,
      protagonistKnows: row.protagonist_knows,
      mustConceal: row.must_conceal,
      mayHint: row.may_hint,
    }
  }

  /**
   * Every stored chapter, in number order.
   * @returns the chapters.
   */
  listChapters(): ChapterInfo[] {
    const rows = this.db.prepare(
      'SELECT number, title, reader_knows, protagonist_knows, must_conceal, may_hint FROM chapters ORDER BY number',
    ).all() as {
      number: number
      title: string
      reader_knows: string
      protagonist_knows: string
      must_conceal: string
      may_hint: string
    }[]
    return rows.map(row => ({
      number: row.number,
      title: row.title,
      readerKnows: row.reader_knows,
      protagonistKnows: row.protagonist_knows,
      mustConceal: row.must_conceal,
      mayHint: row.may_hint,
    }))
  }

  /**
   * Write the Markdown exports under the store root: `world-engine/`,
   * `plot/`, `decisions/`, and `chapters/` documents, all deterministic.
   * @returns the absolute paths written.
   */
  async exportMarkdown(): Promise<string[]> {
    const targets: [string, string][] = [
      [join(this.root, 'world-engine', 'subjects.md'), renderSubjects(this.listSubjects())],
      [join(this.root, 'world-engine', 'events.md'), renderEvents(this.listWorldEvents())],
      [join(this.root, 'world-engine', 'state.md'), renderState(this.worldState())],
      [join(this.root, 'plot', 'vows.md'), renderVows(this.listVows())],
      [join(this.root, 'decisions', 'decisions.md'), renderDecisions(this.listDecisions())],
      [join(this.root, 'chapters', 'chapters.md'), renderChapters(this.listChapters())],
      [join(this.root, 'manuscript', 'manuscript.md'), renderManuscript(this.listManuscript())],
    ]
    for (const [path, content] of targets) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    }
    return targets.map(([path]) => path)
  }

  /**
   * Create one plot story (the causal spine threads belong to).
   * @param input - title and optional summary.
   * @returns the created story.
   */
  createStory(input: { title: string; summary?: string }): Story {
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: story title must be non-empty')
    const summary = input.summary?.trim() ?? ''
    const id = nextId(this.db, 'stories') as StoryId
    this.db.prepare('INSERT INTO stories (id, title, summary) VALUES (?, ?, ?)').run(id, title, summary)
    return { id, title, summary }
  }

  /**
   * Every plot story in id order.
   * @returns the stories.
   */
  listStories(): Story[] {
    return (this.db.prepare('SELECT id, title, summary FROM stories ORDER BY id').all() as StoryRow[])
      .map(row => ({ id: row.id as StoryId, title: row.title, summary: row.summary }))
  }

  /** Fetch one plot story by id. */
  getStory(id: StoryId): Story | undefined {
    const row = this.db.prepare('SELECT id, title, summary FROM stories WHERE id = ?').get(id) as StoryRow | undefined
    return row === undefined ? undefined : { id: row.id as StoryId, title: row.title, summary: row.summary }
  }

  /**
   * Create one plot thread inside a story.
   * @param input - owning story, title, and optional summary and position.
   * @returns the created thread.
   */
  createThread(input: { storyId: StoryId; title: string; summary?: string; position?: number }): StoryThread {
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: thread title must be non-empty')
    if (this.getStory(input.storyId) === undefined) {
      throw new Error(`novel: unknown story ${JSON.stringify(input.storyId)}`)
    }
    const summary = input.summary?.trim() ?? ''
    const position = input.position ?? 0
    const id = nextId(this.db, 'threads') as ThreadId
    this.db.prepare(
      'INSERT INTO threads (id, story_id, title, summary, position) VALUES (?, ?, ?, ?, ?)',
    ).run(id, input.storyId, title, summary, position)
    return { id, storyId: input.storyId, title, summary, position }
  }

  /**
   * Every plot thread, optionally filtered by story, in id order.
   * @param storyId - optional story filter.
   * @returns the threads.
   */
  listThreads(storyId?: StoryId): StoryThread[] {
    const rows = (storyId === undefined
      ? this.db.prepare('SELECT id, story_id, title, summary, position FROM threads ORDER BY id').all()
      : this.db.prepare('SELECT id, story_id, title, summary, position FROM threads WHERE story_id = ? ORDER BY id').all(storyId)) as ThreadRow[]
    return rows.map(row => ({
      id: row.id as ThreadId,
      storyId: row.story_id as StoryId,
      title: row.title,
      summary: row.summary,
      position: row.position,
    }))
  }

  /** Fetch one plot thread by id. */
  getThread(id: ThreadId): StoryThread | undefined {
    const row = this.db.prepare(
      'SELECT id, story_id, title, summary, position FROM threads WHERE id = ?',
    ).get(id) as ThreadRow | undefined
    return row === undefined ? undefined : {
      id: row.id as ThreadId,
      storyId: row.story_id as StoryId,
      title: row.title,
      summary: row.summary,
      position: row.position,
    }
  }

  /**
   * Create one plot scene inside a thread.
   * @param input - owning thread, title, and optional anchor, summary,
   *   location, subjects, vows, position, and status.
   * @returns the created scene.
   */
  createScene(input: SceneInput): Scene {
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: scene title must be non-empty')
    if (this.getThread(input.threadId) === undefined) {
      throw new Error(`novel: unknown thread ${JSON.stringify(input.threadId)}`)
    }
    const at = input.at ?? null
    if (at !== null) validateStoryTime(at)
    const subjectIds = input.subjectIds ?? []
    const vowIds = input.vowIds ?? []
    this.validateSceneReferences(subjectIds, vowIds)
    const status = input.status ?? 'planned'
    if (!SCENE_STATUSES.includes(status)) {
      throw new Error(`novel: unknown scene status ${JSON.stringify(status)}`)
    }
    const id = nextId(this.db, 'scenes') as SceneId
    this.db.prepare(`
      INSERT INTO scenes (id, thread_id, title, summary, at_story, location, subject_ids, vow_ids, position, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.threadId, title, input.summary?.trim() ?? '', at === null ? null : serializeStoryTime(at),
      input.location?.trim() ?? '', JSON.stringify(subjectIds), JSON.stringify(vowIds),
      input.position ?? 0, status,
    )
    /* v8 ignore next -- the insert just succeeded, so the scene exists. */
    return this.getScene(id)!
  }

  /**
   * Every plot scene, optionally filtered by thread, in id order.
   * @param threadId - optional thread filter.
   * @returns the scenes.
   */
  listScenes(threadId?: ThreadId): Scene[] {
    const rows = (threadId === undefined
      ? this.db.prepare('SELECT id, thread_id, title, summary, at_story, location, subject_ids, vow_ids, position, status FROM scenes ORDER BY id').all()
      : this.db.prepare('SELECT id, thread_id, title, summary, at_story, location, subject_ids, vow_ids, position, status FROM scenes WHERE thread_id = ? ORDER BY id').all(threadId)) as SceneRow[]
    return rows.map(row => this.toScene(row))
  }

  /** Fetch one plot scene by id. */
  getScene(id: SceneId): Scene | undefined {
    const row = this.db.prepare(
      'SELECT id, thread_id, title, summary, at_story, location, subject_ids, vow_ids, position, status FROM scenes WHERE id = ?',
    ).get(id) as SceneRow | undefined
    return row === undefined ? undefined : this.toScene(row)
  }

  /**
   * Update one plot scene. Every patch field is optional; story-time
   * anchoring, subject and vow lists are revalidated on write.
   * @param id - the scene to update.
   * @param patch - the fields to replace.
   * @returns the updated scene.
   */
  updateScene(id: SceneId, patch: ScenePatch): Scene {
    const current = this.getScene(id)
    if (current === undefined) throw new Error(`novel: unknown scene ${JSON.stringify(id)}`)
    const title = (patch.title ?? current.title).trim()
    if (title.length === 0) throw new Error('novel: scene title must be non-empty')
    const at = patch.at === undefined ? current.at : patch.at
    if (at !== null) validateStoryTime(at)
    const subjectIds = patch.subjectIds ?? current.subjectIds
    const vowIds = patch.vowIds ?? current.vowIds
    this.validateSceneReferences(subjectIds, vowIds)
    const status = patch.status ?? current.status
    if (!SCENE_STATUSES.includes(status)) {
      throw new Error(`novel: unknown scene status ${JSON.stringify(status)}`)
    }
    this.db.prepare(`
      UPDATE scenes
      SET title = ?, summary = ?, at_story = ?, location = ?, subject_ids = ?, vow_ids = ?, position = ?, status = ?
      WHERE id = ?
    `).run(
      title,
      (patch.summary ?? current.summary).trim(),
      at === null ? null : serializeStoryTime(at),
      (patch.location ?? current.location).trim(),
      JSON.stringify(subjectIds),
      JSON.stringify(vowIds),
      patch.position ?? current.position,
      status,
      id,
    )
    /* v8 ignore next -- the update just succeeded, so the scene exists. */
    return this.getScene(id)!
  }

  /**
   * The plot tree in one read: stories with their threads and scenes.
   * @returns the tree.
   */
  listPlot(): PlotTree {
    const stories = this.listStories().map((story) => {
      const threads = this.listThreads(story.id).map(thread => ({
        thread,
        scenes: this.listScenes(thread.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      }))
      return { story, threads }
    })
    return { stories }
  }

  /** Validate that every referenced subject and vow exists. */
  private validateSceneReferences(subjectIds: readonly SubjectId[], vowIds: readonly VowId[]): void {
    for (const subjectId of subjectIds) {
      if (this.getSubject(subjectId) === undefined) {
        throw new Error(`novel: unknown subject ${JSON.stringify(subjectId)}`)
      }
    }
    for (const vowId of vowIds) {
      if (this.vowRow(vowId) === undefined) {
        throw new Error(`novel: unknown vow ${JSON.stringify(vowId)}`)
      }
    }
  }

  /** Map one scene row to its public value. */
  private toScene(row: SceneRow): Scene {
    return {
      id: row.id as SceneId,
      threadId: row.thread_id as ThreadId,
      title: row.title,
      summary: row.summary,
      at: row.at_story === null ? null : parseStoryTime(row.at_story),
      location: row.location,
      subjectIds: JSON.parse(row.subject_ids) as SubjectId[],
      vowIds: JSON.parse(row.vow_ids) as VowId[],
      position: row.position,
      status: row.status as SceneStatus,
    }
  }

  /**
   * Register one canon lorebook entry, or update it when `id` is present.
   * Omniscient entries are canon known to everyone; character-scoped entries
   * (omniscient false) require a subject and are exposed through that
   * subject's knowledge context only.
   * @param input - the entry to register.
   * @returns the stored entry.
   */
  registerLore(input: LoreInput): LoreEntry {
    const category = input.category
    if (!LORE_CATEGORIES.includes(category)) {
      throw new Error(`novel: unknown lore category ${JSON.stringify(category)}`)
    }
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: lore title must be non-empty')
    const content = input.content.trim()
    if (content.length === 0) throw new Error('novel: lore content must be non-empty')
    if (input.id !== undefined) {
      const current = this.getLore(input.id)
      if (current === undefined) {
        throw new Error(`novel: unknown lore ${JSON.stringify(input.id)}`)
      }
      const omniscient = input.omniscient ?? current.omniscient
      const subjectId = input.subjectId === undefined ? current.subjectId : input.subjectId
      this.validateLoreScoping(omniscient, subjectId)
      this.db.prepare(`
        UPDATE lore_entries SET category = ?, title = ?, content = ?, omniscient = ?, subject_id = ? WHERE id = ?
      `).run(category, title, content, omniscient ? 1 : 0, subjectId, input.id)
      /* v8 ignore next -- the update just succeeded, so the entry exists. */
      return this.getLore(input.id)!
    }
    const omniscient = input.omniscient ?? true
    const subjectId = input.subjectId ?? null
    this.validateLoreScoping(omniscient, subjectId)
    const id = nextId(this.db, 'lore_entries') as LoreId
    this.db.prepare(`
      INSERT INTO lore_entries (id, category, title, content, omniscient, subject_id) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, category, title, content, omniscient ? 1 : 0, subjectId)
    /* v8 ignore next -- the insert just succeeded, so the entry exists. */
    return this.getLore(id)!
  }

  /** Validate the knowledge-layer scoping rules of one lore entry. */
  private validateLoreScoping(omniscient: boolean, subjectId: SubjectId | null): void {
    if (omniscient && subjectId !== null) {
      throw new Error('novel: omniscient lore cannot be scoped to a subject')
    }
    if (!omniscient && subjectId === null) {
      throw new Error('novel: character-scoped lore requires a subject')
    }
    if (subjectId !== null && this.getSubject(subjectId) === undefined) {
      throw new Error(`novel: unknown subject ${JSON.stringify(subjectId)}`)
    }
  }

  /**
   * Every canon lorebook entry, optionally filtered by category, subject, or
   * knowledge layer, in id order.
   * @param filter - optional category, subject, and omniscient filters.
   * @returns the entries.
   */
  listLore(filter: { category?: LoreCategory; subjectId?: SubjectId; omniscient?: boolean } = {}): LoreEntry[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.category !== undefined) {
      where.push('category = ?')
      params.push(filter.category)
    }
    if (filter.subjectId !== undefined) {
      where.push('subject_id = ?')
      params.push(filter.subjectId)
    }
    if (filter.omniscient !== undefined) {
      where.push('omniscient = ?')
      params.push(filter.omniscient ? 1 : 0)
    }
    const sql = 'SELECT id, category, title, content, omniscient, subject_id FROM lore_entries'
      + (where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`)
      + ' ORDER BY id'
    return (this.db.prepare(sql).all(...params) as LoreRow[]).map(row => this.toLore(row))
  }

  /** Fetch one canon lorebook entry by id. */
  getLore(id: LoreId): LoreEntry | undefined {
    const row = this.db.prepare(
      'SELECT id, category, title, content, omniscient, subject_id FROM lore_entries WHERE id = ?',
    ).get(id) as LoreRow | undefined
    return row === undefined ? undefined : this.toLore(row)
  }

  /**
   * The knowledge-layer context of one subject: the omniscient canon plus the
   * entries scoped to that subject. With no subject, only the omniscient canon
   * is returned.
   * @param subjectId - optional subject whose knowledge is exposed.
   * @returns the omniscient and subject-scoped entries.
   */
  loreContext(subjectId?: SubjectId): LoreContext {
    let subject: Subject | null = null
    if (subjectId !== undefined) {
      subject = this.getSubject(subjectId) ?? null
      if (subject === null) {
        throw new Error(`novel: unknown subject ${JSON.stringify(subjectId)}`)
      }
    }
    const omniscient = (this.db.prepare(
      'SELECT id, category, title, content, omniscient, subject_id FROM lore_entries WHERE omniscient = 1 ORDER BY id',
    ).all() as LoreRow[]).map(row => this.toLore(row))
    const scoped = subjectId === undefined ? [] : (this.db.prepare(
      'SELECT id, category, title, content, omniscient, subject_id FROM lore_entries WHERE subject_id = ? ORDER BY id',
    ).all(subjectId) as LoreRow[]).map(row => this.toLore(row))
    return { subject, omniscient, scoped }
  }

  /** Map one lore row to its public value. */
  private toLore(row: LoreRow): LoreEntry {
    return {
      id: row.id as LoreId,
      category: row.category as LoreCategory,
      title: row.title,
      content: row.content,
      omniscient: row.omniscient === 1,
      subjectId: row.subject_id as SubjectId | null,
    }
  }

  /**
   * Upsert one chapter's prose draft in the manuscript ledger. The chapter
   * number is the stable key; omitted fields keep their previous values.
   * @param input - the chapter number, title, and optional content.
   * @returns the stored manuscript entry.
   */
  writeManuscript(input: ManuscriptInput): Manuscript {
    const title = input.title.trim()
    if (title.length === 0) throw new Error('novel: manuscript title must be non-empty')
    const current = this.readManuscript(input.number)
    const content = (input.content ?? current?.content ?? '').trim()
    const updatedAt = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO manuscript (number, title, content, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET title = excluded.title, content = excluded.content, updated_at = excluded.updated_at
    `).run(input.number, title, content, updatedAt)
    /* v8 ignore next -- the upsert just succeeded, so the row exists. */
    return this.readManuscript(input.number)!
  }

  /** Fetch one chapter's prose draft by chapter number. */
  readManuscript(number: number): Manuscript | undefined {
    const row = this.db.prepare(
      'SELECT number, title, content, updated_at FROM manuscript WHERE number = ?',
    ).get(number) as ManuscriptRow | undefined
    return row === undefined ? undefined : this.toManuscript(row)
  }

  /** Every manuscript entry in chapter order. */
  listManuscript(): Manuscript[] {
    return (this.db.prepare(
      'SELECT number, title, content, updated_at FROM manuscript ORDER BY number',
    ).all() as ManuscriptRow[]).map(row => this.toManuscript(row))
  }

  /** Map one manuscript row to its public value. */
  private toManuscript(row: ManuscriptRow): Manuscript {
    return {
      number: row.number,
      title: row.title,
      content: row.content,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Check the store's durable consistency: orphan rows, unparsable story
   * times, and payoffs without a recorded payoff transition.
   * @returns the integrity report.
   */
  checkIntegrity(): IntegrityReport {
    const orphanChanges =
      this.orphanCount('world_changes', 'world_events', 'event_seq', 'seq')
      + this.orphanCount('world_changes', 'subjects', 'subject_id', 'id')
    const orphanTransitions = this.orphanCount('vow_transitions', 'vows', 'vow_id', 'id')
    const unparsableStoryTimes: string[] = []
    const collect = (serialized: string): void => {
      try {
        parseStoryTime(serialized)
      } catch {
        unparsableStoryTimes.push(serialized)
      }
    }
    for (const row of this.db.prepare('SELECT story_time FROM world_events').all() as { story_time: string }[]) {
      collect(row.story_time)
    }
    for (const row of this.db.prepare('SELECT planted_at FROM vows').all() as { planted_at: string }[]) {
      collect(row.planted_at)
    }
    for (const row of this.db.prepare('SELECT at_story FROM vow_transitions').all() as { at_story: string }[]) {
      collect(row.at_story)
    }
    const payoffWithoutTransition = (this.db.prepare(`
      SELECT id FROM vows
      WHERE status = 'paid_off'
        AND NOT EXISTS (SELECT 1 FROM vow_transitions WHERE vow_id = vows.id AND action = 'payoff')
      ORDER BY id
    `).all() as { id: string }[]).map(row => row.id)
    const unparsableSceneLists: string[] = []
    for (const row of this.db.prepare(
      'SELECT id, at_story, subject_ids, vow_ids FROM scenes',
    ).all() as { id: string; at_story: string | null; subject_ids: string; vow_ids: string }[]) {
      if (row.at_story !== null) collect(row.at_story)
      for (const list of [row.subject_ids, row.vow_ids]) {
        try {
          JSON.parse(list)
        } catch {
          unparsableSceneLists.push(row.id)
        }
      }
    }
    return {
      orphanChanges,
      orphanTransitions,
      unparsableStoryTimes,
      payoffWithoutTransition,
      unparsableSceneLists,
    }
  }

  /** Count child rows whose referenced parent row is gone. */
  private orphanCount(child: string, parent: string, childKey: string, parentKey: string): number {
    const { n } = this.db.prepare(
      `SELECT COUNT(*) AS n FROM ${child} WHERE NOT EXISTS (SELECT 1 FROM ${parent} WHERE ${parent}.${parentKey} = ${child}.${childKey})`,
    ).get() as { n: number }
    return n
  }

  /** Fetch one vow row, or `undefined` when unknown. */
  private vowRow(id: VowId): VowRow | undefined {
    return this.db.prepare(
      'SELECT id, title, promise, planted_at, status, payoff_target, note FROM vows WHERE id = ?',
    ).get(id) as VowRow | undefined
  }

  /** Map one vow row to its public value. */
  private toVow(row: VowRow): Vow {
    return {
      id: row.id as VowId,
      title: row.title,
      promise: row.promise,
      plantedAt: parseStoryTime(row.planted_at),
      status: row.status as VowStatus,
      payoffTarget: row.payoff_target,
      note: row.note,
    }
  }

  /** Fetch one decision row, or `undefined` when unknown. */
  private decisionRow(id: DecisionId): DecisionRow | undefined {
    return this.db.prepare(
      'SELECT id, created_at, context, options, chosen, rationale, status FROM decisions WHERE id = ?',
    ).get(id) as DecisionRow | undefined
  }

  /** Map one decision row to its public value. */
  private toDecision(row: DecisionRow): Decision {
    return {
      id: row.id as DecisionId,
      createdAt: row.created_at,
      context: row.context,
      options: JSON.parse(row.options) as DecisionOption[],
      chosen: row.chosen,
      rationale: row.rationale,
      status: row.status as Decision['status'],
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The novel writing workspace service. */
    novel: NovelService
  }
}

/** Validate and normalize a decision's option list. */
function normalizeOptions(options: readonly DecisionOption[]): DecisionOption[] {
  if (options.length === 0) throw new Error('novel: decision needs at least one option')
  const seen = new Set<string>()
  return options.map((option) => {
    const label = option.label.trim()
    if (label.length === 0) throw new Error('novel: decision option labels must be non-empty')
    if (seen.has(label)) throw new Error(`novel: decision repeats option label ${JSON.stringify(label)}`)
    seen.add(label)
    return { label, pros: option.pros.trim(), cons: option.cons.trim() }
  })
}

export default NovelService
