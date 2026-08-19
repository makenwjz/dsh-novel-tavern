/**
 * The fullscreen project surface, split into two separate modes:
 * - `novel`: the novel studio — world state, timeline, vows, decisions,
 *   chapter knowledge, manuscript drafts and the canon lorebook.
 * - `tavern`: the tavern — worldbooks with their entries, character cards with
 *   portrait images and extension scripts, plus the roleplay binding controls.
 * Each mode is opened by its own draggable floating seal.
 * @module @deepseek-ai/dsh-client-ui-novel/NovelProjectExplorer
 */

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { NovelWorkspaceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CharacterId, TavernBindingData, WorldBookId } from '@deepseek-ai/dsh-tavern/types'
import type { NovelWorkspaceTabInjected } from './NovelWorkspaceContent.tsx'
import type { FloatingSurfaceStore } from './explorer-store.ts'
import { TavernChat, cardScripts } from './TavernChat.tsx'
import css from './NovelProjectExplorer.module.css'

/** The injected explorer face: the novel read, the tavern API, and the surface mode. */
export interface NovelExplorerInjected extends NovelWorkspaceTabInjected {
  /** Which surface this registration renders. */
  readonly mode: 'novel' | 'tavern'
}

/** Full component props assembled by the shell-overlay slot renderer. */
export type NovelProjectExplorerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.novel'>
  & PropsStore<FloatingSurfaceStore>
  & InjectFace<NovelExplorerInjected>

/** One tavern worldbook node with its entries. */
type TavernWorldBookRow = { id: WorldBookId; name: string; entries: Array<{ keys: string[]; content: string; comment: string }> }

/** One tavern character node. */
type TavernCharacterRow = { id: CharacterId; name: string; format: 'json' | 'png'; extensions: Record<string, unknown>; hasAvatar: boolean }

/** The tavern tree payload. */
type TavernTree = { worldbooks: TavernWorldBookRow[]; characters: TavernCharacterRow[] }

/** The selected node. */
type Selection =
  | { readonly type: 'root' }
  | { readonly type: 'novel'; readonly section: string }
  | { readonly type: 'worldbook'; readonly book: TavernWorldBookRow }
  | { readonly type: 'character'; readonly character: TavernCharacterRow }

/** Load the tavern project tree through the connection's tavern API face. */
async function loadTavernTree(api: Pick<IApiClient, 'tavern'>): Promise<TavernTree> {
  const result = await api.tavern.projectTree({})
  if (!result.result.ok) throw new Error(result.result.error.message)
  return {
    worldbooks: result.result.value.worldbooks.map(book => ({
      id: book.id,
      name: book.name,
      entries: book.entries.map(entry => ({ keys: [...entry.keys], content: entry.content, comment: entry.comment })),
    })),
    characters: result.result.value.characters.map(character => ({
      id: character.id,
      name: character.name,
      format: character.format,
      extensions: character.extensions,
      hasAvatar: character.hasAvatar,
    })),
  }
}

/** Map raw tavern errors to human explanations the browser user can act on. */
function friendlyTavernError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes('carries no chara or ccv3 text chunk')) {
    return '这个 PNG 不是带元数据的 SillyTavern 角色卡（缺少 chara/ccv3 数据）。请在 SillyTavern 里用“角色卡图片”导出，或改用 JSON 卡导入。'
  }
  if (message.includes('is not valid JSON')) {
    return '导入内容不是有效的 JSON。'
  }
  if (message.includes('must carry a non-empty name')) {
    return '角色卡缺少角色名。'
  }
  if (message.includes('still bound by session')) {
    return '该项目仍被会话绑定，无法删除。请先在酒馆面板停止对应会话的扮演。'
  }
  if (message.includes('content is not valid JSON')) {
    return '世界书内容不是有效的 JSON。'
  }
  return message
}

