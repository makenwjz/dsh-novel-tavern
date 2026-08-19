/**
 * Deterministic Markdown renderers for the novel workspace export. Pure
 * functions of the service's domain data; no I/O, no wall clock, so the
 * exported files are stable across runs with the same store.
 * @module @deepseek-ai/dsh-novel/markdown
 */

import { displayStoryTime } from './story-time.ts'
import type { ChapterInfo, Decision, Manuscript, Subject, VowLedger, WorldEvent, WorldState } from './types.ts'

/**
 * Render the subjects ledger document.
 * @param subjects - the subjects to render.
 * @returns the document text.
 */
export function renderSubjects(subjects: readonly Subject[]): string {
  const lines = ['# Subjects', '']
  for (const subject of subjects) {
    lines.push(`## ${subject.name} (${subject.id}) [${subject.kind}]`, '')
    if (subject.summary.length > 0) lines.push(`Summary: ${subject.summary}`, '')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the world-event timeline document.
 * @param events - the events to render.
 * @returns the document text.
 */
export function renderEvents(events: readonly WorldEvent[]): string {
  const lines = ['# World Events', '']
  for (const event of events) {
    lines.push(`## ${displayStoryTime(event.storyTime)} — ${event.title} (${event.id})`, '')
    if (event.summary.length > 0) lines.push(`Summary: ${event.summary}`, '')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the world-state snapshot document (all subjects folded at `at`).
 * @param state - the world state to render.
 * @returns the document text.
 */
export function renderState(state: WorldState): string {
  const lines = ['# World State', '']
  lines.push(`As of: ${state.at === null ? 'the beginning of the story' : displayStoryTime(state.at)}`, '')
  lines.push('')
  for (const entry of state.subjects) {
    lines.push(`## ${entry.subject.name} (${entry.subject.id}) [${entry.subject.kind}]`, '')
    if (entry.subject.summary.length > 0) lines.push(`summary: ${entry.subject.summary}`, '')
    for (const [field, value] of Object.entries(entry.fields)) {
      lines.push(`${field}: ${value}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the plot-vow ledger document.
 * @param ledgers - the vow ledgers to render.
 * @returns the document text.
 */
export function renderVows(ledgers: readonly VowLedger[]): string {
  const lines = ['# Plot Vows', '']
  for (const { vow, transitions } of ledgers) {
    lines.push(`## ${vow.title} (${vow.id}) — ${vow.status}`, '')
    lines.push(`Promise: ${vow.promise}`, '')
    lines.push(`Planted: ${displayStoryTime(vow.plantedAt)}`, '')
    if (vow.payoffTarget.length > 0) lines.push(`Payoff target: ${vow.payoffTarget}`, '')
    if (vow.note.length > 0) lines.push(`Note: ${vow.note}`, '')
    lines.push('History:', '')
    for (const transition of transitions) {
      const detail = transition.detail.length > 0 ? ` — ${transition.detail}` : ''
      lines.push(`- ${transition.action} (${displayStoryTime(transition.at)})${detail}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the creative-decisions document.
 * @param decisions - the decisions to render.
 * @returns the document text.
 */
export function renderDecisions(decisions: readonly Decision[]): string {
  const lines = ['# Creative Decisions', '']
  for (const decision of decisions) {
    lines.push(`## ${decision.id} (${decision.createdAt}) — ${decision.status}`, '')
    lines.push(`Context: ${decision.context}`, '')
    if (decision.chosen !== null) lines.push(`Chosen: ${decision.chosen}`, '')
    if (decision.rationale.length > 0) lines.push(`Rationale: ${decision.rationale}`, '')
    lines.push('Options:', '')
    for (const option of decision.options) {
      const pros = option.pros.length > 0 ? ` (pros: ${option.pros})` : ''
      const cons = option.cons.length > 0 ? ` (cons: ${option.cons})` : ''
      lines.push(`- ${option.label}${pros}${cons}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the chapter knowledge-control document.
 * @param chapters - the chapters to render.
 * @returns the document text.
 */
export function renderChapters(chapters: readonly ChapterInfo[]): string {
  const lines = ['# Chapters', '']
  for (const chapter of chapters) {
    lines.push(`## Chapter ${chapter.number} — ${chapter.title}`, '')
    lines.push(`Reader knows: ${chapter.readerKnows || '-'}`, '')
    lines.push(`Protagonist knows: ${chapter.protagonistKnows || '-'}`, '')
    lines.push(`Must conceal: ${chapter.mustConceal || '-'}`, '')
    lines.push(`May hint: ${chapter.mayHint || '-'}`, '')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the manuscript document: every chapter's prose draft in order.
 * @param manuscript - the drafts to render.
 * @returns the document text.
 */
export function renderManuscript(manuscript: readonly Manuscript[]): string {
  const lines = ['# Manuscript', '']
  for (const chapter of manuscript) {
    lines.push(`## Chapter ${chapter.number} — ${chapter.title}`, '')
    lines.push(chapter.content.length === 0 ? '(no prose yet)' : chapter.content, '')
  }
  return lines.join('\n')
}
