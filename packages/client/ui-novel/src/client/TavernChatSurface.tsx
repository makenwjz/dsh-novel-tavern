/**
 * The fullscreen tavern conversation surface. The floating window (library)
 * and this chat are two views of the same tavern store: the library's
 * "开始聊天" binds a session, writes the opening greeting, and switches here,
 * where the reading-style conversation renders the card messages.
 * @module @deepseek-ai/dsh-client-ui-novel/TavernChatSurface
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingSurfaceStore } from './explorer-store.ts'
import type { NovelExplorerInjected } from './NovelProjectExplorer.tsx'
import { TavernChat, type TavernChatProps } from './TavernChat.tsx'
import type { NovelLocaleKey } from './locales.ts'
import css from './TavernChat.module.css'

/** The fullscreen tavern conversation, shown when the store's view is 'chat'. */
export function TavernChatSurface({ useStore, actions, api, t, useSessions }: PropsStore<FloatingSurfaceStore> & PropsLocale<'settings.novel'> & InjectFace<NovelExplorerInjected> & { useSessions: TavernChatProps['useSessions'] }): ReactNode {
  const open = useStore(state => state.open)
  const view = useStore(state => state.view)
  if (!open || view !== 'chat') return null
  return (
    <div className={css.chatSurface} role="dialog" aria-label={t('chatView')}>
      <button type="button" className={css.chatSurfaceClose} aria-label={t('closeExplorer')} onClick={() => actions.toggle()}>✕</button>
      <TavernChat
        api={api}
        t={t as (key: NovelLocaleKey, params?: Record<string, unknown>) => string}
        useSessions={useSessions as never}
        onNeedLibrary={() => actions.openView('library')}
        focusSession=""
      />
    </div>
  )
}
