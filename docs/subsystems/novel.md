# Novel workspace service

English | [中文](novel.zh.md)

The long-fiction continuity store: a world engine, plot vow ledger, creative decisions, and chapter knowledge control, owned by the host session and durably stored in SQLite with markdown export. The `ctx.novel` service (`NovelService`) lives in [`@deepseek-ai/dsh-novel`](../../packages/novel/novel/README.md); the 12 model-facing tools are [`dsh-novel-tools`](../../packages/novel/novel-tools/README.md). This page records the exact domain types from [`packages/novel/novel/src/types.ts`](../../packages/novel/novel/src/types.ts).

## Story time

A `StoryTime` is a position on the story's own timeline, independent of wall clock. Months and days are 1-based but the calendar is not validated. The service serializes it to a fixed-width, lexicographically sortable `YYYYYY.MM.DD` form (offset-encoded year); tools and exports use the readable `±YYYY.MM.DD` display form.

```ts type-equiv
/** A position on the story's internal timeline. Months and days are 1-based;
 *  the calendar is not validated (month 13 and day 32 are legal positions). */
interface StoryTime {
  /** Calendar year, negative before the story's epoch zero. */
  readonly year: number
  /** 1-based month. */
  readonly month: number
  /** 1-based day. */
  readonly day: number
}
```

## World engine

The world engine tracks subjects and folds their state over the story timeline, last write per field winning.

```ts type-equiv
/** One entity the world engine tracks. */
interface Subject {
  /** Service-minted stable identifier. */
  readonly id: SubjectId
  /** The subject's kind. */
  readonly kind: SubjectKind
  /** Non-empty display name. */
  readonly name: string
  /** Free-form baseline summary; world events override it through changes. */
  readonly summary: string
}
```

```ts type-equiv
/** One recorded point on the story timeline. */
interface WorldEvent {
  /** Service-minted stable identifier. */
  readonly id: WorldEventId
  /** Position of the event on the story timeline. */
  readonly storyTime: StoryTime
  /** Non-empty event title. */
  readonly title: string
  /** Free-form event description. */
  readonly summary: string
}
```

A `WorldEvent` may carry `WorldChangeInput` entries that overwrite subject fields (`summary`, `alive`, `location`, `relationship:<id>`, ...). `WorldState` is the whole world at one fold point, with `at` null before any event.

## Plot vow ledger

```ts type-equiv
/** One plot vow (a promise the story makes to the reader). */
interface Vow {
  /** Service-minted stable identifier. */
  readonly id: VowId
  /** Short display name. */
  readonly title: string
  /** What the story promised, in reader-visible terms. */
  readonly promise: string
  /** Story time the vow was planted. */
  readonly plantedAt: StoryTime
  /** Current lifecycle status. */
  readonly status: VowStatus
  /** Where the vow is expected to resolve (a chapter, an arc, a beat), or
   *  an empty string when unspecified. */
  readonly payoffTarget: string
  /** Free-form keeper notes. */
  readonly note: string
}
```

`VowLedger` pairs a vow with every `VowTransition` (action `plant`/`advance`/`payoff`/`abandon`, story time, and detail), oldest first.

## Creative decisions

```ts type-equiv
/** A recorded creative decision (an architecture-decision record for prose). */
interface Decision {
  /** Service-minted stable identifier. */
  readonly id: DecisionId
  /** Wall-clock ISO timestamp of the record. */
  readonly createdAt: string
  /** What prompted the decision. */
  readonly context: string
  /** The options that were weighed. */
  readonly options: readonly DecisionOption[]
  /** The chosen option label, or `null` while the decision stays open. */
  readonly chosen: string | null
  /** The rationale for the choice, or an empty string while open. */
  readonly rationale: string
  /** Whether a choice has been made. */
  readonly status: 'open' | 'decided'
}
```

## Chapter knowledge control

```ts type-equiv
/** The knowledge-control ledger for one chapter. */
interface ChapterInfo {
  /** 1-based chapter number. */
  readonly number: number
  /** Non-empty chapter title. */
  readonly title: string
  /** What the reader learns in this chapter. */
  readonly readerKnows: string
  /** What the protagonist learns in this chapter. */
  readonly protagonistKnows: string
  /** What this chapter must keep concealed. */
  readonly mustConceal: string
  /** What this chapter may hint at without revealing. */
  readonly mayHint: string
}
```

## Durable consistency

`IntegrityReport` carries the store's runtime audit: orphaned `world_changes`/`vow_transitions` rows, story times that no longer parse, and vows marked `paid_off` without a payoff transition.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxnovel--novelservice"></a>

### `ctx.novel` — `NovelService`

The novel writing workspace service, published on `ctx.novel`.

Ids are minted by the service (`subject-1`, `event-1`, `vow-1`, `decision-1`) and stable for the life of the store: nothing is ever deleted, so the count-based sequence never reuses an id. Field values in world changes are plain text.

