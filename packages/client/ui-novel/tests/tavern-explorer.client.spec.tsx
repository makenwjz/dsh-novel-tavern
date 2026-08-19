// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelProjectExplorer } from '../src/client/NovelProjectExplorer.tsx'
import type { NovelProjectExplorerProps } from '../src/client/NovelProjectExplorer.tsx'
import { en, type NovelLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: NovelLocaleKey, params?: Record<string, unknown>): string => {
  const template = en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}) as NovelProjectExplorerProps['t']

/** An RPC result the fake tavern face resolves. */
function ok<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

function fail(message: string): { result: { ok: false; error: { code: string; message: string } } } {
  return { result: { ok: false, error: { code: 'E', message } } }
}

/** The fake tavern API face the explorer drives. */
function tavernApi() {
  const api = {
    projectTree: vi.fn(),
    importCharacter: vi.fn(),
    importWorldBook: vi.fn(),
    deleteWorldBook: vi.fn(),
    deleteCharacter: vi.fn(),
    binding: vi.fn(),
    characterImage: vi.fn(),
    startRoleplay: vi.fn(),
    stopRoleplay: vi.fn(),
    setBinding: vi.fn(),
    // Chat-view faces: the explorer now defaults to the WeChat-style chat.
    listCharacters: vi.fn(),
    listWorldBooks: vi.fn(),
  }
  api.projectTree.mockResolvedValue(ok({
    worldbooks: [{
      id: 'worldbook-1',
      name: '剑冢设定',
      entries: [{ keys: ['剑'], content: '埋着断剑。', comment: '地点' }],
    }],
    characters: [{
      id: 'character-1',
      name: '阿雅',
      format: 'json',
      extensions: {},
      hasAvatar: false,
    }],
  }))
  api.binding.mockResolvedValue(ok({ binding: null }))
  api.listCharacters.mockResolvedValue(ok({ characters: [{ id: 'character-1', name: '阿雅', format: 'json' }] }))
  api.listWorldBooks.mockResolvedValue(ok({ worldbooks: [{ id: 'worldbook-1', name: '剑冢设定', entryCount: 1 }] }))
  return api
}

type SessionListState = { ids: string[]; byId: Record<string, { title?: string }> }

function renderTavern(
  api: ReturnType<typeof tavernApi>,
  options: { sessions?: SessionListState; binding?: { mode: 'novel' | 'tavern'; worldbookIds: string[]; characterId: string | null } | null } = {},
) {
  const sessions = options.sessions ?? { ids: [], byId: {} }
  api.binding.mockResolvedValue(ok({ binding: options.binding ?? null }))
  const fullApi = {
    tavern: api,
    sessions: {
      list: vi.fn().mockResolvedValue(ok({ items: [] })),
      create: vi.fn().mockResolvedValue(ok({ sessionId: 'session-x' })),
      history: vi.fn().mockResolvedValue(ok({ events: [] })),
      prompt: vi.fn().mockResolvedValue(ok({ accepted: true })),
    },
    workspace: {
      list: vi.fn().mockResolvedValue(ok({ items: [], archivedSessionIds: [] })),
      archiveSession: vi.fn().mockResolvedValue(ok({ archivedSessionIds: [] })),
    },
  }
  const props = {
    t,
    mode: 'tavern',
    read: vi.fn(),
    api: fullApi as never,
    useStore: (selector: (state: { open: boolean; x: number; y: number }) => unknown) =>
      selector({ open: true, x: 0, y: 0 }),
    actions: { toggle: vi.fn() },
    useSessions: () => sessions,
  } as unknown as NovelProjectExplorerProps
  render(<NovelProjectExplorer {...props} />)
  return props
}

/** Switch the tavern surface from the default chat view to the library tab. */
async function openLibrary(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
}

