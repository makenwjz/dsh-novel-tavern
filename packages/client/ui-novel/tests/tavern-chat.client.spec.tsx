// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TavernChat } from '../src/client/TavernChat.tsx'
import type { TavernChatProps } from '../src/client/TavernChat.tsx'
import { en, type NovelLocaleKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

// jsdom does not implement scrollIntoView; the chat auto-scrolls on new rows.
beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = vi.fn() as never
  }
})

const t = ((key: NovelLocaleKey, params?: Record<string, unknown>): string => {
  const template = en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}) as TavernChatProps['t']

function ok<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

/** The fake api face the chat drives (tavern + sessions domains). */
function chatApi() {
  const api = {
    tavern: {
      listCharacters: vi.fn(),
      listWorldBooks: vi.fn(),
      binding: vi.fn(),
      characterImage: vi.fn(),
      startRoleplay: vi.fn(),
      stopRoleplay: vi.fn(),
      setBinding: vi.fn(),
      setGreeting: vi.fn(),
      importCharacter: vi.fn(),
      importWorldBook: vi.fn(),
      deleteCharacter: vi.fn(),
      deleteWorldBook: vi.fn(),
      projectTree: vi.fn(),
      lean: vi.fn(),
      setLean: vi.fn(),
      advanceStage: vi.fn(),
      scoreCharacter: vi.fn(),
      setWorldBookEntryEnabled: vi.fn(),
      setMvu: vi.fn(),
      setPersona: vi.fn(),
      importChat: vi.fn(),
      saveJailbreak: vi.fn(),
      listJailbreaks: vi.fn(),
      deleteJailbreak: vi.fn(),
      importPromptPreset: vi.fn(),
      listPromptPresets: vi.fn(),
      deletePromptPreset: vi.fn(),
    },
    sessions: {
      list: vi.fn(),
      create: vi.fn(),
      history: vi.fn(),
      prompt: vi.fn(),
    },
    workspace: {
      list: vi.fn(),
      archiveSession: vi.fn(),
    },
  }
  api.tavern.projectTree.mockResolvedValue(ok({
    worldbooks: [],
    characters: [{
      id: 'character-1',
      name: '阿雅',
      format: 'png',
      extensions: {},
      hasAvatar: true,
      greetings: ['你好，我是阿雅。'],
    }],
  }))
  api.tavern.listCharacters.mockResolvedValue(ok({ characters: [{ id: 'character-1', name: '阿雅', format: 'png' }] }))
  api.tavern.listWorldBooks.mockResolvedValue(ok({ worldbooks: [{ id: 'worldbook-1', name: '剑冢设定', entryCount: 1 }] }))
  api.tavern.characterImage.mockResolvedValue(ok({ bytesB64: 'aW1n' }))
  api.tavern.binding.mockResolvedValue(ok({ binding: null }))
  api.sessions.list.mockResolvedValue(ok({ items: [] }))
  api.sessions.history.mockResolvedValue(ok({ events: [] }))
  api.sessions.prompt.mockResolvedValue(ok({ accepted: true }))
  api.tavern.setGreeting.mockResolvedValue(ok({ appended: true }))
  api.tavern.listPromptPresets.mockResolvedValue(ok({ presets: [] }))
  api.tavern.listJailbreaks.mockResolvedValue(ok({ jailbreaks: [] }))
  api.tavern.setWorldBookEntryEnabled.mockResolvedValue(ok({ updated: true }))
  api.workspace.list.mockResolvedValue(ok({ items: [], archivedSessionIds: [] }))
  api.workspace.archiveSession.mockResolvedValue(ok({ archivedSessionIds: [] }))
  return api
}

function renderChat(api: ReturnType<typeof chatApi>, options: { onNeedLibrary?: () => void } = {}) {
  const props = {
    t,
    api: api as never,
    useSessions: () => ({ ids: [], byId: {} }),
    onNeedLibrary: options.onNeedLibrary ?? vi.fn(),
  } as unknown as TavernChatProps
  render(<TavernChat {...props} />)
  return props
}