```ts cordis-catalog
/**
 * Register a subject in the world engine.
 * @param input - kind, non-empty name, and optional summary.
 * @returns the stored subject.
 */
createSubject(input: { kind: SubjectKind; name: string; summary?: string }): Subject

/**
 * Every registered subject, in id order.
 * @returns the subjects.
 */
listSubjects(): Subject[]

/**
 * Fetch one subject by id.
 * @param id - the subject id.
 * @returns the subject, or `undefined` when unknown.
 */
getSubject(id: SubjectId): Subject | undefined

/**
 * Fold one subject's state at the latest recorded story time.
 * @param id - the subject id.
 * @returns the folded state, or `undefined` when the subject is unknown.
 */
subjectState(id: SubjectId): SubjectState | undefined

/**
 * Fold one subject's state at a given story time.
 * @param id - the subject id.
 * @param at - the fold point; events strictly after it are ignored.
 * @returns the folded state, or `undefined` when the subject is unknown.
 */
subjectStateAt(id: SubjectId, at: StoryTime): SubjectState | undefined

/**
 * The whole world at the latest recorded story time.
 * @returns the fold point and every subject's state at it.
 */
worldState(): WorldState

/**
 * Record one world event and its subject changes in one transaction. A
 * change references an existing subject and a non-empty field; each
 * (subject, field) pair may appear once per event.
 * @param input - story time, title, summary, and subject changes.
 * @returns the stored event.
 */
recordWorldEvent(input: WorldEventInput): WorldEvent

/**
 * Every recorded world event, in story order.
 * @returns the events.
 */
listWorldEvents(): WorldEvent[]

/**
 * The latest recorded story time.
 * @returns the story time of the most recent event, or `null` when no
 *   event exists.
 */
latestStoryTime(): StoryTime | null

/**
 * Plant a plot vow.
 * @param input - title, promise, planting story time, and optional target
 *   and note.
 * @returns the planted vow.
 */
plantVow(input: { title: string promise: string at: StoryTime payoffTarget?: string note?: string }): Vow

/**
 * Advance a vow: tighten its promise, keeping it open.
 * @param id - the vow id.
 * @param input - the story time and a non-empty detail of the advance.
 * @returns the updated vow.
 */
advanceVow(id: VowId, input: { at: StoryTime; detail: string }): Vow

/**
 * Pay a vow off: resolve it.
 * @param id - the vow id.
 * @param input - the story time and a non-empty detail of the payoff.
 * @returns the updated vow.
 */
payOffVow(id: VowId, input: { at: StoryTime; detail: string }): Vow

/**
 * Abandon a vow: drop it without resolving.
 * @param id - the vow id.
 * @param input - the story time and a non-empty detail of the abandonment.
 * @returns the updated vow.
 */
abandonVow(id: VowId, input: { at: StoryTime; detail: string }): Vow

/**
 * List vows, optionally filtered by status, oldest planted first.
 * @param filter - optional status filter.
 * @returns each vow with its full transition history.
 */
listVows(filter: { status?: VowStatus } = {}): VowLedger[]

/**
 * Record a creative decision.
 * @param input - the context and at least one non-empty, unique option.
 * @returns the stored decision, open.
 */
recordDecision(input: { context: string; options: DecisionOption[] }): Decision

/**
 * Close an open decision by choosing one of its options.
 * @param id - the decision id.
 * @param input - the chosen option label and an optional rationale.
 * @returns the updated decision.
 */
decide(id: DecisionId, input: { chosen: string; rationale?: string }): Decision

/**
 * Every recorded decision, newest recorded first.
 * @returns the decisions.
 */
listDecisions(): Decision[]

/**
 * Insert a chapter or update the knowledge-control fields of an existing
 * one. Omitted knowledge fields keep their previous values on update.
 * @param input - the chapter number, title, and knowledge fields.
 * @returns the stored chapter.
 */
upsertChapter(input: ChapterInput): ChapterInfo

/**
 * Fetch one chapter by number.
 * @param number - the chapter number.
 * @returns the stored chapter, or `undefined` when unknown.
 */
getChapter(number: number): ChapterInfo | undefined

/**
 * Every stored chapter, in number order.
 * @returns the chapters.
 */
listChapters(): ChapterInfo[]

/**
 * Write the Markdown exports under the store root: `world-engine/`,
 * `plot/`, `decisions/`, and `chapters/` documents, all deterministic.
 * @returns the absolute paths written.
 */
async exportMarkdown(): Promise<string[]>

/**
 * Check the store's durable consistency: orphan rows, unparsable story
 * times, and payoffs without a recorded payoff transition.
 * @returns the integrity report.
 */
checkIntegrity(): IntegrityReport
```

Source: [`packages/novel/novel/src/index.ts:127`](../../packages/novel/novel/src/index.ts)
<!-- END GENERATED cordis-surface -->
