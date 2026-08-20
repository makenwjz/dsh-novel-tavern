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
import { cardScripts } from './TavernChat.tsx'
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
type TavernWorldBookRow = { id: WorldBookId; name: string; entries: Array<{ name: string; keys: string[]; content: string; comment: string; enabled: boolean }> }

/** One tavern character node. */
type TavernCharacterRow = { id: CharacterId; name: string; format: 'json' | 'png'; extensions: Record<string, unknown>; hasAvatar: boolean; description: string; personality: string; scenario: string; mesExample: string; tags: string[]; greetings: string[] }

/** One script row across the card collection (regex or helper). */
type ScriptRow = { name: string; kind: 'regex' | 'helper'; enabled: boolean; findRegex: string; replaceString: string; markdownOnly: boolean; promptOnly: boolean; card: string; characterId: string }

/** The tavern tree payload. */
type TavernTree = { worldbooks: TavernWorldBookRow[]; characters: TavernCharacterRow[] }

/** The selected node. */
type Selection =
  | { readonly type: 'root' }
  | { readonly type: 'novel'; readonly section: string }
  | { readonly type: 'worldbook'; readonly book: TavernWorldBookRow }
  | { readonly type: 'character'; readonly character: TavernCharacterRow }
  | { readonly type: 'script'; readonly script: { readonly name: string; readonly kind: 'regex' | 'helper'; readonly enabled: boolean; readonly findRegex: string; readonly replaceString: string; readonly markdownOnly: boolean; readonly promptOnly: boolean; readonly card: string; readonly characterId: string } }
  | { readonly type: 'preset'; readonly preset: { readonly id: string; readonly name: string; readonly promptCount: number; readonly enabledCount: number } }
  | { readonly type: 'jailbreak'; readonly jailbreak: { readonly id: string; readonly name: string; readonly content: string } }

