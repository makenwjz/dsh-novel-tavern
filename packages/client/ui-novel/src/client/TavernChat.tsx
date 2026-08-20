/**
 * The WeChat-style tavern chat: a session list of bound roleplay chats on the
 * left and a bubble conversation on the right. "Start new chat" creates a
 * fresh session under the tavern agent preset, binds the character cards and
 * worldbooks, and opens the conversation; the bound character's PNG portrait
 * is used as the assistant avatar. Messages are read through session.history
 * and sent through session.prompt (queue mode); after sending, the view polls
 * history until the reply lands.
 * @module @deepseek-ai/dsh-client-ui-novel/TavernChat
 */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { CharacterId, WorldBookId } from '@deepseek-ai/dsh-tavern/types'
import type { NovelLocaleKey } from './locales.ts'
import css from './TavernChat.module.css'

/** Full props the tavern chat receives. */
export interface TavernChatProps {
  /** The connection's API client (tavern + sessions + workspace domain). */
  api: Pick<IApiClient, 'tavern' | 'sessions' | 'workspace'>
  /** Bound dictionary lookup for the novel namespace. */
  t: (key: NovelLocaleKey, params?: Record<string, unknown>) => string
  /** Standard session-list selector hook (the chat list reads it). */
  useSessions: SnapshotSelectorHook<SessionListState>
  /** Ask the owner to switch to the library view (to import a card first). */
  onNeedLibrary?: () => void
  /** A session the owner wants opened (e.g. from a blocked-delete notice). */
  focusSession?: string
}

/** One roleplay chat row in the session list. */
type ChatSummary = {
  readonly sessionId: string
  readonly title: string
  readonly characterName: string
  readonly characterId: CharacterId | null
  readonly lastText: string
  /** The card's opening messages (first_mes + alternates) for the greeting loader. */
  readonly greetings: string[]
  /** The card's display scripts (regex beautification). */
  readonly scripts: CardScript[]
  /** The bound worldbook name and entry names (the card frontend toggles them by name). */
  readonly worldbookName: string
  readonly worldbookEntries: readonly { name: string; enabled: boolean }[]
  /** The session's binding ids, needed to rebuild the binding after card toggles. */
  readonly worldbookIds: string[]
  readonly characterIds: CharacterId[]
  /** The bound prompt preset (SillyTavern Chat Completion Preset) id, or null. */
  readonly presetId: string | null
  /** The session's user persona text. */
  readonly persona: string
  /** The bound AI-jailbreak (破限) preset id, or null. */
  readonly jailbreakId: string | null
  /** Worldbook entry names this session keeps disabled (driven by the card frontend). */
  readonly disabledEntryNames: string[]
  /** The session's MVU variable state (card variables, injected into the prompt). */
  readonly mvuVariables: Record<string, string>
}

/** One card the chat can start a conversation with. */
type CardInfo = { readonly id: CharacterId; readonly name: string; readonly greetings: string[]; readonly scripts: CardScript[] }

/** One worldbook row with its entry names, as the card bridge addresses them. */
type WorldbookRow = { readonly id: string; readonly name: string; readonly entries: readonly { name: string; enabled: boolean }[] }

/** The bridge shim injected before a card's HTML so its SillyTavern calls
 *  become postMessage requests the host performs. Functions without a DSH
 *  equivalent (MVU variables, chat surgery) stay safe no-ops. */
function cardBridgeShim(options: { worldbookName: string; entries: readonly { name: string; enabled: boolean }[]; greetings: string[] }): string {
  const worldbookName = JSON.stringify(options.worldbookName)
  const entries = JSON.stringify(options.entries.map(entry => ({ name: entry.name, enabled: entry.enabled })))
  const greetings = JSON.stringify(options.greetings)
  return `<script>
(function () {
  var post = function (type, payload) {
    try { window.parent.postMessage({ source: 'dshtavern', type: type, payload: payload }, '*'); } catch (e) {}
  };
  var entryList = ${entries};
  var greetingList = ${greetings};
  window.getCharWorldbookNames = function () { return { primary: ${worldbookName} }; };
  window.getWorldbook = function () { return entryList; };
  window.updateWorldbookWith = function (worldbook, fn) {
    var next = fn(worldbook);
    var changed = [];
    for (var i = 0; i < Math.max(worldbook.length, next.length); i++) {
      var a = worldbook[i]; var b = next[i];
      if (a && b && a.name === b.name && a.enabled !== b.enabled) changed.push({ name: b.name, enabled: b.enabled });
    }
    entryList = next;
    if (changed.length > 0) post('entries', changed);
    return Promise.resolve(next);
  };
  window.setWorldbookEntry = function (name, enabled) {
    post('entries', [{ name: String(name), enabled: enabled === true }]);
    for (var i = 0; i < entryList.length; i++) { if (entryList[i].name === String(name)) entryList[i].enabled = enabled === true; }
    return Promise.resolve(true);
  };
  window.getChatMessages = function () {
    return Promise.resolve([{ swipes: greetingList }]);
  };
  window.setChatMessage = function (text) {
    post('opening', { text: String(text) });
    return Promise.resolve();
  };
  window.showToast = function (text, kind) { post('toast', { text: String(text), kind: kind || 'info' }); };
  // Safe no-op stubs for the rest of the ST surface the card may touch.
  // The MVU bridge: the card's variable system reads/writes through Mvu.
  var mvuState = { chapter_manager: {}, world_info: {}, contact: {} };
  window.Mvu = {
    getMvuData: function () { return { stat_data: mvuState }; },
    replaceMvuData: function (data) {
      var src = data && data.stat_data ? data.stat_data : data;
      var flat = {};
      (function walk(node, prefix) {
        if (node === null || node === undefined) return;
        if (typeof node !== 'object') { if (prefix) flat[prefix] = String(node); return; }
        if (Array.isArray(node)) { if (prefix) flat[prefix] = JSON.stringify(node); return; }
        for (var k in node) walk(node[k], prefix ? prefix + '.' + k : k);
      })(src, '');
      mvuState = src || {};
      post('mvu', { variables: flat });
    }
  };
  window.getMvuData = function () { return window.Mvu.getMvuData(); };
  window.replaceMvuData = function (data) { window.Mvu.replaceMvuData(data); };
  window.getChatVariables = function () { return {}; };
  window.setChatVariables = function () {};
  window.replaceWorldbook = function () {};
  window.setEntriesEnabledByTag = function () { post('toast', { text: 'batch entry toggle not supported', kind: 'warning' }); };
  // Report the rendered content height so the host can auto-size the frame.
  function reportHeight() {
    try {
      var doc = document.documentElement;
      var body = document.body;
      var h = doc ? Math.max(doc.scrollHeight, body ? body.scrollHeight : 0) : 0;
      post('height', { height: h });
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', function () { setTimeout(reportHeight, 120); });
  } else {
    setTimeout(reportHeight, 120);
  }
  window.addEventListener('load', function () { setTimeout(reportHeight, 180); });
  setTimeout(reportHeight, 600);
  setTimeout(reportHeight, 1600);
  setTimeout(reportHeight, 3200);
})();
</script>`
}

