/**
 * Pure types of the novel writing domain: the world engine, plot vow ledger,
 * creative decisions, and chapter knowledge control. Free of host-side value
 * imports so any consumer (tools, tests, future UIs) can share them.
 * @module @deepseek-ai/dsh-novel/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier of one subject, minted by the service. */
export type SubjectId = Branded<'novel:subject'>
/** Opaque identifier of one world event, minted by the service. */
export type WorldEventId = Branded<'novel:event'>
/** Opaque identifier of one plot vow, minted by the service. */
export type VowId = Branded<'novel:vow'>
/** Opaque identifier of one creative decision, minted by the service. */
export type DecisionId = Branded<'novel:decision'>
/** Opaque identifier of one plot story, minted by the service. */
export type StoryId = Branded<'novel:story'>
/** Opaque identifier of one plot thread, minted by the service. */
export type ThreadId = Branded<'novel:thread'>
/** Opaque identifier of one plot scene, minted by the service. */
export type SceneId = Branded<'novel:scene'>
/** Opaque identifier of one canon lorebook entry, minted by the service. */
export type LoreId = Branded<'novel:lore'>

/** The four subject kinds the world engine tracks. */
export type SubjectKind = 'character' | 'location' | 'faction' | 'object'

/** A position on the story's internal timeline. Months and days are 1-based;
 *  the calendar is not validated (month 13 and day 32 are legal positions). */
export interface StoryTime {
  /** Calendar year, negative before the story's epoch zero. */
  readonly year: number
  /** 1-based month. */
  readonly month: number
  /** 1-based day. */
  readonly day: number
}

/** One entity the world engine tracks. */
export interface Subject {
  /** Service-minted stable identifier. */
  readonly id: SubjectId
  /** The subject's kind. */
  readonly kind: SubjectKind
  /** Non-empty display name. */
  readonly name: string
  /** Free-form baseline summary; world events override it through changes. */
  readonly summary: string
}

/** One recorded point on the story timeline. */
export interface WorldEvent {
  /** Service-minted stable identifier. */
  readonly id: WorldEventId
  /** Position of the event on the story timeline. */
  readonly storyTime: StoryTime
  /** Non-empty event title. */
  readonly title: string
  /** Free-form event description. */
  readonly summary: string
}

/** One field overwrite a world event applies to a subject. */
export interface WorldChangeInput {
  /** The subject whose state this change overwrites. */
  readonly subjectId: SubjectId
  /** The state field being overwritten (for example `summary`, `alive`,
   *  `location`, or `relationship:<id>`). */
  readonly field: string
  /** The new value, stored as plain text. */
  readonly value: string
}

/** One subject field change applied by a world event. */
export interface WorldEventChange {
  /** The subject whose state field was overwritten. */
  readonly subjectId: SubjectId
  /** The overwritten field name. */
  readonly field: string
  /** The new value, stored as plain text. */
  readonly value: string
}

/** One world event together with the subject changes it applied. */
export interface WorldEventLogEntry {
  /** Service-minted stable identifier. */
  readonly id: WorldEventId
  /** Position of the event on the story timeline. */
  readonly storyTime: StoryTime
  /** Non-empty event title. */
  readonly title: string
  /** Free-form event description. */
  readonly summary: string
  /** The field overwrites this event applied. */
  readonly changes: readonly WorldEventChange[]
}

/** Input for {@link NovelService.recordWorldEvent}. */
export interface WorldEventInput {
  /** Position of the event on the story timeline. */
  readonly storyTime: StoryTime
  /** Non-empty event title. */
  readonly title: string
  /** Free-form event description. */
  readonly summary?: string
  /** Field overwrites applied to subjects at this event. */
  readonly changes?: readonly WorldChangeInput[]
}

/** The folded state of one subject at a point on the story timeline. */
export interface SubjectState {
  /** The subject's identity and baseline summary. */
  readonly subject: Subject
  /** Every field overwrite applied by events at or before the fold point,
   *  last write per field winning. Values are plain text. */
  readonly fields: Readonly<Record<string, string>>
  /** Story time of the last applied change, or `null` before any event
   *  touched the subject. */
  readonly updatedAt: StoryTime | null
}

