/** Wire types of the read-only novel workspace Remote. @module @deepseek-ai/dsh-novel-api/types */

/** One subject's folded state as projected over the wire. */
export interface NovelSubjectView {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly summary: string
  readonly fields: Readonly<Record<string, string>>
  readonly updatedAt: string | null
}

/** The world fold point and all subjects, display-form story times. */
export interface NovelWorldView {
  readonly at: string | null
  readonly subjects: readonly NovelSubjectView[]
}

/** One story event in story order. */
export interface NovelEventView {
  readonly id: string
  readonly storyTime: string
  readonly title: string
  readonly summary: string
}

/** One recorded transition on a plot vow, in chronological order. */
export interface NovelVowTransitionView {
  readonly action: string
  readonly at: string
  readonly detail: string
}

/** One plot vow with its full transition history. */
export interface NovelVowView {
  readonly id: string
  readonly title: string
  readonly promise: string
  readonly plantedAt: string
  readonly status: string
  readonly payoffTarget: string
  readonly note: string
  readonly transitions: readonly NovelVowTransitionView[]
}

/** One creative decision option. */
export interface NovelDecisionOptionView {
  readonly label: string
  readonly pros: string
  readonly cons: string
}

/** One creative decision with its options and outcome. */
export interface NovelDecisionView {
  readonly id: string
  readonly createdAt: string
  readonly context: string
  readonly status: string
  readonly chosen: string | null
  readonly rationale: string
  readonly options: readonly NovelDecisionOptionView[]
}

/** One chapter knowledge-control row. */
export interface NovelChapterView {
  readonly number: number
  readonly title: string
  readonly readerKnows: string
  readonly protagonistKnows: string
  readonly mustConceal: string
  readonly mayHint: string
}

/** One manuscript chapter draft row. */
export interface NovelManuscriptView {
  readonly number: number
  readonly title: string
  readonly content: string
  readonly updatedAt: string
}

/** One canon lorebook entry row. */
export interface NovelLoreView {
  readonly id: string
  readonly category: string
  readonly title: string
  readonly content: string
  readonly omniscient: boolean
  readonly subjectId: string | null
}

/** The whole novel workspace at one read, JSON-safe with display-form story times. */
export interface NovelWorkspaceSnapshot {
  readonly root: string
  readonly world: NovelWorldView
  readonly events: readonly NovelEventView[]
  readonly vows: readonly NovelVowView[]
  readonly decisions: readonly NovelDecisionView[]
  readonly chapters: readonly NovelChapterView[]
  readonly manuscript: readonly NovelManuscriptView[]
  readonly lore: readonly NovelLoreView[]
}