/** Whether a message would render as the card's HTML (drives the wide bubble). */
export function isRichMessage(text: string, scripts: readonly CardScript[]): boolean {
  return looksLikeHtml(applyRegexScripts(text, scripts))
}

/** Apply one JSON-patch array (the card's `<json_patch>` block) to a flat MVU
 *  variable map. Nested paths collapse to their last segment
 *  (`/world_info/time/current_time` → `current_time`), matching how the prompt
 *  displays the card variables. */
function applyMvuPatch(vars: Record<string, string>, patch: unknown): Record<string, string> {
  if (!Array.isArray(patch)) return vars
  const next = { ...vars }
  for (const op of patch) {
    if (typeof op !== 'object' || op === null) continue
    const row = op as { op?: unknown; path?: unknown; value?: unknown }
    if (row.op !== 'replace' && row.op !== 'add') continue
    if (typeof row.path !== 'string') continue
    const key = row.path.split('/').filter(Boolean).pop()
    if (key === undefined || key.length === 0) continue
    next[key] = typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? '')
  }
  return next
}

/** Collect every `<json_patch>` block from a message and apply it. */
function applyMvuPatchesFromText(text: string, vars: Record<string, string>): Record<string, string> {
  let out = vars
  const regex = /<json_patch>([\s\S]*?)<\/json_patch>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1] === undefined) continue
    try {
      out = applyMvuPatch(out, JSON.parse(match[1]))
    } catch { /* malformed patch: skip */ }
  }
  return out
}

/** The speaker name a card-style message opens with, e.g. `{艾玛}「……」`
 *  or `{艾玛}：……`. Returns null when the message carries no speaker marker. */
function speakerOf(text: string): string | null {
  const match = /^\{([^{}\n]{1,24})\}[\s：:—-]?/u.exec(text.trim())
  return match?.[1]?.trim().length ? match[1].trim() : null
}

/** One auto-sizing, user-resizable sandboxed frame for a card-rendered message.
 *  The bridge shim inside the frame reports its content height through
 *  postMessage; this component sizes the frame to match (with a generous cap),
 *  and a bottom drag handle lets the user override the height per message. */
function RichFrame({ srcDoc, title, bridge }: {
  srcDoc: string
  title: string
  bridge: { worldbookName: string; entries: readonly { name: string; enabled: boolean }[]; greetings: string[] }
}): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [autoHeight, setAutoHeight] = useState<number | null>(null)
  const [manualHeight, setManualHeight] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { source?: string; type?: string; payload?: unknown } | null | undefined
      if (data === null || typeof data !== 'object' || data.source !== 'dshtavern' || data.type !== 'height') return
      if (event.source !== frameRef.current?.contentWindow) return
      const height = (data.payload as { height?: unknown } | null)?.height
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
        setAutoHeight(height)
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  /** Begin a drag-resize on the frame's bottom handle. */
  const startDrag = (event: ReactMouseEvent): void => {
    event.preventDefault()
    const startHeight = manualHeight ?? autoHeight ?? 440
    dragRef.current = { startY: event.clientY, startHeight }
    const onMove = (move: MouseEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      setManualHeight(Math.max(140, drag.startHeight + (move.clientY - drag.startY)))
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const height = manualHeight ?? autoHeight ?? 440
  const capped = Math.min(height, window.innerHeight - 120)

  return (
    <div className={css.richWrap}>
      <iframe
        ref={frameRef}
        className={css.richFrame}
        sandbox="allow-scripts"
        title={title}
        srcDoc={`${cardBridgeShim(bridge)}\n${srcDoc}`}
        style={{ height: `${capped}px` }}
      />
      <div
        className={css.resizeHandle}
        role="separator"
        aria-label="调整高度"
        onMouseDown={startDrag}
      />
    </div>
  )
}

/** One card script entry that may transform message display. */
export type CardScript = { readonly kind: 'regex' | 'helper'; readonly name: string; readonly enabled: boolean; readonly findRegex: string; readonly replaceString: string; readonly markdownOnly: boolean }

/** Pull the display scripts out of a card's raw extensions object. */
export function cardScripts(extensions: Record<string, unknown>): CardScript[] {
  const scripts: CardScript[] = []
  const regexes = extensions.regex_scripts
  if (Array.isArray(regexes)) {
    for (const item of regexes) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      scripts.push({
        kind: 'regex',
        name: typeof row.scriptName === 'string' && row.scriptName.length > 0 ? row.scriptName : '(未命名脚本)',
        enabled: row.disabled !== true,
        findRegex: typeof row.findRegex === 'string' ? row.findRegex : '',
        replaceString: typeof row.replaceString === 'string' ? row.replaceString : '',
        markdownOnly: row.markdownOnly === true,
      })
    }
  }
  const helper = extensions.tavern_helper
  if (typeof helper === 'object' && helper !== null) {
    const helperScripts = (helper as Record<string, unknown>).scripts
    if (Array.isArray(helperScripts)) {
      for (const item of helperScripts) {
        if (typeof item !== 'object' || item === null) continue
        const row = item as Record<string, unknown>
        if (typeof row.name !== 'string') continue
        scripts.push({ kind: 'helper', name: row.name, enabled: row.enabled !== false, findRegex: '', replaceString: '', markdownOnly: false })
      }
    }
  }
  return scripts
}

