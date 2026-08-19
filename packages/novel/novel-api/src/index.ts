/** Read-only Remote projection of the novel workspace for the Web visualization. @module @deepseek-ai/dsh-novel-api */

import { Context } from '@deepseek-ai/cordis'
import type { NovelService } from '@deepseek-ai/dsh-novel/src/index.ts'
import type { SubjectState } from '@deepseek-ai/dsh-novel/src/types.ts'
import { displayStoryTime } from '@deepseek-ai/dsh-novel/src/story-time.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NovelChapterView,
  NovelDecisionView,
  NovelEventView,
  NovelLoreView,
  NovelManuscriptView,
  NovelSubjectView,
  NovelVowView,
  NovelWorkspaceSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Shared missing-runtime explanation for every Remote method. */
const MISSING_RUNTIME = 'requires the novel workspace service; mount the @deepseek-ai/dsh-novel-bundle bundle'

/** Resolve the optional novel service, failing loud when no deployment mounts it. */
function requireNovel(ctx: Context): NovelService {
  const novel = ctx.get('novel') as NovelService | undefined
  if (novel === undefined) {
    throw new Error(`novelWorkspace.workspace ${MISSING_RUNTIME}`)
  }
  return novel
}

/** Project one subject state into its wire view. */
function projectSubject(subject: SubjectState): NovelSubjectView {
  return {
    id: subject.subject.id,
    kind: subject.subject.kind,
    name: subject.subject.name,
    summary: subject.subject.summary,
    fields: { ...subject.fields },
    updatedAt: subject.updatedAt === null ? null : displayStoryTime(subject.updatedAt),
  }
}

/** Publish one read-only snapshot of the whole novel workspace under the `novelWorkspace` Remote namespace. */
export class NovelApiGateway extends TypertRemoteService {
  /** Bind the gateway to its `novelWorkspace` service key and Remote namespace. */
  constructor(ctx: Context) {
    super(ctx, 'novelWorkspace')
  }

  /** Project the novel store into one JSON-safe, display-form snapshot.
 * @returns the whole novel workspace in display form, or fails loud when no `novel` service is mounted.
 */
  @Remote('workspace')
  workspace(): NovelWorkspaceSnapshot {
    const novel = requireNovel(this.ctx)
    const state = novel.worldState()
    return {
      root: novel.root,
      world: {
        at: state.at === null ? null : displayStoryTime(state.at),
        subjects: state.subjects.map(projectSubject),
      },
      events: novel.listWorldEvents().map((event): NovelEventView => ({
        id: event.id,
        storyTime: displayStoryTime(event.storyTime),
        title: event.title,
        summary: event.summary,
      })),
      vows: novel.listVows().map((ledger): NovelVowView => ({
        id: ledger.vow.id,
        title: ledger.vow.title,
        promise: ledger.vow.promise,
        plantedAt: displayStoryTime(ledger.vow.plantedAt),
        status: ledger.vow.status,
        payoffTarget: ledger.vow.payoffTarget,
        note: ledger.vow.note,
        transitions: ledger.transitions.map(transition => ({
          action: transition.action,
          at: displayStoryTime(transition.at),
          detail: transition.detail,
        })),
      })),
      decisions: novel.listDecisions().map((decision): NovelDecisionView => ({
        id: decision.id,
        createdAt: decision.createdAt,
        context: decision.context,
        status: decision.status,
        chosen: decision.chosen,
        rationale: decision.rationale,
        options: decision.options.map(option => ({ ...option })),
      })),
      chapters: novel.listChapters().map((chapter): NovelChapterView => ({
        number: chapter.number,
        title: chapter.title,
        readerKnows: chapter.readerKnows,
        protagonistKnows: chapter.protagonistKnows,
        mustConceal: chapter.mustConceal,
        mayHint: chapter.mayHint,
      })),
      manuscript: novel.listManuscript().map((entry): NovelManuscriptView => ({
        number: entry.number,
        title: entry.title,
        content: entry.content,
        updatedAt: entry.updatedAt,
      })),
      lore: novel.listLore().map((entry): NovelLoreView => ({
        id: entry.id,
        category: entry.category,
        title: entry.title,
        content: entry.content,
        omniscient: entry.omniscient,
        subjectId: entry.subjectId,
      })),
    }
  }
}

export default NovelApiGateway