/** The inline worldbook-entry editor (add or update). */
function EntryEditor({ initial, onSave, onCancel, busy }: {
  initial: { name: string; keys: string[]; content: string; comment: string; enabled: boolean } | null
  onSave: (fields: { name: string; keys?: string[]; content?: string; comment?: string; enabled?: boolean }) => void
  onCancel: () => void
  busy: boolean
}): ReactNode {
  return (
    <div className={css.entryEditor}>
      <input className={css.charEditArea} aria-label="entry-name" defaultValue={initial?.name ?? ''} placeholder="条目名" />
      <input className={css.charEditArea} aria-label="entry-keys" defaultValue={initial?.keys.join('、') ?? ''} placeholder="关键词（顿号分隔）" />
      <input className={css.charEditArea} aria-label="entry-comment" defaultValue={initial?.comment ?? ''} placeholder="备注（可选）" />
      <textarea className={css.charEditArea} aria-label="entry-content" defaultValue={initial?.content ?? ''} placeholder="条目内容" rows={4} />
      <div className={css.entryEditorActions}>
        <button
          type="button"
          className={css.actionButton}
          disabled={busy}
          onClick={event => {
            const root = (event.target as HTMLButtonElement).parentElement
            const name = (root?.querySelector('input[aria-label="entry-name"]') as HTMLInputElement | null)?.value ?? ''
            const keys = (root?.querySelector('input[aria-label="entry-keys"]') as HTMLInputElement | null)?.value.split(/[、,，\s]+/).filter(Boolean) ?? []
            const comment = (root?.querySelector('input[aria-label="entry-comment"]') as HTMLInputElement | null)?.value ?? ''
            const content = (root?.querySelector('textarea[aria-label="entry-content"]') as HTMLTextAreaElement | null)?.value ?? ''
            onSave({ name, keys, content, comment, enabled: initial?.enabled ?? true })
          }}
        >
          保存条目
        </button>
        <button type="button" className={css.miniButton} disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

/** Load the tavern project tree through the connection's tavern API face. */
async function loadTavernTree(api: Pick<IApiClient, 'tavern'>): Promise<TavernTree> {
  const result = await api.tavern.projectTree({})
  if (!result.result.ok) throw new Error(result.result.error.message)
  return {
    worldbooks: result.result.value.worldbooks.map(book => ({
      id: book.id,
      name: book.name,
      entries: book.entries.map(entry => ({ name: entry.name, keys: [...entry.keys], content: entry.content, comment: entry.comment, enabled: entry.enabled })),
    })),
    characters: result.result.value.characters.map(character => ({
      id: character.id,
      name: character.name,
      format: character.format,
      extensions: character.extensions,
      hasAvatar: character.hasAvatar,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      mesExample: character.mesExample,
      tags: [...character.tags],
      greetings: [...character.greetings],
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
  const [reloadKey, setReloadKey] = useState(0)

  // Tavern roleplay binding controls (tavern mode only).
  const sessions = useSessions(state => state)
  const [sessionId, setSessionId] = useState('')
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [binding, setBinding] = useState<TavernBindingData | null>(null)

  // Tavern import/delete state (tavern mode only).
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string; boundSessionIds?: string[] } | null>(null)
  const [worldBookDraft, setWorldBookDraft] = useState('')
  const [presetDraft, setPresetDraft] = useState('')
  /** AI-jailbreak presets (破限), managed in the 预设 rail. */
  const [jailbreaks, setJailbreaks] = useState<Array<{ id: string; name: string; content: string }>>([])
  const [wbQuery, setWbQuery] = useState('')
  /** The worldbook entry being edited inline, or null. */
  const [wbEditing, setWbEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The active leftmost rail section in the three-column library. */
  const [rail, setRail] = useState<'characters' | 'worldbooks' | 'scripts' | 'presets' | 'settings'>('characters')

  useEffect(() => {
    if (!open) return
    let current = true
    const load = mode === 'novel' ? read() : loadTavernTree(api)
    void load.then(
      (value) => {
        if (!current) return
        if (mode === 'novel') setNovel(value as NovelWorkspaceSnapshot)
        else {
          setTree(value as TavernTree)
          reloadJailbreaks()
        }
      },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Worldbooks related to one character (the card's own name embedded in the
   *  worldbook name), so picking a card also picks its lore. */
  const relatedWorldbooks = (character: TavernCharacterRow): TavernWorldBookRow[] => {
    if (tree === null) return []
    return tree.worldbooks.filter(book => book.name.includes(character.name) || character.name.includes(book.name.replace(/\.\d+$/, '')))
  }

  /** Save one character's editor fields through the sidecar override. */
  const updateCharacterFields = (character: TavernCharacterRow, fields: { name?: string; description?: string; personality?: string; scenario?: string; mesExample?: string }): void => {
    if (busy) return
    setBusy(true)
    void api.tavern.updateCharacter({ id: character.id, ...fields }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
        setBusy(false)
        return
      }
      setNotice({ kind: 'success', text: t('characterSaved') })
      setBusy(false)
      reloadTavern()
    }, (reason: unknown) => {
      setNotice({ kind: 'error', text: t('importFailed', { reason: reason instanceof Error ? reason.message : String(reason) }) })
      setBusy(false)
    })
  }

  /** Start a tavern chat with one character and its related worldbooks: bind,
   *  write the opening greeting into the session, then open the chat surface. */
  const startChatWithCharacter = (character: TavernCharacterRow): void => {
    if (busy || sessionId === '') {
      setNotice({ kind: 'error', text: t('chooseSession') })
      return
    }
    const books = relatedWorldbooks(character)
    const greeting = character.greetings[0] ?? ''
    runRoleplay(() => api.tavern.startRoleplay({
      sessionId: sessionId as never,
      characterIds: [character.id] as never,
      worldbookIds: books.map(book => book.id) as never,
    }).then((result) => {
      if (!result.result.ok) throw new Error(result.result.error.message)
      if (greeting.length === 0) return
      return api.tavern.setGreeting({ sessionId: sessionId as never, greeting }).then((greetingResult) => {
        if (!greetingResult.result.ok) throw new Error(greetingResult.result.error.message)
      })
    }).then(() => {
      actions.openView('chat')
    }))
  }

  /** All regex/helper scripts across every imported card, for the rail list. */
  const allScripts = (): ScriptRow[] => {
    const rows: ScriptRow[] = []
    for (const character of tree?.characters ?? []) {
      for (const script of cardScripts(character.extensions)) {
        rows.push({
          name: script.name,
          kind: script.kind,
          enabled: script.enabled,
          findRegex: script.findRegex,
          replaceString: script.replaceString,
          markdownOnly: script.markdownOnly,
          promptOnly: false,
          card: character.name,
          characterId: character.id,
        })
      }
    }
    return rows
  }

  /** Save a worldbook entry (add or update) from the inline editor. */
  const saveEntry = (bookId: string, fields: { name: string; keys?: string[]; content?: string; comment?: string; enabled?: boolean }): void => {
    if (busy) return
    setBusy(true)
    void api.tavern.saveWorldBookEntry({ id: bookId as never, ...fields }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
      } else {
        setNotice({ kind: 'success', text: t('entrySaved') })
        setWbEditing(null)
      }
      setBusy(false)
      reloadTavern()
    }, (reason: unknown) => {
      setNotice({ kind: 'error', text: t('importFailed', { reason: reason instanceof Error ? reason.message : String(reason) }) })
      setBusy(false)
    })
  }

  /** Delete one worldbook entry. */
  const deleteEntry = (bookId: string, name: string): void => {
    if (busy) return
    setBusy(true)
    void api.tavern.deleteWorldBookEntry({ id: bookId as never, name }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
      } else {
        setNotice({ kind: 'success', text: t('entryDeleted') })
      }
      setBusy(false)
      reloadTavern()
    }, (reason: unknown) => {
      setNotice({ kind: 'error', text: t('importFailed', { reason: reason instanceof Error ? reason.message : String(reason) }) })
      setBusy(false)
    })
  }

  /** The runRoleplay helper for the settings rail. */
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

  /** Refresh the jailbreak (破限) preset list. */
  const reloadJailbreaks = (): void => {
    void api.tavern.listJailbreaks({}).then((result) => {
      if (result.result.ok) {
        setJailbreaks(result.result.value.jailbreaks.map(jailbreak => ({ id: jailbreak.id, name: jailbreak.name, content: jailbreak.content })))
      }
    }, () => {})
  }

  /** Create or update one jailbreak preset. */
  const saveJailbreakPreset = (id: string | undefined, name: string, content: string): void => {
    if (busy) return
    setBusy(true)
    void api.tavern.saveJailbreak({ ...(id === undefined ? {} : { id: id as never }), name, content }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
        setBusy(false)
        return
      }
      setNotice({ kind: 'success', text: t('jailbreakSaved') })
      setBusy(false)
      reloadJailbreaks()
    }, (reason: unknown) => {
      setNotice({ kind: 'error', text: t('importFailed', { reason: reason instanceof Error ? reason.message : String(reason) }) })
      setBusy(false)
    })
  }

  /** Delete one jailbreak preset. */
  const deleteJailbreakPreset = (id: string, name: string): void => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void api.tavern.deleteJailbreak({ id: id as never }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
      } else {
        setNotice({ kind: 'success', text: t('jailbreakDeleted', { name }) })
        setSelection({ type: 'root' })
      }
      setBusy(false)
      reloadJailbreaks()
    }, (reason: unknown) => {
      setNotice({ kind: 'error', text: t('importFailed', { reason: reason instanceof Error ? reason.message : String(reason) }) })
      setBusy(false)
    })
  }

  /** Import a jailbreak (破限) preset from a text file. */
  const onJailbreakFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || busy) return
    setBusy(true)
    setNotice(null)
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      const name = file.name.replace(/\.(txt|json|md)$/i, '') || '导入的破限'
      saveJailbreakPreset(undefined, name, content)
    }
    reader.readAsText(file)
  }

  /** Run the prompt-preset import RPC and fold the result into state. */
  const importPresetText = (content: string): void => {
    void api.tavern.importPromptPreset({ content }).then((result) => {
      const r = result.result
      if (!r.ok) {
        fail(new Error(r.error.message))
      } else {
        setPresetDraft('')
        setNotice({ kind: 'success', text: t('importPresetOk', { name: r.value.preset.name, count: r.value.preset.promptCount }) })
      }
      setBusy(false)
    }, fail)
  }

  /** Import a prompt preset .json file. */
  const onPresetFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || busy) return
    setBusy(true)
    setNotice(null)
    const reader = new FileReader()
    reader.onload = () => {
      void importPresetText(String(reader.result ?? ''))
    }
    reader.readAsText(file)
  }

  /** Import preset JSON from pasted text. */
  const importPresetDraft = (): void => {
    if (presetDraft.trim().length === 0 || busy) return
    setBusy(true)
    setNotice(null)
    void importPresetText(presetDraft)
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

  /** Column 2 of the library: the list of the active rail section. */
  const renderRailList = (): ReactNode => {
    if (tree === null) return <p className={css.hint}>{t('loading')}</p>
    if (rail === 'characters') {
      return (
        <div className={css.railListInner}>
          <h4 className={css.railListTitle}>{t('railCharacters')}</h4>
          {tree.characters.length === 0 ? <p className={css.muted}>{t('libraryEmptyCharacters')}</p> : null}
          {tree.characters.map(character => {
            const active = selection.type === 'character' && selection.character.id === character.id
            return (
              <button key={character.id} type="button" className={active ? `${css.railCard} ${css.railCardActive}` : css.railCard} onClick={() => selectCharacter(character)}>
                {avatar[character.id] === undefined
                  ? <span className={css.railCardAvatarFallback}>{character.name.slice(0, 1) || '🎭'}</span>
                  : <img className={css.railCardAvatar} src={`data:image/png;base64,${avatar[character.id]}`} alt={character.name} />}
                <span className={css.railCardMeta}>
                  <strong>{character.name}</strong>
                  <span className={css.muted}>{character.format}{relatedWorldbooks(character).length > 0 ? ` · 📚${relatedWorldbooks(character).length}` : ''}</span>
                </span>
              </button>
            )
          })}
        </div>
      )
    }
    if (rail === 'worldbooks') {
      return (
        <div className={css.railListInner}>
          <h4 className={css.railListTitle}>{t('railWorldbooks')}</h4>
          {tree.worldbooks.length === 0 ? <p className={css.muted}>{t('libraryEmptyWorldbooks')}</p> : null}
          {tree.worldbooks.map(book => {
            const active = selection.type === 'worldbook' && selection.book.id === book.id
            return (
              <button key={book.id} type="button" className={active ? `${css.railCard} ${css.railCardActive}` : css.railCard} onClick={() => setSelection({ type: 'worldbook', book })}>
                <span className={css.railCardIcon}>📚</span>
                <span className={css.railCardMeta}>
                  <strong>{book.name}</strong>
                  <span className={css.muted}>{t('entryCount', { count: book.entries.length })}</span>
                </span>
              </button>
            )
          })}
        </div>
      )
    }
    if (rail === 'scripts') {
      const scripts = allScripts()
      return (
        <div className={css.railListInner}>
          <h4 className={css.railListTitle}>{t('railScripts')}</h4>
          {scripts.length === 0 ? <p className={css.muted}>{t('libraryEmptyScripts')}</p> : null}
          {scripts.map((script, index) => {
            const active = selection.type === 'script' && selection.script.name === script.name && selection.script.card === script.card
            return (
              <button key={index} type="button" className={active ? `${css.railCard} ${css.railCardActive}` : css.railCard} onClick={() => setSelection({ type: 'script', script })}>
                <span className={css.railCardIcon}>{script.kind === 'regex' ? '🧩' : '🧰'}</span>
                <span className={css.railCardMeta}>
                  <strong>{script.name}</strong>
                  <span className={css.muted}>{script.card}{script.enabled ? '' : ` · ${t('scriptDisabled')}`}</span>
                </span>
              </button>
            )
          })}
        </div>
      )
    }
    if (rail === 'presets') {
      return (
        <div className={css.railListInner}>
          <h4 className={css.railListTitle}>{t('railPresets')}</h4>
          <button type="button" className={css.railCard} onClick={() => setSelection({ type: 'jailbreak', jailbreak: { id: '', name: '', content: '' } })}>
            <span className={css.railCardIcon}>＋</span>
            <span className={css.railCardMeta}>
              <strong>{t('jailbreakNew')}</strong>
              <span className={css.muted}>{t('jailbreakNewHint')}</span>
            </span>
          </button>
          <label className={css.railImport}>
            <span className={css.railImportLabel}>📥 {t('jailbreakImport')}</span>
            <input type="file" accept=".txt,.json,.md,text/plain" aria-label={t('jailbreakImport')} disabled={busy} onChange={onJailbreakFile} />
          </label>
          {jailbreaks.length === 0 ? <p className={css.muted}>{t('libraryEmptyPresets')}</p> : null}
          {jailbreaks.map(jailbreak => {
            const active = selection.type === 'jailbreak' && selection.jailbreak.id === jailbreak.id
            return (
              <button key={jailbreak.id} type="button" className={active ? `${css.railCard} ${css.railCardActive}` : css.railCard} onClick={() => setSelection({ type: 'jailbreak', jailbreak })}>
                <span className={css.railCardIcon}>🔓</span>
                <span className={css.railCardMeta}>
                  <strong>{jailbreak.name}</strong>
                  <span className={css.muted}>{t('jailbreakPrompt')}</span>
                </span>
              </button>
            )
          })}
        </div>
      )
    }
    // settings
    return (
      <div className={css.railListInner}>
        <h4 className={css.railListTitle}>{t('railSettings')}</h4>
        <p className={css.muted}>{t('settingsHint')}</p>
      </div>
    )
  }

  const renderTavernDetail = (): ReactNode => {
    // The settings rail hosts sessions, persona, roleplay, and imports.
    if (rail === 'settings') {
      return (
        <div className={css.home}>
          <section className={css.homeSection}>
            <h4 className={css.detailTitle}>{t('importSection')}</h4>
            <div className={css.importCards}>
              <div className={css.importCard}>
                <strong>{t('importCharacter')}</strong>
                <p className={css.muted}>{t('importCharacterHint')}</p>
                <label className={css.fileRow}>
                  <span className={css.treeLabel}>{t('importCharacterFile')}</span>
                  <input type="file" accept=".png,.json" aria-label={t('importCharacterFile')} disabled={busy} onChange={onCharacterFile} />
                </label>
              </div>
              <div className={css.importCard}>
                <strong>{t('importWorldBook')}</strong>
                <p className={css.muted}>{t('importWorldBookHint')}</p>
                <label className={css.fileRow}>
                  <span className={css.treeLabel}>{t('importWorldBookFile')}</span>
                  <input type="file" accept=".json,application/json" aria-label={t('importWorldBookFile')} disabled={busy} onChange={onWorldBookFile} />
                </label>
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
              <div className={css.importCard}>
                <strong>{t('importPreset')}</strong>
                <p className={css.muted}>{t('importPresetHint')}</p>
                <label className={css.fileRow}>
                  <span className={css.treeLabel}>{t('importPresetFile')}</span>
                  <input type="file" accept=".json,application/json" aria-label={t('importPresetFile')} disabled={busy} onChange={onPresetFile} />
                </label>
                <textarea
                  className={css.pasteArea}
                  aria-label={t('importPresetPaste')}
                  placeholder={t('importPresetPaste')}
                  value={presetDraft}
                  disabled={busy}
                  onChange={event => setPresetDraft(event.target.value)}
                />
                <button type="button" className={css.actionButton} disabled={busy} onClick={importPresetDraft}>
                  {busy ? t('importing') : t('importPresetAction')}
                </button>
              </div>
            </div>
          </section>
          <section className={css.homeSection}>
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
          </section>
        </div>
      )
    }
    if (selection.type === 'script') {
      const { script } = selection
      return (
        <div className={css.wbDetail}>
          <div className={css.wbHeader}>
            <h4 className={css.detailTitle}>{script.name}</h4>
            <span className={css.badgeKind}>{script.kind === 'regex' ? t('scriptRegex') : t('scriptHelper')}</span>
            <span className={css.paneHeaderSpacer} />
            <span className={css.muted}>{t('scriptCard', { name: script.card })}</span>
          </div>
          <p className={css.status}>{t('scriptHint')}</p>
          {script.kind === 'regex' ? (
            <div className={css.charSections}>
              <section className={css.charField}>
                <h5 className={css.detailTitle}>{t('scriptEnabled')}</h5>
                <label className={css.worldbookCheck}>
                  <input
                    type="checkbox"
                    defaultChecked={script.enabled}
                    aria-label={t('scriptEnabled')}
                  />
                  <span>{script.enabled ? t('scriptEnabled') : t('scriptDisabled')}</span>
                </label>
              </section>
              <section className={css.charField}>
                <h5 className={css.detailTitle}>{t('scriptFind')}</h5>
                <textarea className={css.charEditArea} aria-label={t('scriptFind')} defaultValue={script.findRegex} rows={3} />
              </section>
              <section className={css.charField}>
                <h5 className={css.detailTitle}>{t('scriptReplace')}</h5>
                <textarea className={css.charEditArea} aria-label={t('scriptReplace')} defaultValue={script.replaceString} rows={3} />
              </section>
            </div>
          ) : null}
          <button
            type="button"
            className={css.actionButton}
            disabled={busy}
            onClick={event => {
              const root = (event.target as HTMLButtonElement).parentElement
              const enabled = (root?.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? script.enabled
              const findRegex = (root?.querySelector('textarea[aria-label="' + t('scriptFind') + '"]') as HTMLTextAreaElement | null)?.value ?? script.findRegex
              const replaceString = (root?.querySelector('textarea[aria-label="' + t('scriptReplace') + '"]') as HTMLTextAreaElement | null)?.value ?? script.replaceString
              void api.tavern.updateCharacterScripts({ id: script.characterId as never, overrides: [{ name: script.name, enabled, findRegex, replaceString }] }).then((result) => {
                const r = result.result
                if (!r.ok) {
                  setNotice({ kind: 'error', text: t('importFailed', { reason: r.error.message }) })
                  return
                }
                setNotice({ kind: 'success', text: t('scriptSaved') })
                reloadTavern()
              }, () => {})
            }}
          >
            {t('scriptSave')}
          </button>
        </div>
      )
    }
    if (selection.type === 'jailbreak') {
      const { jailbreak } = selection
      const isNew = jailbreak.id === ''
      return (
        <div className={css.wbDetail}>
          <div className={css.wbHeader}>
            <h4 className={css.detailTitle}>{isNew ? t('jailbreakNew') : jailbreak.name}</h4>
            <span className={css.badgeKind}>🔓 {t('railPresets')}</span>
            <span className={css.paneHeaderSpacer} />
            {isNew ? null : (
              <button type="button" className={css.dangerButton} disabled={busy} onClick={() => deleteJailbreakPreset(jailbreak.id, jailbreak.name)}>
                {t('deleteJailbreak')}
              </button>
            )}
          </div>
          <p className={css.status}>{t('jailbreakHint')}</p>
          <div className={css.charSections}>
            <section className={css.charField}>
              <h5 className={css.detailTitle}>{t('jailbreakName')}</h5>
              <input className={css.charEditArea} aria-label={t('jailbreakName')} defaultValue={jailbreak.name} />
            </section>
          </div>
          <section className={css.charField}>
            <h5 className={css.detailTitle}>{t('jailbreakContent')}</h5>
            <textarea className={css.jailbreakArea} aria-label={t('jailbreakContent')} defaultValue={jailbreak.content} rows={14} />
          </section>
          <button
            type="button"
            className={css.actionButton}
            disabled={busy}
            onClick={event => {
              const root = (event.target as HTMLButtonElement).parentElement
              const name = (root?.querySelector('input[aria-label]') as HTMLInputElement | null)?.value ?? ''
              const content = (root?.querySelector('textarea[aria-label]') as HTMLTextAreaElement | null)?.value ?? ''
              saveJailbreakPreset(isNew ? undefined : jailbreak.id, name, content)
            }}
          >
            {t('jailbreakSave')}
          </button>
        </div>
      )
    }
    if (selection.type === 'worldbook') {
      const { book } = selection
      const query = wbQuery.trim().toLowerCase()
      const entries = query.length === 0
        ? book.entries
        : book.entries.filter(entry =>
            entry.name.toLowerCase().includes(query)
            || entry.comment.toLowerCase().includes(query)
            || entry.keys.some(key => key.toLowerCase().includes(query)))
      return (
        <div className={css.wbDetail}>
          <div className={css.wbHeader}>
            <h4 className={css.detailTitle}>{book.name}</h4>
            <span className={css.wbSummary}>{t('wbSummary', { enabled: book.entries.filter(entry => entry.enabled).length, total: book.entries.length })}</span>
            <span className={css.paneHeaderSpacer} />
            <input
              className={css.searchBox}
              aria-label={t('wbSearch')}
              placeholder={t('wbSearch')}
              value={wbQuery}
              onChange={event => setWbQuery(event.target.value)}
            />
            <button type="button" className={css.actionButton} disabled={busy} onClick={() => setWbEditing('__new__')}>
              {t('entryNew')}
            </button>
            <button type="button" className={css.dangerButton} onClick={() => deleteWorldBook(book.id, book.name)}>
              {t('deleteWorldBookAction')}
            </button>
          </div>
          <table className={css.wbTable}>
            <thead>
              <tr>
                <th className={css.wbThToggle} />
                <th className={css.wbThName}>{t('wbEntryName')}</th>
                <th className={css.wbThKeys}>{t('wbEntryKeys')}</th>
                <th className={css.wbThContent}>{t('wbEntryContent')}</th>
                <th className={css.wbThActions}>{t('wbActions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const entryName = entry.name.length > 0 ? entry.name : entry.comment
                const editing = wbEditing === entryName
                return (
                  <tr key={index} className={entry.enabled ? undefined : css.wbRowOff}>
                    <td>
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        aria-label={t('entryToggle', { name: entry.comment || entry.name })}
                        onChange={event => {
                          const enabled = event.target.checked
                          void api.tavern.setWorldBookEntryEnabled({ id: book.id as never, entryName: entry.name || entry.comment, enabled }).then(result => {
                            if (!result.result.ok) {
                              setNotice({ kind: 'error', text: t('importFailed', { reason: result.result.error.message }) })
                              return
                            }
                            setNotice({ kind: 'success', text: t('entryUpdated') })
                            reloadTavern()
                          }, () => {})
                        }}
                      />
                    </td>
                    <td className={css.wbName}>
                      <strong>{entryName}</strong>
                      {entry.comment.length === 0 ? null : <span className={css.muted}>{entry.comment}</span>}
                    </td>
                    <td>
                      {entry.keys.length === 0 ? (
                        <span className={css.muted}>{t('entryNoKeys')}</span>
                      ) : (
                        <span className={css.wbKeys}>
                          {entry.keys.map((key, keyIndex) => (
                            <span key={keyIndex} className={css.wbKeyChip}>{key}</span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={css.wbContent}>{entry.content}</td>
                    <td className={css.wbRowActions}>
                      <button type="button" className={css.miniButton} disabled={busy} onClick={() => setWbEditing(editing ? null : entryName)}>
                        {editing ? t('entryCancel') : t('entryEdit')}
                      </button>
                      <button type="button" className={css.miniDanger} disabled={busy} onClick={() => deleteEntry(book.id, entryName)}>
                        {t('entryDelete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {entries.length === 0 ? (
                <tr><td colSpan={5} className={css.wbEmpty}>{t('wbNoMatch')}</td></tr>
              ) : null}
            </tbody>
          </table>
          {wbEditing === null ? null : (
            <EntryEditor
              initial={wbEditing === '__new__' ? null : entries.find(entry => (entry.name.length > 0 ? entry.name : entry.comment) === wbEditing) ?? null}
              onSave={(fields) => saveEntry(book.id, fields)}
              onCancel={() => setWbEditing(null)}
              busy={busy}
            />
          )}
        </div>
      )
    }
    if (selection.type !== 'character') return <p className={css.hint}>{t('explorerHint')}</p>
    const { character } = selection
    const scripts = cardScripts(character.extensions)
    const enabledScripts = scripts.filter(script => script.enabled).length
    const books = relatedWorldbooks(character)
    const charEditorKey = `char-${character.id}`
    return (
      <div className={css.charEditor}>
        <div className={css.charHeader}>
          {avatar[character.id] === undefined ? (
            <span className={css.charAvatarFallback}>{character.name.slice(0, 1) || '🧑'}</span>
          ) : (
            <img className={css.charAvatar} src={`data:image/png;base64,${avatar[character.id]}`} alt={character.name} />
          )}
          <div className={css.charTitleBlock}>
            <h4 className={css.detailTitle}>{character.name}</h4>
            <p className={css.muted}>
              {character.format}{character.hasAvatar ? ` · ${t('hasAvatar')}` : ''}
              {character.tags.length === 0 ? '' : ` · ${character.tags.join('、')}`}
            </p>
          </div>
          <span className={css.paneHeaderSpacer} />
          <div className={css.charActions}>
            <select className={css.sessionSelect} aria-label={t('selectSession')} value={sessionId} onChange={event => setSessionId(event.target.value)}>
              <option value="">{t('chooseSession')}</option>
              {sessions.ids.map(id => (
                <option key={id} value={id}>{sessions.byId[id]?.title ?? t('sessionTitle')}</option>
              ))}
            </select>
            <button type="button" className={css.actionButton} disabled={busy || sessionId === ''} onClick={() => startChatWithCharacter(character)}>
              {t('startChat')}
            </button>
            <button type="button" className={css.dangerButton} onClick={() => deleteCharacter(character.id, character.name)}>
              {t('deleteCharacterAction')}
            </button>
          </div>
        </div>
        <div className={css.charSections} key={charEditorKey}>
          <section className={css.charField}>
            <h5 className={css.detailTitle}>{t('charDescription')}</h5>
            <textarea className={css.charEditArea} aria-label={t('charDescription')} defaultValue={character.description} rows={3} />
          </section>
          <section className={css.charField}>
            <h5 className={css.detailTitle}>{t('charPersonality')}</h5>
            <textarea className={css.charEditArea} aria-label={t('charPersonality')} defaultValue={character.personality} rows={3} />
          </section>
          <section className={css.charField}>
            <h5 className={css.detailTitle}>{t('charScenario')}</h5>
            <textarea className={css.charEditArea} aria-label={t('charScenario')} defaultValue={character.scenario} rows={3} />
          </section>
          <section className={css.charField}>
            <h5 className={css.detailTitle}>{t('charMesExample')}</h5>
            <textarea className={css.charEditArea} aria-label={t('charMesExample')} defaultValue={character.mesExample} rows={3} />
          </section>
        </div>
        <button
          type="button"
          className={css.actionButton}
          disabled={busy}
          onClick={event => {
            const fields = {} as { name?: string; description?: string; personality?: string; scenario?: string; mesExample?: string }
            const sections = (event.target as HTMLButtonElement).parentElement?.querySelectorAll('[class*="charField"]')
            sections?.forEach(section => {
              const label = section.querySelector('h5')?.textContent ?? ''
              const textarea = section.querySelector('textarea')
              if (label.includes(t('charDescription'))) fields.description = textarea?.value ?? ''
              if (label.includes(t('charPersonality'))) fields.personality = textarea?.value ?? ''
              if (label.includes(t('charScenario'))) fields.scenario = textarea?.value ?? ''
              if (label.includes(t('charMesExample'))) fields.mesExample = textarea?.value ?? ''
            })
            updateCharacterFields(character, fields)
          }}
        >
          {t('characterSave')}
        </button>
        {books.length === 0 ? null : (
          <section className={css.charGreetings}>
            <h5 className={css.detailTitle}>{t('relatedWorldbooks')}</h5>
            <ul className={css.homeList}>
              {books.map(book => (
                <li key={book.id} className={css.detailItem}>
                  <strong>{book.name}</strong>
                  <span className={css.muted}>{t('entryCount', { count: book.entries.length })}</span>
                  <span className={css.badgeKind}>{t('relatedAuto')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {character.greetings.length === 0 ? null : (
          <section className={css.charGreetings}>
            <h5 className={css.detailTitle}>{t('charGreetings')}</h5>
            <ul className={css.homeList}>
              {character.greetings.map((greeting, index) => (
                <li key={index} className={css.detailItem}>
                  <span className={css.badgeKind}>{t('greetingOption', { number: index + 1 })}</span>
                  <span className={css.greetingPreview}>{greeting.slice(0, 120)}{greeting.length > 120 ? '…' : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {scripts.length === 0 ? null : (
          <section className={css.charGreetings}>
            <h5 className={css.detailTitle}>{t('cardScripts', { count: scripts.length, enabled: enabledScripts })}</h5>
            <ul className={css.homeList}>
              {scripts.map((script, index) => (
                <li key={index} className={css.detailItem}>
                  <span className={css.scriptBadges}>
                    <span className={script.enabled ? css.badgeOn : css.badgeOff}>
                      {script.enabled ? t('scriptEnabled') : t('scriptDisabled')}
                    </span>
                    <span className={css.badgeKind}>{script.kind === 'regex' ? t('scriptRegex') : t('scriptHelper')}</span>
                  </span>
                  <strong>{script.name}</strong>
                  {script.kind === 'regex' && script.findRegex.length > 0 ? (
                    <span className={css.muted}>{`/${script.findRegex.slice(0, 64)}${script.findRegex.length > 64 ? '…' : ''}`}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}
        {Object.keys(character.extensions).length === 0 ? null : (
          <details className={css.extDetails}>
            <summary className={css.extSummary}>{t('charExtensions')}</summary>
            <pre className={css.extensions}>{JSON.stringify(character.extensions, null, 2)}</pre>
          </details>
        )}
      </div>
    )
  }

  return (
    <div className={mode === 'tavern' ? `${css.explorer} ${css.tavernAccent}` : css.explorer} role="dialog" aria-label={t(mode === 'tavern' ? 'tavernTab' : 'tab')}>
      <header className={css.header}>
        <h2 className={css.title}>{t(mode === 'tavern' ? 'libraryView' : 'tab')}</h2>
        {mode === 'tavern' ? (
          <nav className={css.headerTabs} aria-label={t('tavernTab')}>
            <button type="button" className={`${css.headerTab} ${css.headerTabActive}`} onClick={() => actions.openView('chat')}>
              {t('chatView')}
            </button>
            <button type="button" className={css.headerTab} onClick={() => actions.toggle()}>
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
                actions.openView('chat')
              }}
            >
              {t('goUnbind')}
            </button>
          ) : null}
        </div>
      )}
      {mode === 'novel' ? (
        <div className={css.body}>
          <nav className={css.tree} aria-label={t('explorerTree')}>
            <button type="button" className={css.treeGroupTitle} onClick={() => setSelection({ type: 'novel', section: '' })}>
              <span className={css.treeMarker}>🖋</span>{t('tab')}
            </button>
            {novelSections.map(section => (
              <button key={section.key} type="button" className={css.treeItem} onClick={() => setSelection({ type: 'novel', section: section.key })}>
                <span className={css.treeCount}>{section.count}</span>{section.label}
              </button>
            ))}
          </nav>
          <section className={css.detail} aria-label={t('explorerDetail')}>
            {renderNovelDetail()}
          </section>
        </div>
      ) : (
        <div className={css.body3}>
          {/* Column 1: the section rail, top to bottom. */}
          <nav className={css.rail} aria-label={t('libraryRail')}>
            <button
              type="button"
              className={rail === 'characters' ? `${css.railItem} ${css.railItemActive}` : css.railItem}
              title={t('railCharacters')}
              onClick={() => { setRail('characters'); setSelection({ type: 'root' }) }}
            >🎭<span className={css.railLabel}>{t('railCharacters')}</span></button>
            <button
              type="button"
              className={rail === 'worldbooks' ? `${css.railItem} ${css.railItemActive}` : css.railItem}
              title={t('railWorldbooks')}
              onClick={() => { setRail('worldbooks'); setSelection({ type: 'root' }) }}
            >📚<span className={css.railLabel}>{t('railWorldbooks')}</span></button>
            <button
              type="button"
              className={rail === 'scripts' ? `${css.railItem} ${css.railItemActive}` : css.railItem}
              title={t('railScripts')}
              onClick={() => { setRail('scripts'); setSelection({ type: 'root' }) }}
            >🧩<span className={css.railLabel}>{t('railScripts')}</span></button>
            <button
              type="button"
              className={rail === 'presets' ? `${css.railItem} ${css.railItemActive}` : css.railItem}
              title={t('railPresets')}
              onClick={() => { setRail('presets'); setSelection({ type: 'root' }) }}
            >📋<span className={css.railLabel}>{t('railPresets')}</span></button>
            <button
              type="button"
              className={rail === 'settings' ? `${css.railItem} ${css.railItemActive}` : css.railItem}
              title={t('railSettings')}
              onClick={() => { setRail('settings'); setSelection({ type: 'root' }) }}
            >⚙️<span className={css.railLabel}>{t('railSettings')}</span></button>
          </nav>
          {/* Column 2: the section list. */}
          <section className={css.railList} aria-label={t('libraryList')}>
            {renderRailList()}
          </section>
          {/* Column 3: the detail / editor. */}
          <section className={css.detail3} aria-label={t('explorerDetail')}>
            {renderTavernDetail()}
          </section>
        </div>
      )}
    </div>
  )
}