/** Parse one SillyTavern regex-script find pattern. Cards store it either as a
 *  bare pattern or as the UI form `/pattern/flags` (e.g.
 *  `/<now_plot>([\\s\\S]*?)<\\/now_plot>/gi`); the slashed form must be
 *  unwrapped before `new RegExp`, otherwise the leading `/` becomes a literal
 *  and nothing ever matches. */
function parseFindRegex(findRegex: string): { pattern: string; flags: string } {
  const slashed = findRegex.match(/^\/([\s\S]*)\/([dgimsuvy]*)\s*$/)
  if (slashed !== null && slashed[1] !== undefined) {
    return { pattern: slashed[1], flags: slashed[2] ?? 'g' }
  }
  return { pattern: findRegex, flags: 'g' }
}

/** Apply the card's enabled markdown-side regex scripts to one message, the
 *  way SillyTavern post-processes display text. Malformed regexes are skipped. */
export function applyRegexScripts(text: string, scripts: readonly CardScript[]): string {
  let out = text
  for (const script of scripts) {
    if (script.kind !== 'regex' || !script.enabled || !script.markdownOnly) continue
    if (script.findRegex.length === 0) continue
    try {
      const { pattern, flags } = parseFindRegex(script.findRegex)
      out = out.replace(new RegExp(pattern, flags), script.replaceString)
    } catch { /* malformed regex: leave the text untouched */ }
  }
  return out
}

/** Whether a transformed message looks like the card's HTML rendering. */
function looksLikeHtml(text: string): boolean {
  return /<html[\s>]|<head[\s>]|<style[\s>]|<div[\s>]|<table[\s>]|<img[\s>]|<p[\s>]|<h[1-6][\s>]/i.test(text)
}

/** Render one message bubble body: the card's HTML when its beautification
 *  scripts produced markup, plain (cleaned) text otherwise. HTML messages run
 *  in a scripts-allowed sandbox with the card bridge shim, so the card's own
 *  frontend stays interactive while same-origin access stays blocked. */
function MessageBody({ text, scripts, characterName, bridge }: {
  text: string
  scripts: readonly CardScript[]
  characterName: string
  bridge: { worldbookName: string; entries: readonly { name: string; enabled: boolean }[]; greetings: string[] }
}): ReactNode {
  const transformed = applyRegexScripts(text, scripts)
  if (looksLikeHtml(transformed)) {
    return <RichFrame srcDoc={transformed} title={characterName} bridge={bridge} />
  }
  return <p className={css.bubbleText}>{cleanMarkup(text)}</p>
}

/** One rendered message bubble. */
type ChatRow = {
  readonly id: string
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly time: number
}

/** Extract plain text out of a message content block array (defensive). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block): block is Record<string, unknown> => typeof block === 'object' && block !== null)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => String(block.text))
      .join('\n')
  }
  return ''
}

/** Strip SillyTavern message markup so the WeChat bubbles stay readable:
 *  HTML template tags (`<content>`, `<now_plot>`, `<pic>`, variable blocks)
 *  keep their inner story text, plain HTML/CSS tags are dropped, and common
 *  entities decode. */