/** The whole world at one point on the story timeline. */
export interface WorldState {
  /** The fold point: the latest event's story time, or `null` when no event
   *  has been recorded yet. */
  readonly at: StoryTime | null
  /** Every subject's folded state at the fold point. */
  readonly subjects: readonly SubjectState[]
}

/** The plot vow lifecycle. */
export type VowStatus = 'planted' | 'advanced' | 'paid_off' | 'abandoned'

/** One plot vow (a promise the story makes to the reader). */
export interface Vow {
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

/** One action the story took on a vow. */
export interface VowTransition {
  /** The lifecycle action. */
  readonly action: 'plant' | 'advance' | 'payoff' | 'abandon'
  /** Story time the action happened. */
  readonly at: StoryTime
  /** Free-form detail of the action. */
  readonly detail: string
}

/** A vow together with its full action history. */
export interface VowLedger {
  /** The vow's current state. */
  readonly vow: Vow
  /** Every action ever taken on the vow, oldest first. */
  readonly transitions: readonly VowTransition[]
}

/** One option a creative decision weighed. */
export interface DecisionOption {
  /** Non-empty option label. */
  readonly label: string
  /** Arguments for the option, or an empty string when unspecified. */
  readonly pros: string
  /** Arguments against the option, or an empty string when unspecified. */
  readonly cons: string
}

/** A recorded creative decision (an architecture-decision record for prose). */
export interface Decision {
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

/** One chapter's prose draft in the manuscript ledger. */
export interface Manuscript {
  /** 1-based chapter number. */
  readonly number: number
  /** Non-empty chapter title. */
  readonly title: string
  /** The chapter's prose. */
  readonly content: string
  /** Wall-clock ISO timestamp of the last write. */
  readonly updatedAt: string
}

/** Input for {@link NovelService.writeManuscript}; omitted fields keep their
 *  previous values on update. */
export interface ManuscriptInput {
  /** 1-based chapter number. */
  readonly number: number
  /** Non-empty chapter title. */
  readonly title: string
  /** The chapter's prose. */
  readonly content?: string
}

/** The knowledge-control ledger for one chapter. */
export interface ChapterInfo {
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

/** Input for {@link NovelService.upsertChapter}; omitted knowledge fields
 *  keep their previous values on update. */
export interface ChapterInput {
  /** 1-based chapter number. */
  readonly number: number
  /** Non-empty chapter title. */
  readonly title: string
  /** What the reader learns in this chapter. */
  readonly readerKnows?: string
  /** What the protagonist learns in this chapter. */
  readonly protagonistKnows?: string
  /** What this chapter must keep concealed. */
  readonly mustConceal?: string
  /** What this chapter may hint at without revealing. */
  readonly mayHint?: string
}

/** The durable consistency report the service's invariant companion checks. */
export interface IntegrityReport {
  /** `world_changes` rows whose event or subject no longer exists. */
  readonly orphanChanges: number
  /** `vow_transitions` rows whose vow no longer exists. */
  readonly orphanTransitions: number
  /** Every stored story time that fails to parse. */
  readonly unparsableStoryTimes: readonly string[]
  /** Vow ids marked `paid_off` without a recorded payoff transition. */
  readonly payoffWithoutTransition: readonly string[]
  /** Scene ids whose subject/vow JSON list fails to parse. */
  readonly unparsableSceneLists: readonly string[]
}

/** One top-level plot story (the causal spine a thread belongs to). */
export interface Story {
  /** Service-minted stable identifier. */
  readonly id: StoryId
  /** Non-empty display title. */
  readonly title: string
  /** Free-form summary of the story. */
  readonly summary: string
}

/** One plot thread inside a story (a line of causality). */
export interface StoryThread {
  /** Service-minted stable identifier. */
  readonly id: ThreadId
  /** The owning story's id. */
  readonly storyId: StoryId
  /** Non-empty display title. */
  readonly title: string
  /** Free-form summary of the thread. */
  readonly summary: string
  /** Ordering position within the story; lower first. */
  readonly position: number
}

/** The writing state of one scene. */
export type SceneStatus = 'planned' | 'writing' | 'written'

/** One plot scene: the smallest story unit, optionally anchored to the world. */
export interface Scene {
  /** Service-minted stable identifier. */
  readonly id: SceneId
  /** The owning thread's id. */
  readonly threadId: ThreadId
  /** Non-empty display title. */
  readonly title: string
  /** Free-form summary of the scene. */
  readonly summary: string
  /** Optional story-time anchor; scenes with one query world state at it. */
  readonly at: StoryTime | null
  /** Optional location tag. */
  readonly location: string
  /** Subjects present in the scene. */
  readonly subjectIds: readonly SubjectId[]
  /** Vows this scene is expected to advance or pay off. */
  readonly vowIds: readonly VowId[]
  /** Ordering position within the thread; lower first. */
  readonly position: number
  /** The scene's writing state. */
  readonly status: SceneStatus
}

/** Input for {@link NovelService.createScene}. */
export interface SceneInput {
  /** The owning thread's id. */
  readonly threadId: ThreadId
  /** Non-empty display title. */
  readonly title: string
  /** Free-form summary of the scene. */
  readonly summary?: string
  /** Optional story-time anchor. */
  readonly at?: StoryTime | null
  /** Optional location tag. */
  readonly location?: string
  /** Subjects present in the scene. */
  readonly subjectIds?: readonly SubjectId[]
  /** Vows this scene is expected to advance or pay off. */
  readonly vowIds?: readonly VowId[]
  /** Ordering position within the thread; lower first. */
  readonly position?: number
  /** The scene's writing state. */
  readonly status?: SceneStatus
}

/** Patch for {@link NovelService.updateScene}; every field optional. */
export interface ScenePatch {
  /** New display title. */
  readonly title?: string
  /** New free-form summary. */
  readonly summary?: string
  /** New story-time anchor, or `null` to clear it. */
  readonly at?: StoryTime | null
  /** New location tag. */
  readonly location?: string
  /** New subject list. */
  readonly subjectIds?: readonly SubjectId[]
  /** New vow list. */
  readonly vowIds?: readonly VowId[]
  /** New ordering position. */
  readonly position?: number
  /** New writing state. */
  readonly status?: SceneStatus
}

/** The plot tree read in one call: stories with their threads and scenes. */
export interface PlotTree {
  /** The stories in id order. */
  readonly stories: readonly PlotStory[]
}

/** One story of the plot tree with its threads. */
export interface PlotStory {
  /** The story. */
  readonly story: Story
  /** The story's threads in position order. */
  readonly threads: readonly PlotThread[]
}

/** One thread of the plot tree with its scenes. */
export interface PlotThread {
  /** The thread. */
  readonly thread: StoryThread
  /** The thread's scenes in position order. */
  readonly scenes: readonly Scene[]
}

/** The canon lorebook categories, mirroring a fiction project's lorebook directories. */
export type LoreCategory =
  | 'world' | 'character' | 'location' | 'faction' | 'item' | 'event' | 'system' | 'instruction' | 'note'

/** One canon lorebook entry. */
export interface LoreEntry {
  /** Service-minted stable identifier. */
  readonly id: LoreId
  /** The entry's category. */
  readonly category: LoreCategory
  /** Non-empty display title. */
  readonly title: string
  /** The canon text. */
  readonly content: string
  /** Omniscient canon known to everyone; character-scoped entries are `false`. */
  readonly omniscient: boolean
  /** The subject that knows this entry (character-scoped entries only). */
  readonly subjectId: SubjectId | null
}

/** Input for {@link NovelService.registerLore}; `id` present updates. */
export interface LoreInput {
  /** Existing entry id to update; omit to create. */
  readonly id?: LoreId
  /** The entry's category. */
  readonly category: LoreCategory
  /** Non-empty display title. */
  readonly title: string
  /** The canon text; trimmed to a non-empty string. */
  readonly content: string
  /** Omniscient canon (true) or scoped to `subjectId` (false). */
  readonly omniscient?: boolean
  /** The subject that knows this entry; required when not omniscient. */
  readonly subjectId?: SubjectId | null
}

/** The knowledge-layer context of one subject (or the omniscient canon alone). */
export interface LoreContext {
  /** The subject whose knowledge is exposed, or `null` for the omniscient view. */
  readonly subject: Subject | null
  /** Omniscient canon entries in id order. */
  readonly omniscient: readonly LoreEntry[]
  /** Entries scoped to the subject in id order. */
  readonly scoped: readonly LoreEntry[]
}
