import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { NovelService } from '../src/index.ts'
import * as NovelInvariant from '../src/invariant.ts'

let contexts: Context[] = []
let roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  contexts = []
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

async function mount(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-invariant-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NovelService, { root })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

function corrupt(ctx: Context, sql: string): void {
  ctx.novel.db.exec('PRAGMA foreign_keys = OFF')
  try {
    ctx.novel.db.exec(sql)
  } finally {
    ctx.novel.db.exec('PRAGMA foreign_keys = ON')
  }
}

describe('novel store invariants', () => {
  it('mounts on a coherent store', async () => {
    const ctx = await mount()
    await expect(ctx.plugin(NovelInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('rejects an orphaned world_changes row', async () => {
    const ctx = await mount()
    corrupt(ctx, `
      INSERT INTO world_events (id, story_time, title, summary) VALUES ('event-x', '+001200.01.01', 'T', '');
      INSERT INTO world_changes (event_seq, subject_id, field, value) VALUES (1, 'subject-x', 'alive', 'false');
    `)
    await expect(ctx.plugin(NovelInvariant)).rejects.toThrow(/world_changes has 1 row/)
  })

  it('rejects an orphaned vow_transitions row', async () => {
    const ctx = await mount()
    corrupt(ctx, "INSERT INTO vow_transitions (vow_id, seq, action, at_story, detail) VALUES ('vow-x', 1, 'plant', '+001200.01.01', '')")
    await expect(ctx.plugin(NovelInvariant)).rejects.toThrow(/vow_transitions has 1 row/)
  })

  it('rejects an unparsable story time', async () => {
    const ctx = await mount()
    corrupt(ctx, "INSERT INTO vows (id, title, promise, planted_at, status, payoff_target, note) VALUES ('vow-x', 'T', 'p', 'not-a-time', 'planted', '', '')")
    await expect(ctx.plugin(NovelInvariant)).rejects.toThrow(/unparsable story time/)
  })

  it('rejects a paid-off vow without a payoff transition', async () => {
    const ctx = await mount()
    const vow = ctx.novel.plantVow({ title: 'Blade', promise: 'returns', at: { year: 1200, month: 1, day: 1 } })
    corrupt(ctx, `UPDATE vows SET status = 'paid_off' WHERE id = '${vow.id}'`)
    await expect(ctx.plugin(NovelInvariant)).rejects.toThrow(/paid-off vow\(s\) without a payoff transition/)
  })
})
