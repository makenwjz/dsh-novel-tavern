// Proves the novel service is real deployable configurability and not a
// constant: the store root is set in a cordis.yml booted through the real
// Loader, the service opens the store there, and schema-invalid roots reject
// the whole boot.
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { NovelService } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given novel config block.
 * @param configLines - YAML lines nested under the service's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-novel-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-novel'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-novel', NovelService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('dsh-novel real Loader composition through cordis.yml', () => {
  it('opens the store at the configured root and serves the domain end to end', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-novel-loader-'))
    const ctx = await boot([`    root: ${join(root, 'loader-store')}`])
    const subject = ctx.novel.createSubject({ kind: 'character', name: 'Aya' })
    const event = ctx.novel.recordWorldEvent({
      storyTime: { year: 1200, month: 1, day: 1 },
      title: 'Duel',
      changes: [{ subjectId: subject.id, field: 'alive', value: 'false' }],
    })
    expect(event.id).toBe('event-1')
    expect(ctx.novel.subjectState(subject.id)?.fields).toEqual({ alive: 'false' })
    expect(ctx.novel.checkIntegrity().orphanChanges).toBe(0)
    await expect(ctx.novel.exportMarkdown()).resolves.toHaveLength(7)
    expect(existsSync(join(root, 'loader-store', 'state.sqlite'))).toBe(true)
  }, 30_000)

  it('resolves the documented default root against the working directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-novel-loader-'))
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const ctx = await boot([])
      expect(ctx.novel.root).toBe(join(root, 'novel'))
    } finally {
      process.chdir(previousCwd)
    }
  }, 30_000)

  it.each([
    { label: 'is not a string', configLines: ['    root: 42'], failure: /expected string/ },
    { label: 'is not an object', configLines: ['    root: [1, 2]'], failure: /expected string/ },
  ])('fails loading when config.root $label', async ({ configLines, failure }) => {
    await expect(boot(configLines)).rejects.toThrow(failure)
  }, 30_000)
})
