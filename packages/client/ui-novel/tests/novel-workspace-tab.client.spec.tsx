// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelWorkspaceTab } from '../src/client/NovelWorkspaceTab.tsx'
import type {
  NovelWorkspaceTabInjected,
  NovelWorkspaceTabProps,
} from '../src/client/NovelWorkspaceTab.tsx'
import { en, type NovelLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<NovelWorkspaceTabInjected['read']>>
const t = ((key: NovelLocaleKey, params?: Record<string, unknown>): string => {
  const template = en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}) as NovelWorkspaceTabProps['t']

function props(read: NovelWorkspaceTabInjected['read']): NovelWorkspaceTabProps {
  return {
    t,
    read,
  } as NovelWorkspaceTabProps
}

const SNAPSHOT: Snapshot = {
  root: '/home/user/novel',
  world: {
    at: '26.03.05',
    subjects: [
      {
        id: 'subject-1',
        kind: 'character',
        name: '林墨',
        summary: '一名旅居北地的剑客。',
        fields: { 位置: '雪线哨站', 伤势: '左臂轻伤' },
        updatedAt: '26.03.05',
      },
      {
        id: 'subject-2',
        kind: 'location',
        name: '雪线哨站',
        summary: '北地最后的补给点。',
        fields: {},
        updatedAt: null,
      },
    ],
  },
  events: [
    { id: 'event-1', storyTime: '26.03.05', title: '林墨抵达雪线', summary: '越过最后的哨站。' },
  ],
  vows: [
    {
      id: 'vow-1',
      title: '北地疑云',
      promise: '查明雪线之下埋藏的信物。',
      plantedAt: '26.03.05',
      status: 'advanced',
      payoffTarget: '第 12 章前揭示信物来历。',
      note: '与风雪季到来挂钩。',
      transitions: [
        { action: 'plant', at: '26.03.05', detail: '哨站长官避谈地窖。' },
        { action: 'advance', at: '26.03.06', detail: '发现地窖门锁。' },
      ],
    },
  ],
  decisions: [
    {
      id: 'decision-1',
      createdAt: '2026-08-16T08:00:00.000Z',
      context: '是否立刻深入雪线。',
      status: 'decided',
      chosen: '今夜出发',
      rationale: '风雪季不等人。',
      options: [
        { label: '今夜出发', pros: '抢在风雪季前。', cons: '补给未齐。' },
        { label: '休整一日', pros: '补给完备。', cons: '错过窗口。' },
      ],
    },
  ],
  chapters: [
    {
      number: 1,
      title: '雪线哨站',
      readerKnows: '林墨抵达雪线。',
      protagonistKnows: '信物所在。',
      mustConceal: '信物与北地叛军的关系。',
      mayHint: '哨站长官的异常客气。',
    },
  ],
  manuscript: [],
  lore: [],
}

describe('NovelWorkspaceTab', () => {
  it('renders every workspace section from one snapshot', async () => {
    const read = vi.fn(() => Promise.resolve(SNAPSHOT))
    const view = render(<NovelWorkspaceTab {...props(read)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    expect(await screen.findByRole('region', { name: en.world })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.timeline })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.vows })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.decisions })).toBeTruthy()
    expect(screen.getByRole('region', { name: en.chapters })).toBeTruthy()

    expect(view.container.querySelector('[data-novel-subject]')).toBeTruthy()
    expect(screen.getByText('林墨')).toBeTruthy()
    expect(screen.getAllByText(en.kindCharacter)).toHaveLength(1)
    expect(screen.getAllByText('雪线哨站')).toHaveLength(2)
    expect(screen.getByText(en.worldAt.replace('{at}', '26.03.05'))).toBeTruthy()
    expect(screen.getByText(en.subjectUpdatedAt.replace('{at}', '26.03.05'))).toBeTruthy()

    expect(view.container.querySelector('[data-novel-event]')).toBeTruthy()
    expect(screen.getByText('林墨抵达雪线')).toBeTruthy()

    expect(view.container.querySelector('[data-novel-vow]')).toBeTruthy()
    expect(screen.getByText('北地疑云')).toBeTruthy()
    expect(screen.getByText(en.vowAdvanced)).toBeTruthy()
    expect(screen.getByText(en.payoffTarget)).toBeTruthy()
    expect(view.container.querySelectorAll('[data-novel-vow-transition]')).toHaveLength(2)
    expect(screen.getByText(en.vowActionPlant)).toBeTruthy()
    expect(screen.getByText(en.vowActionAdvance)).toBeTruthy()

    expect(view.container.querySelector('[data-novel-decision]')).toBeTruthy()
    expect(screen.getByText(en.decisionDecided)).toBeTruthy()
    expect(screen.getAllByText(en.chosen)).toHaveLength(1)
    expect(screen.getAllByText(en.pros)).toHaveLength(2)
    expect(screen.getAllByText(en.cons)).toHaveLength(2)

    expect(view.container.querySelector('[data-novel-chapter]')).toBeTruthy()
    expect(screen.getByText(/Chapter 1/)).toBeTruthy()
    expect(screen.getByText(en.readerKnows)).toBeTruthy()
    expect(screen.getByText(en.protagonistKnows)).toBeTruthy()
    expect(screen.getByText(en.mustConceal)).toBeTruthy()
    expect(screen.getByText(en.mayHint)).toBeTruthy()

    expect(screen.getByText('/home/user/novel')).toBeTruthy()
  })

  it('shows localized empty states for a fresh workspace', async () => {
    render(<NovelWorkspaceTab {...props(async () => ({ ...SNAPSHOT, world: { at: null, subjects: [] }, events: [], vows: [], decisions: [], chapters: [], manuscript: [], lore: [] }))} />)
    expect(await screen.findByText(en.noSubjects)).toBeTruthy()
    expect(screen.getByText(en.noEvents)).toBeTruthy()
    expect(screen.getByText(en.noVows)).toBeTruthy()
    expect(screen.getByText(en.noDecisions)).toBeTruthy()
    expect(screen.getByText(en.noChapters)).toBeTruthy()
  })

  it('shows a generic failure, retries, and refreshes on demand', async () => {
    const read = vi.fn<NovelWorkspaceTabInjected['read']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValue(SNAPSHOT)
    render(<NovelWorkspaceTab {...props(read)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('林墨')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(read).toHaveBeenCalledTimes(3) })
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as NovelWorkspaceTabInjected['read']
    const failed = render(<NovelWorkspaceTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<NovelWorkspaceTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<NovelWorkspaceTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