describe('TavernChat', () => {
  it('lists tavern-bound sessions with the character name and opens the first one', async () => {
    const api = chatApi()
    api.tavern.binding.mockImplementation(async ({ sessionId }: { sessionId: string }) =>
      sessionId === 'session-1'
        ? ok({ binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: null, characterIds: ['character-1'] } })
        : ok({ binding: null }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false, projections: { asOfSeq: 0, values: { title: '阿雅的酒馆' } } },
      { sessionId: 'session-2', updatedAt: 2, running: false, blank: false },
    ] }))
    api.sessions.history.mockResolvedValue(ok({ events: [
      { event: { type: 'user/message', seq: 1, time: Date.now(), data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } } },
      { event: { type: 'assistant/message', seq: 2, time: Date.now(), data: { message: { content: [{ type: 'text', text: '欢迎登舰。' }] } } } },
    ] }))
    renderChat(api)

    await waitFor(() => { expect(screen.getAllByText('阿雅').length).toBeGreaterThan(0) })
    // The non-tavern session is hidden from the chat list.
    expect(screen.queryByText('session-2')).toBeNull()
    // The opened conversation shows both bubbles.
    await waitFor(() => { expect(screen.getByText('你好')).toBeTruthy() })
    expect(screen.getByText('欢迎登舰。')).toBeTruthy()
    expect(api.tavern.characterImage).toHaveBeenCalledWith({ id: 'character-1' })
  })

  it('start new chat creates a tavern session, binds the card, and opens it', async () => {
    const api = chatApi()
    api.sessions.create.mockResolvedValue(ok({ sessionId: 'session-new', agentPreset: 'tavern' }))
    api.tavern.startRoleplay.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: null, characterIds: ['character-1'] },
    }))
    renderChat(api)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Start new chat' }))[0]!)

    await waitFor(() => {
      expect(api.sessions.create).toHaveBeenCalledWith({ agentPreset: 'tavern' })
    })
    await waitFor(() => {
      expect(api.tavern.startRoleplay).toHaveBeenCalledWith({
        sessionId: 'session-new',
        characterIds: ['character-1'],
        worldbookIds: ['worldbook-1'],
      })
    })
    // The new conversation opens and greets.
    expect(screen.getByText('New conversation created; the character greets you first.')).toBeTruthy()
  })

  it('asks for a library import when no character card exists', async () => {
    const api = chatApi()
    api.tavern.projectTree.mockResolvedValue(ok({ worldbooks: [], characters: [] }))
    const onNeedLibrary = vi.fn()
    renderChat(api, { onNeedLibrary })

    fireEvent.click((await screen.findAllByRole('button', { name: 'Start new chat' }))[0]!)
    expect(onNeedLibrary).toHaveBeenCalled()
    expect(screen.getByText(/Import a character card/)).toBeTruthy()
  })

  it('sends a message and shows the reply after polling history', async () => {
    const api = chatApi()
    api.sessions.create.mockResolvedValue(ok({ sessionId: 'session-new' }))
    api.tavern.startRoleplay.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: [], characterId: null, characterIds: ['character-1'] },
    }))
    // History: the reply is visible from the first poll onward.
    api.sessions.history.mockResolvedValue(ok({ events: [
      { event: { type: 'user/message', seq: 10, time: Date.now(), data: { content: [{ type: 'text', text: '在吗' }], source: { kind: 'user' } } } },
      { event: { type: 'assistant/message', seq: 11, time: Date.now(), data: { message: { content: [{ type: 'text', text: '在，鹰已经就位。' }] } } } },
    ] }))
    renderChat(api)

    // Open a chat first.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Start new chat' }))[0]!)

    const input = await screen.findByLabelText('Type a message…')
    fireEvent.change(input, { target: { value: '在吗' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(api.sessions.prompt).toHaveBeenCalledWith({
        sessionId: 'session-new',
        mode: 'queue',
        content: [{ type: 'text', text: '在吗' }],
      })
    })

    // The poll loop lands the reply within a few seconds.
    await waitFor(() => { expect(screen.getByText('在，鹰已经就位。')).toBeTruthy() }, { timeout: 8000 })
  })

  it('deletes a conversation after confirmation and hides it from the list', async () => {
    const api = chatApi()
    api.tavern.binding.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: null, characterIds: ['character-1'] },
    }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false },
      { sessionId: 'session-2', updatedAt: 2, running: false, blank: false },
    ] }))
    api.workspace.archiveSession.mockResolvedValue(ok({ archivedSessionIds: ['session-1'] }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderChat(api)

    await waitFor(() => { expect(screen.getAllByText('阿雅').length).toBeGreaterThan(0) })

    // Two conversations exist; deleting one leaves one.
    expect(screen.getAllByRole('button', { name: /Delete the conversation/ })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /Delete the conversation/ })[0]!)

    await waitFor(() => {
      expect(api.workspace.archiveSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
    })
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByText('Conversation deleted.')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Delete the conversation/ })).toHaveLength(1)
    })
    confirmSpy.mockRestore()
  })

  it('unbinds the active chat from the pane header, freeing bound items', async () => {
    const api = chatApi()
    api.tavern.binding.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: null, characterIds: ['character-1'] },
    }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false },
    ] }))
    api.tavern.setBinding.mockResolvedValue(ok({
      binding: { mode: 'novel', worldbookIds: [], characterId: null },
    }))
    renderChat(api)

    // The chat opens automatically; unbind from the pane header.
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Unbind' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Unbind' }))

    await waitFor(() => {
      expect(api.tavern.setBinding).toHaveBeenCalledWith({
        sessionId: 'session-1',
        binding: { mode: 'novel', worldbookIds: [], characterId: null },
      })
    })
    // The conversation leaves the tavern list and the empty pane returns.
    await waitFor(() => { expect(screen.getByText(/No conversation yet/)).toBeTruthy() })
    expect(screen.queryByRole('button', { name: 'Unbind' })).toBeNull()
  })

  it('renders card HTML in a sandboxed frame and keeps plain messages as text', async () => {
    const api = chatApi()
    api.tavern.binding.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: ['worldbook-1'], characterId: null, characterIds: ['character-1'] },
    }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false },
    ] }))
    api.sessions.history.mockResolvedValue(ok({ events: [
      { event: { type: 'user/message', seq: 1, time: Date.now(), data: { content: [{ type: 'text', text: '<content>\n你好' }], source: { kind: 'user' } } } },
      { event: { type: 'assistant/message', seq: 2, time: Date.now(), data: { message: { content: [{ type: 'text', text: '<now_plot>\n睁开眼时，视野里是石砌天花板。<div class="box">背景</div>\n</now_plot>' }] } } } },
    ] }))
    renderChat(api)

    // Plain user text renders as a bubble (markup tags cleaned away).
    await waitFor(() => { expect(screen.getByText('你好')).toBeTruthy() })
    // The HTML-carrying message renders in the sandboxed frame.
    await waitFor(() => { expect(document.querySelector('iframe')).toBeTruthy() })
  })

  it('preloads the card greeting and applies its regex scripts to it', async () => {
    const api = chatApi()
    api.tavern.projectTree.mockResolvedValue(ok({
      worldbooks: [],
      characters: [{
        id: 'character-1',
        name: '阿雅',
        format: 'png',
        hasAvatar: true,
        extensions: {
          regex_scripts: [
            { scriptName: '正文美化', disabled: false, markdownOnly: true, findRegex: '<now_plot>', replaceString: '<div class="story">' },
            { scriptName: '封面', disabled: false, markdownOnly: true, findRegex: '</now_plot>', replaceString: '</div>' },
          ],
        },
        greetings: ['<now_plot>故事开场</now_plot>', '备用开场'],
      }],
    }))
    api.tavern.binding.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: [], characterId: null, characterIds: ['character-1'] },
    }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false },
    ] }))
    renderChat(api)

    // The greeting loads as the opening bubble, transformed by the card's scripts into HTML.
    await waitFor(() => { expect(document.querySelector('iframe[title="阿雅"]')).toBeTruthy() })
    const frame = document.querySelector('iframe[title="阿雅"]') as HTMLIFrameElement
    // The card's regex scripts turned the greeting's <now_plot> marker into markup.
    expect(frame.srcdoc).toContain('class="story"')
    expect(frame.srcdoc).toContain('故事开场')
    // The greeting picker offers both openings; switching shows the plain one.
    await waitFor(() => { expect(screen.getByLabelText('Pick an opening')).toBeTruthy() })
    fireEvent.change(screen.getByLabelText('Pick an opening'), { target: { value: '1' } })
    await waitFor(() => { expect(document.querySelector('iframe[title="阿雅"]')).toBeNull() })
    expect(screen.getByText('备用开场')).toBeTruthy()
  })

  it('writes the chosen opening into the session log before the first message', async () => {
    const api = chatApi()
    api.tavern.projectTree.mockResolvedValue(ok({
      worldbooks: [],
      characters: [{
        id: 'character-1', name: '阿雅', format: 'png', hasAvatar: true, extensions: {}, greetings: ['开场白一', '开场白二'],
      }],
    }))
    api.tavern.binding.mockResolvedValue(ok({
      binding: { mode: 'tavern', worldbookIds: [], characterId: null, characterIds: ['character-1'] },
    }))
    api.sessions.list.mockResolvedValue(ok({ items: [
      { sessionId: 'session-1', updatedAt: 1, running: false, blank: false },
    ] }))
    renderChat(api)

    // Switch to the second opening, then send the first message.
    const picker = await screen.findByLabelText('Pick an opening')
    fireEvent.change(picker, { target: { value: '1' } })
    const input = await screen.findByLabelText('Type a message…')
    fireEvent.change(input, { target: { value: '开始吧' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(api.tavern.setGreeting).toHaveBeenCalledWith({ sessionId: 'session-1', greeting: '开场白二' })
    })
    // The message is queued only after the opening lands.
    await waitFor(() => {
      expect(api.sessions.prompt).toHaveBeenCalledWith({
        sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: '开始吧' }],
      })
    })
    // The local preview bubble disappears once the opening is written.
    await waitFor(() => { expect(api.tavern.setGreeting).toHaveBeenCalled() })
    expect(screen.queryByText('开场白二')).toBeNull()
  })
})
