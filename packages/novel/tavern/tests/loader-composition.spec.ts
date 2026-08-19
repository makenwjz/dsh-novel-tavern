import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TavernService from '@deepseek-ai/dsh-tavern'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('@deepseek-ai/dsh-tavern real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and injects the binding into the assembled prompt', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tavern-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '- name: \'@deepseek-ai/dsh-tavern\'',
      '  config:',
      `    root: ${JSON.stringify(join(root, 'tavern'))}`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tavern', TavernService],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const book = context.tavern.importWorldBook(JSON.stringify({
      name: '青鸾山志',
      entries: [{ keys: ['青鸾'], content: '青鸾是护山灵兽。' }],
    }))
    const session = context.sessions.create()
    session.append('tavern/binding', { mode: 'novel', worldbookIds: [book.id], characterId: null })
    session.append('user/message', {
      id: 'm-1' as never,
      role: 'user',
      content: [{ type: 'text', text: '青鸾在吗？' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    const agent = { session } as never
    const assembly = await context.systemPrompt.assemble({ scope: agent, agent })
    const section = assembly.sections.find(candidate => candidate.name === 'tavern:context')
    expect(section?.text).toContain('## 已激活的世界书设定')
    expect(section?.text).toContain('《青鸾山志》：青鸾是护山灵兽。')
  })
})
