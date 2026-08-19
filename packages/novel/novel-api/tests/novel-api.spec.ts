import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { NovelService } from '@deepseek-ai/dsh-novel'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import NovelApiGateway from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(withNovel = true): Promise<{
  ctx: Context
  gateway: NovelApiGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.novelService = NovelService
  ctx.loader.builtins.novelApi = NovelApiGateway
  if (withNovel) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-novel-api-'))
    roots.push(root)
    await ctx.loader.create({ name: 'cordis:novelService', config: { root } })
  }
  await ctx.loader.create({ name: 'cordis:novelApi' })
  const gateway = ctx.get('novelWorkspace') as NovelApiGateway
  return { ctx, gateway }
}

describe('NovelApiGateway', () => {
  it('publishes one direct workspace method under the novelWorkspace namespace', async () => {
    const { gateway } = await harness()
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'novelWorkspace',
      namespace: 'novelWorkspace',
    })
    expect(remoteMethods(gateway)).toEqual([
      { method: 'workspace', invocation: { kind: 'direct' } },
    ])
  })

  it('projects the whole store into one JSON-safe display-form snapshot', async () => {
    const { ctx, gateway } = await harness()
    const novel = ctx.novel
    const subject = novel.createSubject({
      kind: 'character',
      name: '林墨',
      summary: '一名旅居北地的剑客。',
    })
    novel.recordWorldEvent({
      storyTime: { year: 26, month: 3, day: 5 },
      title: '林墨抵达雪线',
      summary: '越过最后的哨站。',
      changes: [{ subjectId: subject.id, field: '位置', value: '雪线哨站' }],
    })
    novel.plantVow({
      title: '北地疑云',
      promise: '查明雪线之下埋藏的信物。',
      at: { year: 26, month: 3, day: 5 },
      payoffTarget: '第 12 章前揭示信物来历。',
      note: '与风雪季到来挂钩。',
    })
    novel.recordDecision({
      context: '是否立刻深入雪线。',
      options: [
        { label: '今夜出发', pros: '抢在风雪季前。', cons: '补给未齐。' },
        { label: '休整一日', pros: '补给完备。', cons: '错过窗口。' },
      ],
    })
    novel.upsertChapter({
      number: 1,
      title: '雪线哨站',
      readerKnows: '林墨抵达雪线。',
      protagonistKnows: '信物所在。',
      mustConceal: '信物与北地叛军的关系。',
      mayHint: '哨站长官的异常客气。',
    })

    const snapshot = gateway.workspace()
    expect(snapshot.root).toContain('dsh-novel-api-')
    expect(snapshot.world.at).toBe('26.03.05')
    expect(snapshot.world.subjects).toEqual([
      {
        id: subject.id,
        kind: 'character',
        name: '林墨',
        summary: '一名旅居北地的剑客。',
        fields: { 位置: '雪线哨站' },
        updatedAt: '26.03.05',
      },
    ])
    expect(snapshot.events).toEqual([
      {
        id: expect.any(String) as string,
        storyTime: '26.03.05',
        title: '林墨抵达雪线',
        summary: '越过最后的哨站。',
      },
    ])
    expect(snapshot.vows).toMatchObject([
      {
        title: '北地疑云',
        promise: '查明雪线之下埋藏的信物。',
        plantedAt: '26.03.05',
        status: 'planted',
        payoffTarget: '第 12 章前揭示信物来历。',
        transitions: [{ action: 'plant', at: '26.03.05' }],
      },
    ])
    expect(snapshot.decisions).toMatchObject([
      {
        status: 'open',
        chosen: null,
        options: [
          { label: '今夜出发', pros: '抢在风雪季前。', cons: '补给未齐。' },
          { label: '休整一日', pros: '补给完备。', cons: '错过窗口。' },
        ],
      },
    ])
    expect(snapshot.chapters).toEqual([
      {
        number: 1,
        title: '雪线哨站',
        readerKnows: '林墨抵达雪线。',
        protagonistKnows: '信物所在。',
        mustConceal: '信物与北地叛军的关系。',
        mayHint: '哨站长官的异常客气。',
      },
    ])
  })

  it('fails loud when no deployment mounts the novel service', async () => {
    const { gateway } = await harness(false)
    expect(() => gateway.workspace()).toThrow(/requires the novel workspace service/)
  })
})