function cleanMarkup(text: string): string {
  return text
    .replace(/<\/?(?:content|now_plot|pic|UpdateVariable|update)\b[^>]*>/gi, '')
    .replace(/<[a-zA-Z][^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n').map(line => line.trim()).join('\n')
    .trim()
}

/** Map a session history to chat rows, skipping injected system reminders.
 *  Raw text is kept (markup/scripts are applied at render time). */
function toChatRows(history: Array<{ event: { type?: string; seq?: number; time?: number; data?: unknown } }>): ChatRow[] {
  const rows: ChatRow[] = []
  for (const { event } of history) {
    const data = (event.data ?? {}) as Record<string, unknown>
    if (event.type === 'user/message') {
      const source = data.source as { kind?: string } | undefined
      if (source?.kind !== 'user') continue
      const text = textOf(data.content)
      if (text.trim().length === 0) continue
      rows.push({ id: `u-${event.seq ?? rows.length}`, seq: event.seq ?? 0, role: 'user', text, time: event.time ?? 0 })
    } else if (event.type === 'assistant/message') {
      const message = data.message as { content?: unknown } | undefined
      const text = textOf(message?.content)
      if (text.trim().length === 0) continue
      rows.push({ id: `a-${event.seq ?? rows.length}`, seq: event.seq ?? 0, role: 'assistant', text, time: event.time ?? 0 })
    }
  }
  return rows
}

/** Format one message timestamp as HH:MM. */
function clockOf(time: number): string {
  if (time <= 0) return ''
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Render the WeChat-style tavern chat surface. */
export function TavernChat({ api, t, useSessions, onNeedLibrary, focusSession }: TavernChatProps): ReactNode {
  const sessions = useSessions(state => state)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [active, setActive] = useState('')
  const [rows, setRows] = useState<ChatRow[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [cards, setCards] = useState<CardInfo[]>([])
  const [worldbooks, setWorldbooks] = useState<WorldbookRow[]>([])
  /** Imported prompt presets, offered in the session-resource picker. */
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([])
  /** AI-jailbreak (破限) presets, offered in the session-resource picker. */
  const [jailbreaks, setJailbreaks] = useState<Array<{ id: string; name: string }>>([])
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Per-session chosen greeting index into the card's openings.
  const [greetingIndex, setGreetingIndex] = useState<Record<string, number>>({})
  // Whether the chosen opening has been written into the session log.
  const [openingWritten, setOpeningWritten] = useState(false)
  // MVU variable baseline for the active chat (idempotent patch application).
  const mvuBaselineRef = useRef<Record<string, string>>({})
  const endRef = useRef<HTMLDivElement | null>(null)

  /** Opening-write state is per session: reset when switching chats. */
  useEffect(() => {
    setOpeningWritten(false)
  }, [active])

  /** Re-baseline the MVU variables whenever the active chat's data changes. */
  useEffect(() => {
    const summary = chats.find(chat => chat.sessionId === active)
    mvuBaselineRef.current = summary?.mvuVariables ?? {}
  }, [active, chats])

  /** Update the active session's binding (preset and/or worldbook selection)
   *  through the API and mirror it into the local summary. */
  const updateBinding = (patch: { presetId?: string | null; jailbreakId?: string | null; worldbookIds?: string[] }): void => {
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary === undefined) return
    const worldbookIds = patch.worldbookIds ?? [...summary.worldbookIds]
    const presetId = patch.presetId === undefined ? summary.presetId : patch.presetId
    const jailbreakId = patch.jailbreakId === undefined ? summary.jailbreakId : patch.jailbreakId
    const binding = {
      mode: 'tavern' as const,
      worldbookIds: worldbookIds as never,
      characterId: null,
      characterIds: summary.characterIds,
      disabledEntryNames: summary.disabledEntryNames,
      ...(presetId === null || presetId === undefined ? {} : { presetId: presetId as never }),
      ...(jailbreakId === null || jailbreakId === undefined ? {} : { jailbreakId: jailbreakId as never }),
    }
    setChats(previous => previous.map(chat => chat.sessionId === active
      ? { ...chat, presetId, jailbreakId, worldbookIds }
      : chat))
    void api.tavern.setBinding({ sessionId: active as never, binding }).then(result => {
      if (!result.result.ok) setError(t('chatError', { reason: result.result.error.message }))
    }, () => {})
  }

  /** Save the active session's user persona. */
  const savePersona = (persona: string): void => {
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary === undefined) return
    void api.tavern.setPersona({ sessionId: active as never, persona }).then(result => {
      if (!result.result.ok) {
        setError(t('chatError', { reason: result.result.error.message }))
        return
      }
      setChats(previous => previous.map(chat => chat.sessionId === active ? { ...chat, persona } : chat))
      setNotice(t('personaSaved'))
    }, () => {})
  }

  /** Export the current conversation as a SillyTavern Chat JSONL download. */
  const exportChat = (): void => {
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary === undefined) return
    const lines: string[] = [JSON.stringify({ chat_metadata: {}, char_name: summary.characterName, create_date: new Date().toISOString() })]
    for (const row of rows) {
      if (row.role === 'user') {
        lines.push(JSON.stringify({ name: 'User', is_user: true, is_system: false, mes: row.text, send_date: row.time }))
      } else {
        lines.push(JSON.stringify({ name: speakerOf(row.text) ?? summary.characterName, is_user: false, is_system: false, mes: row.text, send_date: row.time }))
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${summary.characterName}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice(t('chatExported'))
  }

  /** Import a SillyTavern Chat JSONL file into the active (fresh) session. */
  const onChatImportFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || active === '' || sending) return
    const reader = new FileReader()
    reader.onload = () => {
      void api.tavern.importChat({ sessionId: active as never, content: String(reader.result ?? '') }).then(result => {
        const r = result.result
        if (!r.ok) {
          setError(t('chatError', { reason: r.error.message }))
          return
        }
        setNotice(t('chatImported', { count: r.value.imported }))
        reloadHistory()
      }, (reason: unknown) => {
        setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
      })
    }
    reader.readAsText(file)
  }

  /** Fork the session before one reply and regenerate it from the preceding
   *  user message — SillyTavern's "swipe/regenerate" branch behavior. */
  const rewriteReply = (row: ChatRow): void => {
    if (sending || active === '') return
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary === undefined) return
    // The user message that precedes this reply in the visible history.
    const priorUser = [...rows].reverse().find(candidate => candidate.role === 'user' && candidate.seq < row.seq)
    if (priorUser === undefined) return
    setSending(true)
    setError('')
    void api.sessions.fork({ sessionId: active as never, atSeq: row.seq }).then(forkResult => {
      const f = forkResult.result
      if (!f.ok) {
        setSending(false)
        setError(t('chatError', { reason: f.error.message }))
        return
      }
      const childId = f.value.sessionId
      void api.sessions.prompt({ sessionId: childId, mode: 'queue', content: [{ type: 'text', text: priorUser.text }] }).then(promptResult => {
        const p = promptResult.result
        if (!p.ok) {
          setSending(false)
          setError(t('chatError', { reason: p.error.message }))
          return
        }
        setNotice(t('rewriteStarted'))
        openChildChat(childId, summary)
      }, (reason: unknown) => {
        setSending(false)
        setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
      })
    }, (reason: unknown) => {
      setSending(false)
      setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Register a forked child session as a chat and open it, polling until the
   *  regenerated reply lands. */
  const openChildChat = (sessionId: string, parent: ChatSummary): void => {
    const child: ChatSummary = {
      ...parent,
      sessionId,
      title: `${parent.title} · ${t('rewriteBranch')}`,
      presetId: parent.presetId,
      persona: parent.persona,
    }
    setChats(previous => [child, ...previous.filter(chat => chat.sessionId !== sessionId)])
    setActive(sessionId)
    const deadline = Date.now() + 90000
    const poll = (): void => {
      void api.sessions.history({ sessionId: sessionId as never, maxMessages: 80 }).then(historyResult => {
        if (!historyResult.result.ok) { setSending(false); return }
        const next = toChatRows(historyResult.result.value.events)
        const lastUser = [...next].reverse().find(candidate => candidate.role === 'user')
        const hasReply = lastUser !== undefined && next.some(candidate => candidate.role === 'assistant' && candidate.seq > lastUser.seq)
        if (hasReply || Date.now() > deadline) {
          setSending(false)
          setRows(next)
          syncMvuFromRows(next)
          return
        }
        setTimeout(poll, 1500)
      }, () => { setSending(false) })
    }
    setTimeout(poll, 800)
  }

  /** Replay the model's `<json_patch>` blocks from the loaded rows onto the
   *  session's MVU variables and push the result when anything changed. */
  const syncMvuFromRows = (nextRows: ChatRow[]): void => {
    const baseline = mvuBaselineRef.current
    let vars = baseline
    for (const row of nextRows) {
      if (row.role === 'assistant') vars = applyMvuPatchesFromText(row.text, vars)
    }
    if (JSON.stringify(vars) === JSON.stringify(baseline)) return
    mvuBaselineRef.current = vars
    setChats(previous => previous.map(chat => chat.sessionId === active ? { ...chat, mvuVariables: vars } : chat))
    void api.tavern.setMvu({ sessionId: active as never, variables: vars }).then(result => {
      if (!result.result.ok) setError(t('chatError', { reason: result.result.error.message }))
    }, () => {})
  }

  /** Load the tavern-bound session list and the character rows. */
  useEffect(() => {
    let current = true
    void Promise.all([
      api.tavern.projectTree({}),
      api.tavern.listPromptPresets({}),
      api.tavern.listJailbreaks({}),
      api.sessions.list({}),
      api.workspace.list({}),
    ]).then(async ([treeResult, presetResult, jailbreakResult, sessionResult, workspaceResult]) => {
      if (!current) return
      const archivedIds = workspaceResult.result.ok ? workspaceResult.result.value.archivedSessionIds : []
      const rows = treeResult.result.ok ? treeResult.result.value.characters : []
      const worldbooks: WorldbookRow[] = treeResult.result.ok ? treeResult.result.value.worldbooks : []
      if (presetResult.result.ok) {
        setPresets(presetResult.result.value.presets.map(preset => ({ id: preset.id, name: preset.name })))
      }
      if (jailbreakResult.result.ok) {
        setJailbreaks(jailbreakResult.result.value.jailbreaks.map(jailbreak => ({ id: jailbreak.id, name: jailbreak.name })))
      }
      const bookById = new Map(worldbooks.map(book => [book.id, book]))
      const cardInfos: CardInfo[] = rows.map(row => ({
        id: row.id as CharacterId,
        name: row.name,
        greetings: [...(row.greetings ?? [])],
        scripts: cardScripts(row.extensions),
      }))
      setCards(cardInfos)
      setWorldbooks(worldbooks)
      const summaries: ChatSummary[] = []
      const items = sessionResult.result.ok ? sessionResult.result.value.items : []
      for (const item of items) {
        if (archivedIds.includes(item.sessionId)) continue
        const binding = await api.tavern.binding({ sessionId: item.sessionId as never })
        if (!binding.result.ok || binding.result.value.binding === null) continue
        const b = binding.result.value.binding
        if (b.mode !== 'tavern') continue
        const characterIds = b.characterIds ?? (b.characterId === null ? [] : [b.characterId])
        const card = cardInfos.find(candidate => characterIds.includes(candidate.id))
        const book = bookById.get(b.worldbookIds[0] ?? '')
        const values = item.projections?.values as Record<string, unknown> | undefined
        const rawTitle = values?.title
        const title = typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : t('sessionTitle')
        summaries.push({
          sessionId: item.sessionId,
          title,
          characterName: card?.name ?? characterIds[0] ?? t('tavernTab'),
          characterId: card?.id ?? characterIds[0] ?? null,
          lastText: '',
          greetings: card?.greetings ?? [],
          scripts: card?.scripts ?? [],
          worldbookName: book?.name ?? '',
          worldbookEntries: book?.entries ?? [],
          worldbookIds: [...b.worldbookIds],
          characterIds: characterIds as CharacterId[],
          disabledEntryNames: [...(b.disabledEntryNames ?? [])],
          mvuVariables: { ...(b.mvuVariables ?? {}) },
          presetId: b.presetId ?? null,
          persona: b.persona ?? '',
          jailbreakId: b.jailbreakId ?? null,
        })
      }
      setChats(summaries)
      if (active === '' && summaries.length > 0) setActive(summaries[0]!.sessionId)
    }, () => { if (current) setError(t('chatError', { reason: 'load' })) })
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sessions.ids.join(',')])

  /** Load the active session's history and its character portrait. */
  const reloadHistory = (): void => {
    if (active === '') {
      setRows([])
      return
    }
    void api.sessions.history({ sessionId: active as never, maxMessages: 80 }).then((result) => {
      const r = result.result
      if (!r.ok) return
      const next = toChatRows(r.value.events)
      setRows(next)
      syncMvuFromRows(next)
    }, () => { /* the poll path surfaces errors */ })
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary?.characterId !== null && summary?.characterId !== undefined && avatars[summary.characterId] === undefined) {
      void api.tavern.characterImage({ id: summary.characterId as never }).then((result) => {
        const r = result.result
        if (!r.ok) return
        setAvatars(previous => ({ ...previous, [summary.characterId as string]: r.value.bytesB64 }))
      }, () => {})
    }
  }

  useEffect(() => {
    if (active === '') {
      setRows([])
      return
    }
    let current = true
    void api.sessions.history({ sessionId: active as never, maxMessages: 80 }).then((result) => {
      const r = result.result
      if (!current || !r.ok) return
      const next = toChatRows(r.value.events)
      setRows(next)
      syncMvuFromRows(next)
    }, () => { /* the poll path surfaces errors */ })
    const summary = chats.find(chat => chat.sessionId === active)
    if (summary?.characterId !== null && summary?.characterId !== undefined && avatars[summary.characterId] === undefined) {
      void api.tavern.characterImage({ id: summary.characterId as never }).then((result) => {
        const r = result.result
        if (!r.ok) return
        if (!current) return
        setAvatars(previous => ({ ...previous, [summary.characterId as string]: r.value.bytesB64 }))
      }, () => {})
    }
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, api, chats.length])

  /** Keep the conversation scrolled to the newest bubble. */
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [rows, active])

  /** Open a session the owner asked for (blocked-delete jump), once it is listed. */
  useEffect(() => {
    if (focusSession === undefined || focusSession.length === 0) return
    if (chats.some(chat => chat.sessionId === focusSession)) {
      setActive(focusSession)
    }
  }, [focusSession, chats])

  /** Handle messages from a rendered card frontend (the bridge shim): opening
   *  switch, worldbook entry toggles, and toasts. */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { source?: string; type?: string; payload?: unknown } | null | undefined
      if (data === null || typeof data !== 'object' || data.source !== 'dshtavern') return
      const summary = chats.find(chat => chat.sessionId === active)
      if (summary === undefined) return
      if (data.type === 'opening') {
        const text = typeof data.payload === 'string' ? data.payload : (data.payload as { text?: unknown } | null)?.text
        const index = typeof text === 'string' ? summary.greetings.findIndex(greeting => greeting === text) : -1
        setGreetingIndex(previous => ({ ...previous, [active]: index >= 0 ? index : 0 }))
        setNotice(t('bridgeOpening', { name: summary.characterName }))
        return
      }
      if (data.type === 'toast') {
        const payload = data.payload as { text?: unknown } | null
        setNotice(typeof payload?.text === 'string' ? payload.text : t('bridgeCardAction'))
        return
      }
      if (data.type === 'entries' && Array.isArray(data.payload)) {
        const disabled = new Set(summary.disabledEntryNames)
        for (const change of data.payload as Array<{ name?: unknown; enabled?: unknown }>) {
          if (typeof change.name !== 'string') continue
          if (change.enabled === true) disabled.delete(change.name)
          else if (change.enabled === false) disabled.add(change.name)
        }
        const disabledEntryNames = [...disabled]
        setChats(previous => previous.map(chat => chat.sessionId === active ? { ...chat, disabledEntryNames } : chat))
        void api.tavern.setBinding({
          sessionId: active as never,
          binding: {
            mode: 'tavern',
            worldbookIds: summary.worldbookIds as never,
            characterId: null,
            characterIds: summary.characterIds as never,
            disabledEntryNames,
          },
        }).then((result) => {
          if (!result.result.ok) {
            setError(t('chatError', { reason: result.result.error.message }))
          } else {
            setNotice(t('bridgeWorldbook'))
          }
        }, () => {})
        return
      }
      if (data.type === 'mvu') {
        const payload = data.payload as { variables?: unknown } | null
        const variables = payload?.variables
        if (typeof variables !== 'object' || variables === null) return
        const flat = variables as Record<string, string>
        mvuBaselineRef.current = flat
        setChats(previous => previous.map(chat => chat.sessionId === active ? { ...chat, mvuVariables: flat } : chat))
        void api.tavern.setMvu({ sessionId: active as never, variables: flat }).then((result) => {
          if (!result.result.ok) setError(t('chatError', { reason: result.result.error.message }))
        }, () => {})
        return
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, chats, api, t])

  /** Fully unbind the active chat (characters and worldbooks), freeing bound
   *  items for deletion; the conversation leaves the tavern list. */
  const unbindActive = (): void => {
    if (active === '' || sending) return
    setSending(true)
    void api.tavern.setBinding({
      sessionId: active as never,
      binding: { mode: 'novel', worldbookIds: [], characterId: null },
    }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setSending(false)
        setError(t('chatError', { reason: r.error.message }))
        return
      }
      setChats(previous => previous.filter(chat => chat.sessionId !== active))
      setActive('')
      setSending(false)
      setNotice(t('unbound'))
    }, (reason: unknown) => {
      setSending(false)
      setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Create a fresh tavern session, bind it, and open it in the chat. */
  const startNewChat = (): void => {
    if (sending) return
    setError('')
    setNotice('')
    if (cards.length === 0) {
      setError(t('chatNeedCharacter'))
      onNeedLibrary?.()
      return
    }
    setSending(true)
    void api.sessions.create({ agentPreset: 'tavern' }).then(async (created) => {
      if (!created.result.ok) throw new Error(created.result.error.message)
      const sessionId = created.result.value.sessionId
      const characterIds = cards.map(card => card.id)
      const bookList = await api.tavern.listWorldBooks({})
      const bound = await api.tavern.startRoleplay({
        sessionId: sessionId as never,
        characterIds: characterIds as never,
        worldbookIds: (bookList.result.ok ? bookList.result.value.worldbooks.map(book => book.id) : []) as WorldBookId[],
      })
      const boundResult = bound.result
      if (!boundResult.ok) throw new Error(boundResult.error.message)
      const first = cards[0]
      const firstBook = worldbooks[0]
      setChats(previous => [
        ...previous,
        {
          sessionId,
          title: t('sessionTitle'),
          characterName: first?.name ?? t('tavernTab'),
          characterId: first?.id ?? null,
          lastText: '',
          greetings: first?.greetings ?? [],
          scripts: first?.scripts ?? [],
          worldbookName: firstBook?.name ?? '',
          worldbookEntries: firstBook?.entries ?? [],
          worldbookIds: [...boundResult.value.binding.worldbookIds],
          characterIds: characterIds as CharacterId[],
          disabledEntryNames: [],
          mvuVariables: {},
          presetId: null,
          persona: '',
          jailbreakId: null,
        },
      ])
      setActive(sessionId)
      setNotice(t('chatStarted'))
      setSending(false)
    }, (reason: unknown) => {
      setSending(false)
      setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Archive (delete) one conversation after confirmation; the session is
   *  removed from every list while its data stays recoverable in the store. */
  const deleteChat = (chat: ChatSummary): void => {
    if (sending || !window.confirm(t('deleteChatConfirm', { name: chat.characterName }))) return
    void api.workspace.archiveSession({ sessionId: chat.sessionId as never }).then((result) => {
      const r = result.result
      if (!r.ok) {
        setError(t('chatError', { reason: r.error.message }))
        return
      }
      setChats(previous => previous.filter(candidate => candidate.sessionId !== chat.sessionId))
      if (active === chat.sessionId) setActive('')
      setNotice(t('chatDeleted'))
    }, (reason: unknown) => {
      setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Send one message; on a fresh chat the chosen greeting is first written
   *  into the session log so the model continues from it (SillyTavern
   *  behavior), then the message is queued and the reply polled. */
  const send = (event: FormEvent): void => {
    event.preventDefault()
    const text = input.trim()
    if (text.length === 0 || active === '' || sending) return
    setInput('')
    setSending(true)
    setError('')
    const summary = chats.find(chat => chat.sessionId === active)
    const greeting = summary !== undefined && summary.greetings.length > 0
      ? summary.greetings[Math.min(greetingIndex[active] ?? 0, summary.greetings.length - 1)] ?? ''
      : ''
    const queueMessage = (): void => {
      void api.sessions.prompt({
        sessionId: active as never,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }).then((result) => {
        if (!result.result.ok) {
          setSending(false)
          setError(t('chatError', { reason: result.result.error.message }))
          return
        }
        // Poll history until a new assistant message lands after this send.
        const deadline = Date.now() + 90000
        let stable = 0
        const poll = (): void => {
          void api.sessions.history({ sessionId: active as never, maxMessages: 80 }).then((historyResult) => {
            if (!historyResult.result.ok) {
              setSending(false)
              return
            }
          const next = toChatRows(historyResult.result.value.events)
          const lastUser = [...next].reverse().find(row => row.role === 'user')
          const hasReply = lastUser !== undefined && next.some(row => row.role === 'assistant' && row.seq > lastUser.seq)
          setRows(next)
          syncMvuFromRows(next)
          if (hasReply) {
            stable += 1
            if (stable >= 2 || Date.now() > deadline) {
              setSending(false)
              return
            }
          } else if (Date.now() > deadline) {
            setSending(false)
            return
          }
          setTimeout(poll, 1500)
        }, () => { setSending(false) })
      }
      setTimeout(poll, 800)
    }, (reason: unknown) => {
      setSending(false)
      setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
    }
    if (greeting.length > 0 && !openingWritten) {
      // Write the chosen opening into the session log first, so the model
      // continues from it instead of being told to re-open the scene.
      void api.tavern.setGreeting({ sessionId: active as never, greeting }).then((result) => {
        if (!result.result.ok) {
          setSending(false)
          setError(t('chatError', { reason: result.result.error.message }))
          return
        }
        setOpeningWritten(true)
        queueMessage()
      }, (reason: unknown) => {
        setSending(false)
        setError(t('chatError', { reason: reason instanceof Error ? reason.message : String(reason) }))
      })
    } else {
      queueMessage()
    }
  }

  const activeSummary = chats.find(chat => chat.sessionId === active)
  const avatarB64 = activeSummary?.characterId === null || activeSummary?.characterId === undefined
    ? undefined
    : avatars[activeSummary.characterId]
  /** The avatar of the character whose name matches a speaker marker. */
  const avatarB64Of = (speaker: string): string | undefined => {
    for (const characterId of activeSummary?.characterIds ?? []) {
      const card = cards.find(candidate => candidate.id === characterId)
      if (card?.name === speaker) return avatars[characterId]
    }
    return undefined
  }
  // The chosen opening message of the active chat (SillyTavern greeting loader).
  const greetingIndexForActive = greetingIndex[active] ?? 0
  const greeting = activeSummary !== undefined && activeSummary.greetings.length > 0
    ? activeSummary.greetings[Math.min(greetingIndexForActive, activeSummary.greetings.length - 1)] ?? ''
    : ''
  // Whether the session log already carries the opening (written by a previous
  // send or on reload) — the local preview bubble hides to avoid duplication.
  let openingInHistory = false
  let sawUserRow = false
  for (const row of rows) {
    if (row.role === 'user') sawUserRow = true
    else if (row.role === 'assistant' && !sawUserRow) { openingInHistory = true; break }
  }
  const showLocalGreeting = greeting.length > 0 && !openingWritten && !openingInHistory

  return (
    <div className={css.chat}>
      <aside className={css.list} aria-label={t('chatView')}>
        <button type="button" className={css.newChat} onClick={startNewChat}>
          <span className={css.newChatMark}>＋</span>{t('startNewChat')}
        </button>
        {chats.length === 0 ? (
          <p className={css.listEmpty}>{t('chatListEmpty')}</p>
        ) : (
          <ul className={css.listRows}>
            {chats.map(chat => (
              <li key={chat.sessionId} className={css.listItem}>
                <button
                  type="button"
                  className={chat.sessionId === active ? `${css.listRow} ${css.listRowActive}` : css.listRow}
                  onClick={() => setActive(chat.sessionId)}
                >
                  {chat.characterId !== null && avatars[chat.characterId] !== undefined ? (
                    <img className={css.listAvatar} src={`data:image/png;base64,${avatars[chat.characterId]}`} alt={chat.characterName} />
                  ) : (
                    <span className={css.listAvatarFallback}>{chat.characterName.slice(0, 1) || '🍺'}</span>
                  )}
                  <span className={css.listMeta}>
                    <strong className={css.listName}>{chat.characterName}</strong>
                    <span className={css.listLast}>{chat.lastText.length > 0 ? chat.lastText : t('newChatHint')}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={css.listDelete}
                  aria-label={t('deleteChat', { name: chat.characterName })}
                  title={t('deleteChat', { name: chat.characterName })}
                  onClick={() => deleteChat(chat)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className={css.pane} aria-label={t('chatView')}>
        {error.length === 0 ? null : <p className={css.chatError} role="alert">{error}</p>}
        {notice.length === 0 ? null : <p className={css.chatNotice} role="status">{notice}</p>}
        {active === '' || activeSummary === undefined ? (
          <div className={css.emptyPane}>
            <p className={css.emptyTitle}>{t('chatEmpty')}</p>
            <button type="button" className={css.newChat} onClick={startNewChat}>{t('startNewChat')}</button>
          </div>
        ) : (
          <>
            <header className={css.paneHeader}>
              <strong className={css.paneName}>{activeSummary.characterName}</strong>
              <span className={css.paneHint}>{activeSummary.title}</span>
              <span className={css.paneHeaderSpacer} />
              <button type="button" className={css.libraryButton} onClick={() => onNeedLibrary?.()}>
                {t('libraryView')}
              </button>
              <details className={css.resourcePopover}>
                <summary className={css.resourceSummary}>{t('resourceSettings')}</summary>
                <div className={css.resourcePanel}>
                  <label className={css.resourceField}>
                    <span>{t('presetPick')}</span>
                    <select
                      className={css.presetSelect}
                      aria-label={t('presetPick')}
                      value={activeSummary.presetId ?? ''}
                      onChange={event => updateBinding({ presetId: event.target.value === '' ? null : event.target.value })}
                    >
                      <option value="">{t('presetNone')}</option>
                      {presets.map(preset => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={css.resourceField}>
                    <span>{t('jailbreakPick')}</span>
                    <select
                      className={css.presetSelect}
                      aria-label={t('jailbreakPick')}
                      value={activeSummary.jailbreakId ?? ''}
                      onChange={event => updateBinding({ jailbreakId: event.target.value === '' ? null : event.target.value })}
                    >
                      <option value="">{t('jailbreakNone')}</option>
                      {jailbreaks.map(jailbreak => (
                        <option key={jailbreak.id} value={jailbreak.id}>🔓 {jailbreak.name}</option>
                      ))}
                    </select>
                  </label>
                  <fieldset className={css.worldbookField}>
                    <legend>{t('worldbookPick')}</legend>
                    {worldbooks.length === 0 ? (
                      <p className={css.muted}>{t('worldbookEmpty')}</p>
                    ) : worldbooks.map(book => {
                      const checked = activeSummary.worldbookIds.includes(book.id)
                      return (
                        <label key={book.id} className={css.worldbookCheck}>
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={book.name}
                            onChange={event => {
                              const next = event.target.checked
                                ? [...activeSummary.worldbookIds, book.id]
                                : activeSummary.worldbookIds.filter(id => id !== book.id)
                              updateBinding({ worldbookIds: next })
                            }}
                          />
                          <span className={checked ? css.entryToggleOn : css.entryToggleOff}>{book.name}</span>
                        </label>
                      )
                    })}
                  </fieldset>
                  <label className={css.resourceField}>
                    <span>{t('personaPick')}</span>
                    <textarea
                      className={css.personaArea}
                      aria-label={t('personaPick')}
                      placeholder={t('personaPlaceholder')}
                      defaultValue={activeSummary.persona}
                      key={active}
                      rows={3}
                    />
                    <button
                      type="button"
                      className={css.resourceSave}
                      onClick={event => {
                        const area = (event.target as HTMLButtonElement).parentElement?.querySelector('textarea')
                        savePersona(area?.value ?? '')
                      }}
                    >
                      {t('personaSave')}
                    </button>
                  </label>
                  <div className={css.resourceActions}>
                    <label className={css.resourceFile}>
                      <span>{t('chatImport')}</span>
                      <input type="file" accept=".jsonl,.ndjson,application/x-ndjson" aria-label={t('chatImport')} disabled={sending} onChange={onChatImportFile} />
                    </label>
                    <button type="button" className={css.resourceSave} onClick={exportChat}>{t('chatExport')}</button>
                  </div>
                </div>
              </details>
              {activeSummary.greetings.length > 1 ? (
                <select
                  className={css.greetingSelect}
                  aria-label={t('greetingPick')}
                  value={greetingIndexForActive}
                  onChange={event => setGreetingIndex(previous => ({ ...previous, [active]: Number(event.target.value) }))}
                >
                  {activeSummary.greetings.map((_, index) => (
                    <option key={index} value={index}>{t('greetingOption', { number: index + 1 })}</option>
                  ))}
                </select>
              ) : null}
              <button type="button" className={css.unbindButton} disabled={sending} onClick={unbindActive}>
                {t('unbind')}
              </button>
            </header>
            <div className={css.messages} aria-live="polite">
              {showLocalGreeting ? (
                <div className={css.bubbleRow}>
                  {avatarB64 === undefined
                    ? <span className={css.avatarFallback}>{activeSummary.characterName.slice(0, 1) || '🍺'}</span>
                    : <img className={css.avatar} src={`data:image/png;base64,${avatarB64}`} alt={activeSummary.characterName} />}
                  <div className={isRichMessage(greeting, activeSummary.scripts) ? `${css.bubble} ${css.richBubble}` : css.bubble}>
                    <MessageBody
                      text={greeting}
                      scripts={activeSummary.scripts}
                      characterName={activeSummary.characterName}
                      bridge={{
                        worldbookName: activeSummary.worldbookName,
                        entries: activeSummary.worldbookEntries,
                        greetings: activeSummary.greetings,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {rows.length === 0 && !showLocalGreeting ? (
                <p className={css.noMessages}>{t('chatEmpty')}</p>
              ) : rows.map((row, index) => {
                const previous = rows[index - 1]
                const dayBreak = previous === undefined || new Date(previous.time).toDateString() !== new Date(row.time).toDateString()
                const rich = isRichMessage(row.text, activeSummary.scripts)
                const speaker = row.role === 'assistant' ? speakerOf(row.text) : null
                const speakerAvatar = speaker === null ? undefined : avatarB64Of(speaker)
                const canRewrite = row.role === 'assistant' && rows.some(candidate => candidate.role === 'user' && candidate.seq < row.seq)
                return (
                  <div key={row.id}>
                    {dayBreak ? <p className={css.daySep}>{new Date(row.time).toLocaleDateString()}</p> : null}
                    <div className={row.role === 'assistant' ? css.bubbleRow : `${css.bubbleRow} ${css.bubbleRowMine}`}>
                      {row.role === 'assistant' ? (
                        speakerAvatar === undefined
                          ? <span className={css.avatarFallback}>{activeSummary.characterName.slice(0, 1) || '🍺'}</span>
                          : <img className={css.avatar} src={`data:image/png;base64,${speakerAvatar}`} alt={speaker ?? activeSummary.characterName} />
                      ) : null}
                      <div className={
                        row.role === 'assistant'
                          ? (rich ? `${css.bubble} ${css.richBubble}` : css.bubble)
                          : `${css.bubble} ${css.bubbleMine}`
                      }>
                        {speaker === null ? null : <p className={css.speakerLabel}>{speaker}</p>}
                        <MessageBody
                          text={row.text}
                          scripts={activeSummary.scripts}
                          characterName={activeSummary.characterName}
                          bridge={{
                            worldbookName: activeSummary.worldbookName,
                            entries: activeSummary.worldbookEntries,
                            greetings: activeSummary.greetings,
                          }}
                        />
                        <span className={css.bubbleMeta}>
                          <time>{clockOf(row.time)}</time>
                          <span className={css.tokenCount}>{t('tokenCount', { count: Math.max(1, Math.ceil(row.text.length / 4)) })}</span>
                          <button
                            type="button"
                            className={css.copyButton}
                            aria-label={t('copyMessage')}
                            onClick={() => {
                              void navigator.clipboard?.writeText(row.text).then(() => setNotice(t('copied')))
                            }}
                          >
                            {t('copyMessage')}
                          </button>
                        </span>
                        {canRewrite ? (
                          <button type="button" className={css.rewriteButton} disabled={sending} onClick={() => rewriteReply(row)}>
                            {t('rewriteReply')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
              {sending ? <p className={css.sendingHint}>{t('sending')}</p> : null}
              <div ref={endRef} />
            </div>
            <form className={css.inputBar} onSubmit={send}>
              <input
                className={css.input}
                aria-label={t('chatPlaceholder')}
                placeholder={t('chatPlaceholder')}
                value={input}
                disabled={sending || active === ''}
                onChange={event => setInput(event.target.value)}
              />
              <button type="submit" className={css.sendButton} disabled={sending || input.trim().length === 0 || active === ''}>
                {sending ? t('sending') : t('send')}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