/** Render the tavern surface. */
export function NovelProjectExplorer({ useStore, actions, read, api, useSessions, t, mode }: NovelProjectExplorerProps): ReactNode {
  const open = useStore(state => state.open)
  const [selection, setSelection] = useState<Selection>({ type: 'root' })
  const [novel, setNovel] = useState<NovelWorkspaceSnapshot | null>(null)
  const [tree, setTree] = useState<TavernTree | null>(null)
  const [error, setError] = useState('')
  const [avatar, setAvatar] = useState<Record<string, string>>({})
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)
  // Tavern mode starts on the WeChat-style chat; the library stays one tab away.
  const [tavernView, setTavernView] = useState<'chat' | 'library'>('chat')

  // Tavern roleplay binding controls (tavern mode only).
  const sessions = useSessions(state => state)
  const [sessionId, setSessionId] = useState('')
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [binding, setBinding] = useState<TavernBindingData | null>(null)

  // Tavern import/delete state (tavern mode only).
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string; boundSessionIds?: string[] } | null>(null)
  const [worldBookDraft, setWorldBookDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // Session to open in the chat view when a blocked delete jumps there.
  const [focusSession, setFocusSession] = useState('')

  useEffect(() => {
    if (!open) return
    let current = true
    const load = mode === 'novel' ? read() : loadTavernTree(api)
    void load.then(
      (value) => {
        if (!current) return
        if (mode === 'novel') setNovel(value as NovelWorkspaceSnapshot)
        else setTree(value as TavernTree)
      },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { current = false }
  }, [open, mode, read, api, reloadKey])

  useEffect(() => {
    let current = true
    if (sessionId === '') {
      setBinding(null)
      return
    }
    void api.tavern.binding({ sessionId: sessionId as never }).then(
      (result) => {
        const r = result.result
        if (current && r.ok) setBinding(r.value.binding)
      },
      () => { if (current) setBinding(null) },
    )
    return () => { current = false }
  }, [sessionId, api, open, reloadKey])

  if (!open) return null

  /** Load one character's portrait image lazily on selection. */
  const selectCharacter = (character: TavernCharacterRow): void => {
    setSelection({ type: 'character', character })
    if (character.hasAvatar && avatar[character.id] === undefined) {
      void api.tavern.characterImage({ id: character.id }).then((result) => {
        const r = result.result
        if (!r.ok) return
        setAvatar(previous => ({ ...previous, [character.id]: r.value.bytesB64 }))
      })
    }
  }

  const runRoleplay = (action: () => Promise<void>): void => {
    void action().catch(() => { /* binding reloads via the session effect */ })
    setBinding(null)
  }

  /** Fully unbind one session (characters and worldbooks), freeing bound items for deletion. */
  const unbindSession = (): void => {
    if (sessionId === '' || busy) return
    setBusy(true)
    setNotice(null)
    void api.tavern.setBinding({
      sessionId: sessionId as never,
      binding: { mode: 'novel', worldbookIds: [], characterId: null },
    }).then((result) => {
      const r = result.result
      if (!r.ok) {
        fail(new Error(r.error.message))
      } else {
        setBinding(null)
        setNotice({ kind: 'success', text: t('unbound') })
        reloadTavern()
      }
      setBusy(false)
    }, fail)
  }

  /** Surface one tavern mutation failure with the raw reason. */
  const fail = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const boundMatch = message.match(/still bound by session\(s\) (.+)$/)
    if (boundMatch !== null && boundMatch[1] !== undefined) {
      const ids = boundMatch[1].split(',').map(id => id.trim())
      const names = ids.map(id => sessions.byId[id as never]?.title ?? id).join('、')
      setNotice({ kind: 'error', text: t('deleteBlockedBound', { names }), boundSessionIds: ids })
      return
    }
    setNotice({ kind: 'error', text: t('importFailed', { reason: friendlyTavernError(reason) }) })
  }

  /** Reload the tavern tree after an import/delete mutation. */
  const reloadTavern = (): void => {
    setReloadKey(value => value + 1)
  }

  /** Import a character card file (.png card or .json) as base64. */
  const onCharacterFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || busy) return
    setBusy(true)
    setNotice(null)
    const reader = new FileReader()
    reader.onload = () => {
      const bytesB64 = String(reader.result ?? '').split(',')[1] ?? ''
      void api.tavern.importCharacter({ fileName: file.name, bytesB64 }).then((result) => {
        const r = result.result
        if (!r.ok) {
          fail(new Error(r.error.message))
        } else {
          setNotice({ kind: 'success', text: t('importCharacterOk', { name: r.value.character.name }) })
          reloadTavern()
        }
        setBusy(false)
      }, fail)
    }
    reader.readAsDataURL(file)
  }

  /** Run the worldbook import RPC and fold the result into state. */
  const importWorldBookText = (content: string): void => {
    void api.tavern.importWorldBook({ content }).then((result) => {
      const r = result.result
      if (!r.ok) {
        fail(new Error(r.error.message))
      } else {
        setWorldBookDraft('')
        setNotice({ kind: 'success', text: t('importWorldBookOk', { name: r.value.worldbook.name }) })
        reloadTavern()
      }
      setBusy(false)
    }, fail)
  }

  /** Import a worldbook .json file. */
  const onWorldBookFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || busy) return
    setBusy(true)
    setNotice(null)
    const reader = new FileReader()
    reader.onload = () => {
      void importWorldBookText(String(reader.result ?? ''))
    }
    reader.readAsText(file)
  }

  /** Import worldbook JSON from pasted text. */
  const importWorldBookDraft = (): void => {
    if (worldBookDraft.trim().length === 0 || busy) return
    setBusy(true)
    setNotice(null)
    void importWorldBookText(worldBookDraft)
  }

  /** Delete one worldbook, failing loud while a session still binds it. */
  const deleteWorldBook = (id: WorldBookId, name: string): void => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void api.tavern.deleteWorldBook({ id }).then((result) => {
      const r = result.result
      if (!r.ok) {
        fail(new Error(r.error.message))
      } else {
        setNotice({ kind: 'success', text: t('deletedWorldBook', { name }) })
        setSelection({ type: 'root' })
        reloadTavern()
      }
      setBusy(false)
    }, fail)
  }

  /** Delete one character card, failing loud while a session still binds it. */
  const deleteCharacter = (id: CharacterId, name: string): void => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void api.tavern.deleteCharacter({ id }).then((result) => {
      const r = result.result
      if (!r.ok) {
        fail(new Error(r.error.message))
      } else {
        setNotice({ kind: 'success', text: t('deletedCharacter', { name }) })
        setSelection({ type: 'root' })
        reloadTavern()
      }
      setBusy(false)
    }, fail)
  }

  const novelSections: Array<{ key: string; label: string; count: number; render: () => ReactNode }> = novel === null ? [] : [
    {
      key: 'world', label: t('world'), count: novel.world.subjects.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.world.subjects.map(subject => (
            <li key={subject.id} className={css.detailItem}>
              <strong>{subject.name}</strong><span>{subject.summary}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'timeline', label: t('timeline'), count: novel.events.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.events.map(event => (
            <li key={event.id} className={css.detailItem}>
              <strong>{event.storyTime} · {event.title}</strong><span>{event.summary}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'vows', label: t('vows'), count: novel.vows.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.vows.map(vow => (
            <li key={vow.id} className={css.detailItem}>
              <strong>{vow.title}</strong><span>{vow.promise}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'decisions', label: t('decisions'), count: novel.decisions.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.decisions.map(decision => (
            <li key={decision.id} className={css.detailItem}>
              <strong>{decision.context}</strong><span>{decision.rationale}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'chapters', label: t('chapters'), count: novel.chapters.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.chapters.map(chapter => (
            <li key={chapter.number} className={css.detailItem}>
              <strong>{t('chapterNumber', { number: chapter.number })}{chapter.title.length === 0 ? '' : ` · ${chapter.title}`}</strong>
              <span>{chapter.readerKnows}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'manuscript', label: t('manuscript'), count: novel.manuscript.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.manuscript.map(chapter => (
            <li key={chapter.number} className={css.entryCard}>
              <strong>{t('chapterNumber', { number: chapter.number })}{chapter.title.length === 0 ? '' : ` · ${chapter.title}`}</strong>
              <p>{chapter.content}</p>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'lore', label: t('lore'), count: novel.lore.length,
      render: () => (
        <ul className={css.detailList}>
          {novel.lore.map(entry => (
            <li key={entry.id} className={css.entryCard}>
              <strong>{entry.category} · {entry.title}</strong>
              <p>{entry.content}</p>
            </li>
          ))}
        </ul>
      ),
    },
  ]

  const renderNovelDetail = (): ReactNode => {
    if (selection.type !== 'novel') return <p className={css.hint}>{t('explorerNovelHint')}</p>
    const section = novelSections.find(candidate => candidate.key === selection.section)
    if (section === undefined) return <p className={css.hint}>{t('explorerNovelHint')}</p>
    return <div><h4 className={css.detailTitle}>{section.label}</h4>{section.render()}</div>
  }

  const renderTavernDetail = (): ReactNode => {
    if (selection.type === 'root') return <p className={css.hint}>{t('explorerHint')}</p>
    if (selection.type === 'worldbook') {
      const { book } = selection
      return (
        <div>
          <h4 className={css.detailTitle}>{book.name}</h4>
          <button type="button" className={css.dangerButton} onClick={() => deleteWorldBook(book.id, book.name)}>
            {t('deleteWorldBookAction')}
          </button>
          <ul className={css.detailList}>
            {book.entries.map((entry, index) => (
              <li key={index} className={css.entryCard}>
                <strong>{entry.keys.length > 0 ? entry.keys.join('、') : t('entryNoKeys')}</strong>
                {entry.comment.length === 0 ? null : <span className={css.muted}>{entry.comment}</span>}
                <p>{entry.content}</p>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    if (selection.type !== 'character') return <p className={css.hint}>{t('explorerHint')}</p>
    const { character } = selection
    const scripts = cardScripts(character.extensions)
    const enabledScripts = scripts.filter(script => script.enabled).length
    return (
      <div>
        <h4 className={css.detailTitle}>{character.name}</h4>
        {avatar[character.id] === undefined ? null : (
          <img className={css.avatar} src={`data:image/png;base64,${avatar[character.id]}`} alt={character.name} />
        )}
        <p className={css.muted}>{character.format}{character.hasAvatar ? ` · ${t('hasAvatar')}` : ''}</p>
        <button type="button" className={css.dangerButton} onClick={() => deleteCharacter(character.id, character.name)}>
          {t('deleteCharacterAction')}
        </button>
        {scripts.length === 0 ? null : (
          <div className={css.scriptBox}>
            <h5 className={css.detailTitle}>{t('cardScripts', { count: scripts.length, enabled: enabledScripts })}</h5>
            <ul className={css.detailList}>
              {scripts.map((script, index) => (
                <li key={index} className={css.detailItem}>
                  <strong>{script.name}</strong>
                  <span>
                    {script.kind === 'regex' ? t('scriptRegex') : t('scriptHelper')} · {script.enabled ? t('scriptEnabled') : t('scriptDisabled')}
                    {script.kind === 'regex' && script.findRegex.length > 0 ? ` · /${script.findRegex.slice(0, 48)}…` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Object.keys(character.extensions).length === 0 ? null : (
          <pre className={css.extensions}>{JSON.stringify(character.extensions, null, 2)}</pre>
        )}
      </div>
    )
  }

  return (
    <div className={mode === 'tavern' ? `${css.explorer} ${css.tavernAccent}` : css.explorer} role="dialog" aria-label={t(mode === 'tavern' ? 'tavernTab' : 'tab')}>
      <header className={css.header}>
        <h2 className={css.title}>{t(mode === 'tavern' ? 'tavernTab' : 'tab')}</h2>
        {mode === 'tavern' ? (
          <nav className={css.headerTabs} aria-label={t('tavernTab')}>
            <button
              type="button"
              className={tavernView === 'chat' ? `${css.headerTab} ${css.headerTabActive}` : css.headerTab}
              onClick={() => setTavernView('chat')}
            >
              {t('chatView')}
            </button>
            <button
              type="button"
              className={tavernView === 'library' ? `${css.headerTab} ${css.headerTabActive}` : css.headerTab}
              onClick={() => setTavernView('library')}
            >
              {t('libraryView')}
            </button>
          </nav>
        ) : null}
        <button type="button" className={css.close} aria-label={t('closeExplorer')} onClick={() => actions.toggle()}>✕</button>
      </header>
      {error.length === 0 ? null : <p className={css.failure} role="alert">{error}</p>}
      {notice === null ? null : (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? css.failure : css.notice}>
          <span>{notice.text}</span>
          {notice.boundSessionIds !== undefined && notice.boundSessionIds.length > 0 ? (
            <button
              type="button"
              className={css.noticeAction}
              onClick={() => {
                setFocusSession(notice.boundSessionIds![0] ?? '')
                setTavernView('chat')
              }}
            >
              {t('goUnbind')}
            </button>
          ) : null}
        </div>
      )}
      {mode === 'tavern' && tavernView === 'chat' ? (
        <TavernChat api={api} t={t} useSessions={useSessions} onNeedLibrary={() => setTavernView('library')} focusSession={focusSession} />
      ) : (
        <div className={css.body}>
          <nav className={css.tree} aria-label={t('explorerTree')}>
            {mode === 'novel' ? (
              <>
                <button type="button" className={css.treeGroupTitle} onClick={() => setSelection({ type: 'novel', section: '' })}>
                  <span className={css.treeMarker}>🖋</span>{t('tab')}
                </button>
                {novelSections.map(section => (
                  <button key={section.key} type="button" className={css.treeItem} onClick={() => setSelection({ type: 'novel', section: section.key })}>
                    <span className={css.treeCount}>{section.count}</span>{section.label}
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className={css.treeGroupTitle}><span className={css.treeMarker}>🍺</span>{t('tavernTab')}</div>
                {tree === null ? null : (
                  <>
                    {tree.worldbooks.map(book => (
                      <div key={book.id}>
                        <button type="button" className={css.treeItem} onClick={() => {
                          const next = new Set(expandedBooks)
                          if (next.has(book.id)) next.delete(book.id)
                          else next.add(book.id)
                          setExpandedBooks(next)
                          setSelection({ type: 'worldbook', book })
                        }}>
                          <span className={css.treeMarker}>{expandedBooks.has(book.id) ? '▾' : '▸'}</span>
                          <span className={css.treeLabel}>{book.name}</span>
                          <span className={css.treeCount}>{book.entries.length}</span>
                        </button>
                      </div>
                    ))}
                    {tree.characters.map(character => (
                      <button key={character.id} type="button" className={css.treeItem} onClick={() => selectCharacter(character)}>
                        <span className={css.treeMarker}>🧑</span>
                        <span className={css.treeLabel}>{character.name}</span>
                        <span className={css.treeCount}>{character.format}</span>
                      </button>
                    ))}
                  </>
                )}
                <div className={css.importBox}>
                  <h4 className={css.detailTitle}>{t('importSection')}</h4>
                  <label className={css.fileRow}>
                    <span className={css.treeLabel}>{t('importCharacter')}</span>
                    <input
                      type="file"
                      accept=".png,.json"
                      aria-label={t('importCharacterFile')}
                      disabled={busy}
                      onChange={onCharacterFile}
                    />
                  </label>
                  <p className={css.status}>{t('importCharacterHint')}</p>
                  <label className={css.fileRow}>
                    <span className={css.treeLabel}>{t('importWorldBook')}</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      aria-label={t('importWorldBookFile')}
                      disabled={busy}
                      onChange={onWorldBookFile}
                    />
                  </label>
                  <p className={css.status}>{t('importWorldBookHint')}</p>
                  <textarea
                    className={css.pasteArea}
                    aria-label={t('importWorldBookPaste')}
                    placeholder={t('importWorldBookPaste')}
                    value={worldBookDraft}
                    disabled={busy}
                    onChange={event => setWorldBookDraft(event.target.value)}
                  />
                  <button type="button" className={css.actionButton} disabled={busy} onClick={importWorldBookDraft}>
                    {busy ? t('importing') : t('importAction')}
                  </button>
                </div>
                <div className={css.roleplay}>
                  <h4 className={css.detailTitle}>{t('startRoleplay')}</h4>
                  <select aria-label={t('selectSession')} value={sessionId} onChange={event => setSessionId(event.target.value)}>
                    <option value="">{t('chooseSession')}</option>
                    {sessions.ids.map(id => (
                      <option key={id} value={id}>{sessions.byId[id]?.title ?? t('sessionTitle')}</option>
                    ))}
                  </select>
                  <div className={css.characterPicker}>
                    {tree?.characters.map(character => (
                      <label key={character.id} className={css.pickRow}>
                        <input
                          type="checkbox"
                          checked={characterIds.includes(character.id)}
                          onChange={() => setCharacterIds(current =>
                            current.includes(character.id)
                              ? current.filter(id => id !== character.id)
                              : [...current, character.id])}
                        />
                        <span className={css.treeLabel}>{character.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className={css.roleplayActions}>
                    <button type="button" className={css.actionButton} onClick={() => runRoleplay(() => api.tavern.startRoleplay({
                      sessionId: sessionId as never,
                      characterIds: characterIds as never,
                      worldbookIds: tree?.worldbooks.map(book => book.id) ?? [],
                    }).then((result) => { if (!result.result.ok) throw new Error(result.result.error.message) }))}>
                      {t('startRoleplay')}
                    </button>
                    <button type="button" className={css.actionButton} onClick={() => runRoleplay(() => api.tavern.stopRoleplay({
                      sessionId: sessionId as never,
                    }).then((result) => { if (!result.result.ok) throw new Error(result.result.error.message) }))}>
                      {t('stopRoleplay')}
                    </button>
                    {binding === null ? null : (
                      <button type="button" className={css.actionButton} disabled={busy} onClick={unbindSession}>
                        {t('unbind')}
                      </button>
                    )}
                  </div>
                  {sessionId === '' || binding === null ? null : (
                    <>
                      <p className={css.status}>
                        {binding.mode === 'tavern'
                          ? t('boundSummary', {
                            characters: (binding.characterIds ?? (binding.characterId === null ? [] : [binding.characterId]))
                              .map(id => tree?.characters.find(card => card.id === id)?.name ?? id)
                              .join('、') || t('noBoundDetail'),
                            books: binding.worldbookIds
                              .map(id => tree?.worldbooks.find(book => book.id === id)?.name ?? id)
                              .join('、') || t('noBoundWorldbooks'),
                          })
                          : t('boundNovel')}
                      </p>
                      <p className={css.status}>{t('unbindHint')}</p>
                    </>
                  )}
                  <p className={css.status}>{t('roleplayHint')}</p>
                </div>
              </>
            )}
          </nav>
          <section className={css.detail} aria-label={t('explorerDetail')}>
            {mode === 'novel' ? renderNovelDetail() : renderTavernDetail()}
          </section>
        </div>
      )}
    </div>
  )
}