describe('tavern explorer surface', () => {
  it('renders the import box and the tree once the project tree loads', async () => {
    const api = tavernApi()
    renderTavern(api)

    await openLibrary()

    // The worldbook and character rows appear after the tree resolves.
    await waitFor(() => { expect(screen.getByText('剑冢设定')).toBeTruthy() })
    expect(screen.getAllByText('阿雅').length).toBeGreaterThan(0)
    // The import box is present: one character-card input, one worldbook input, paste area.
    expect(screen.getAllByText('Import').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Choose a character card file')).toBeTruthy()
    expect(screen.getByLabelText('Choose a worldbook file')).toBeTruthy()
    // One call from the chat view's card load + one from the library tree.
    expect(api.projectTree).toHaveBeenCalledTimes(2)
  })

  it('imports a worldbook pasted as JSON and reports success', async () => {
    const api = tavernApi()
    api.importWorldBook.mockResolvedValue(ok({ worldbook: { id: 'worldbook-2', name: '新世界书', entryCount: 2 } }))
    renderTavern(api)

    await openLibrary()

    const paste = await screen.findByLabelText('Or paste worldbook JSON')
    fireEvent.change(paste, { target: { value: '{"name":"新世界书","entries":[]}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(api.importWorldBook).toHaveBeenCalledWith({ content: '{"name":"新世界书","entries":[]}' })
    })
    await waitFor(() => { expect(screen.getByText('Worldbook imported: 新世界书')).toBeTruthy() })
    // The tree reloads after the mutation (plus the chat view's initial load).
    await waitFor(() => { expect(api.projectTree).toHaveBeenCalledTimes(3) })
  })

  it('surfaces a friendly explanation when a PNG card carries no chara chunk', async () => {
    const api = tavernApi()
    api.importCharacter.mockResolvedValue(fail('tavern: PNG character card carries no chara or ccv3 text chunk'))
    renderTavern(api)

    await openLibrary()

    const input = await screen.findByLabelText('Choose a character card file')
    const file = new File(['not-a-card'], 'card.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => { expect(api.importCharacter).toHaveBeenCalled() })
    const message = await screen.findByRole('alert')
    expect(message.textContent).toContain('缺少 chara/ccv3 数据')
  })

  it('deletes a worldbook from its detail pane and reloads the tree', async () => {
    const api = tavernApi()
    api.deleteWorldBook.mockResolvedValue(ok({}))
    renderTavern(api)

    await openLibrary()

    fireEvent.click(await screen.findByText('剑冢设定'))
    const deleteButton = await screen.findByText('Delete this worldbook')
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(api.deleteWorldBook).toHaveBeenCalledWith({ id: 'worldbook-1' })
    })
    await waitFor(() => { expect(screen.getByText('Worldbook deleted: 剑冢设定')).toBeTruthy() })
    await waitFor(() => { expect(api.projectTree).toHaveBeenCalledTimes(3) })
  })

  it('lists a character card\u2019s scripts (regex + helper) in its detail', async () => {
    const api = tavernApi()
    api.projectTree.mockResolvedValue(ok({
      worldbooks: [],
      characters: [{
        id: 'character-1',
        name: '阿雅',
        format: 'png',
        hasAvatar: false,
        extensions: {
          regex_scripts: [
            { scriptName: '正文美化', disabled: false, findRegex: '<now_plot>.*</now_plot>' },
            { scriptName: '旧版替换', disabled: true, findRegex: 'master/SFW' },
          ],
          tavern_helper: { scripts: [{ name: 'var_update', enabled: true }] },
        },
      }],
    }))
    renderTavern(api)

    await openLibrary()
    fireEvent.click((await screen.findAllByText('阿雅'))[0]!)

    // Two regex scripts + one helper, two enabled in total.
    expect(await screen.findByText('Scripts: 3 total (2 enabled)')).toBeTruthy()
    expect(screen.getByText('正文美化')).toBeTruthy()
    expect(screen.getByText('旧版替换')).toBeTruthy()
    expect(screen.getByText('var_update')).toBeTruthy()
  })

  it('names the bound session when a delete is blocked by a live binding', async () => {
    const api = tavernApi()
    api.deleteWorldBook.mockResolvedValue(fail('tavern: worldbook "worldbook-1" is still bound by session(s) session-abc'))
    renderTavern(api, {
      sessions: { ids: ['session-abc'], byId: { 'session-abc': { title: '测试会话' } } },
    })

    await openLibrary()

    fireEvent.click(await screen.findByText('剑冢设定'))
    fireEvent.click(await screen.findByText('Delete this worldbook'))

    const message = await screen.findByRole('alert')
    expect(message.textContent).toContain('测试会话')
    expect(message.textContent).toContain('Unbind')

    // The notice offers a jump into the chat view to unbind the session.
    fireEvent.click(await screen.findByRole('button', { name: 'Unbind it in chat' }))
    // The chat view opens (start-new-chat button becomes visible again).
    expect(await screen.findByRole('button', { name: 'Start new chat' })).toBeTruthy()
  })

  it('unbinds a session with an empty binding so bound items can be deleted', async () => {
    const api = tavernApi()
    api.setBinding.mockResolvedValue(ok({ binding: { mode: 'novel', worldbookIds: [], characterId: null } }))
    renderTavern(api, {
      sessions: { ids: ['session-abc'], byId: { 'session-abc': { title: '测试会话' } } },
      binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: 'character-1' },
    })

    await openLibrary()

    // Choose the bound session; the unbind button appears once the binding loads.
    fireEvent.change(await screen.findByLabelText('Select session'), { target: { value: 'session-abc' } })
    const unbindButton = await screen.findByText('Unbind')
    fireEvent.click(unbindButton)

    await waitFor(() => {
      expect(api.setBinding).toHaveBeenCalledWith({
        sessionId: 'session-abc',
        binding: { mode: 'novel', worldbookIds: [], characterId: null },
      })
    })
    await waitFor(() => { expect(screen.getByText('Binding removed.')).toBeTruthy() })
  })
})
