import { describe, expect, it } from 'vitest'
import {
  renderChapters,
  renderDecisions,
  renderEvents,
  renderState,
  renderSubjects,
  renderVows,
} from '../src/markdown.ts'
import type {
  ChapterInfo,
  Decision,
  DecisionOption,
  Subject,
  VowLedger,
  WorldEvent,
  WorldState,
} from '../src/types.ts'

function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: 'subject-1' as never,
    kind: 'character',
    name: 'Aya',
    summary: '',
    ...overrides,
  }
}

function event(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: 'event-1' as never,
    storyTime: { year: 1200, month: 1, day: 1 },
    title: 'Duel',
    summary: '',
    ...overrides,
  }
}

function option(label: string, pros = '', cons = ''): DecisionOption {
  return { label, pros, cons }
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'decision-1' as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    context: 'Survival',
    options: [option('roof')],
    chosen: null,
    rationale: '',
    status: 'open',
    ...overrides,
  }
}

function vowLedger(overrides: Partial<VowLedger['vow']> = {}, transitions: VowLedger['transitions'] = []): VowLedger {
  return {
    vow: {
      id: 'vow-1' as never,
      title: 'Blade',
      promise: 'returns',
      plantedAt: { year: 1200, month: 1, day: 1 },
      status: 'planted',
      payoffTarget: '',
      note: '',
      ...overrides,
    },
    transitions,
  }
}

function chapter(overrides: Partial<ChapterInfo> = {}): ChapterInfo {
  return {
    number: 1,
    title: 'The fire',
    readerKnows: '',
    protagonistKnows: '',
    mustConceal: '',
    mayHint: '',
    ...overrides,
  }
}

describe('renderSubjects', () => {
  it('lists subjects, including their summary only when present', () => {
    const out = renderSubjects([subject(), subject({ name: 'Misaki', summary: 'the keeper' })])
    const [aya, misaki] = out.split('## Misaki (subject-1) [character]')
    expect(aya).toContain('## Aya (subject-1) [character]')
    expect(aya).not.toContain('Summary:')
    expect(misaki).toContain('Summary: the keeper')
  })
})

describe('renderEvents', () => {
  it('renders the timeline, including summaries only when present', () => {
    const out = renderEvents([
      event(),
      event({ storyTime: { year: 1200, month: 2, day: 1 }, title: 'Night', summary: 'a dark fight' }),
    ])
    const [duel, night] = out.split('## 1200.02.01 — Night (event-1)')
    expect(duel).toContain('## 1200.01.01 — Duel (event-1)')
    expect(duel).not.toContain('Summary:')
    expect(night).toContain('Summary: a dark fight')
  })
})

describe('renderState', () => {
  it('renders an empty world as the beginning of the story', () => {
    const out = renderState({ at: null, subjects: [] })
    expect(out).toContain('As of: the beginning of the story')
  })

  it('renders every subject with summary and fields at a point in time', () => {
    const out = renderState({
      at: { year: 1200, month: 6, day: 1 },
      subjects: [
        {
          subject: subject({ summary: 'the archer' }),
          fields: { alive: 'false', burned: 'east quarter' },
          updatedAt: { year: 1200, month: 6, day: 1 },
        },
        {
          subject: subject({ name: 'Kyoto' }),
          fields: {},
          updatedAt: null,
        },
      ],
    })
    expect(out).toContain('As of: 1200.06.01')
    expect(out).toContain('summary: the archer')
    expect(out).toContain('alive: false')
    expect(out).toContain('burned: east quarter')
    expect(out).toContain('## Kyoto (subject-1) [character]')
  })
})

describe('renderVows', () => {
  it('renders vow metadata, payoff target, and note only when present', () => {
    const out = renderVows([
      vowLedger({ title: 'Blade', status: 'paid_off', payoffTarget: 'Chapter 12', note: 'keep' }, [
        { action: 'plant', at: { year: 1200, month: 1, day: 1 }, detail: '' },
        { action: 'payoff', at: { year: 1201, month: 1, day: 1 }, detail: 'forged anew' },
      ]),
      vowLedger({ title: 'Mask' }),
    ])
    const [blade, mask] = out.split('## Mask (vow-1) — planted')
    expect(blade).toContain('## Blade (vow-1) — paid_off')
    expect(blade).toContain('Promise: returns')
    expect(blade).toContain('Planted: 1200.01.01')
    expect(blade).toContain('Payoff target: Chapter 12')
    expect(blade).toContain('Note: keep')
    expect(blade).toContain('- plant (1200.01.01)')
    expect(blade).toContain('- payoff (1201.01.01) — forged anew')
    expect(mask).toContain('Promise: returns')
    expect(mask).not.toMatch(/Payoff target/)
    expect(mask).not.toMatch(/Note:/)
  })
})

describe('renderDecisions', () => {
  it('renders decided choices and rationale only when present', () => {
    const out = renderDecisions([
      decision({ options: [option('roof', 'fast', 'risky'), option('cistern')] }),
      decision({
        id: 'decision-2' as never,
        context: 'Aftermath',
        chosen: 'roof',
        rationale: 'height wins',
        status: 'decided',
        options: [option('roof', 'fast', 'risky')],
      }),
    ])
    const [open, closed] = out.split('## decision-2 (2026-01-01T00:00:00.000Z) — decided')
    expect(open).toContain('## decision-1 (2026-01-01T00:00:00.000Z) — open')
    expect(open).toContain('Context: Survival')
    expect(open).toContain('- roof (pros: fast) (cons: risky)')
    expect(open).toContain('- cistern')
    expect(open).not.toContain('Chosen:')
    expect(open).not.toContain('Rationale:')
    expect(closed).toContain('Chosen: roof')
    expect(closed).toContain('Rationale: height wins')
  })
})

describe('renderChapters', () => {
  it('renders knowledge fields, using a dash for empty ones', () => {
    const out = renderChapters([
      chapter(),
      chapter({
        number: 2,
        title: 'Embers',
        readerKnows: 'the blade is lost',
        protagonistKnows: 'Aya lives',
        mustConceal: 'the return',
        mayHint: 'the forge',
      }),
    ])
    expect(out).toContain('## Chapter 1 — The fire')
    expect(out).toContain('Reader knows: -')
    expect(out).toContain('Protagonist knows: -')
    expect(out).toContain('Must conceal: -')
    expect(out).toContain('May hint: -')
    expect(out).toContain('## Chapter 2 — Embers')
    expect(out).toContain('Reader knows: the blade is lost')
    expect(out).toContain('Protagonist knows: Aya lives')
    expect(out).toContain('Must conceal: the return')
    expect(out).toContain('May hint: the forge')
  })
})

describe('markdown documents stay deterministic', () => {
  it('renders the same text for the same store', () => {
    const store: WorldState = {
      at: { year: 1200, month: 1, day: 1 },
      subjects: [{ subject: subject({ summary: 'the archer' }), fields: { alive: 'true' }, updatedAt: null }],
    }
    expect(renderState(store)).toBe(renderState(store))
  })
})
