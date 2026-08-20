/** Two separate fullscreen project surfaces — the novel studio and the
 *  tavern — each opened by its own draggable floating seal, plus the
 *  Plugins settings tab. The former right-edge dock is retired. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { createFloatingSurfaceStore } from './explorer-store.ts'
import { NovelFloatButton } from './NovelFloatButton.tsx'
import { NovelProjectExplorer, type NovelExplorerInjected } from './NovelProjectExplorer.tsx'
import { NovelWorkspaceTab, type NovelWorkspaceTabInjected } from './NovelWorkspaceTab.tsx'
import { TavernChatSurface } from './TavernChatSurface.tsx'
import { en, zh, type NovelLocaleKey } from './locales.ts'

export type { NovelWorkspaceTabInjected, NovelWorkspaceTabProps } from './NovelWorkspaceTab.tsx'
export type { NovelExplorerInjected } from './NovelProjectExplorer.tsx'
export type { NovelLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Novel workspace + tavern surfaces copy. */
    'settings.novel': NovelLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.novel'

/** Services required by the Settings registration and generated Remote face.
 *  `remote.novelWorkspace` is deliberately NOT a hard dependency: the tavern
 *  surface must work in a deployment that mounts the tavern store but no novel
 *  workspace Remote, so the novel read is resolved lazily and fails with a
 *  clear message when that namespace is absent. */
export const inject = ['slots', 'locale', 'remote', 'connection']

/** Contribute the novel studio and tavern surfaces: settings tab, two floating
 *  seals, and two fullscreen project explorers. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-novel: dictionaries')

  const t = ctx.locale.bind(NS)
  const { api } = ctx.get('connection') as ConnectionHandle
  const read: NovelWorkspaceTabInjected['read'] = async () => {
    const workspace = ctx.get('remote.novelWorkspace')
    if (workspace === undefined) {
      throw new Error('novelWorkspace.workspace is unavailable: the deployment does not mount the novel workspace Remote (mount @deepseek-ai/dsh-novel-bundle)')
    }
    const result = await workspace.workspace()
    if (!result.ok) {
      throw new Error(`novelWorkspace.workspace failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const novelInjected = (): NovelExplorerInjected => ({ read, api, mode: 'novel' })
  const tavernInjected = (): NovelExplorerInjected => ({ read, api, mode: 'tavern' })
  // One store per surface: the seal and its fullscreen explorer share it.
  const novelStore = createFloatingSurfaceStore(24, 72)
  const tavernStore = createFloatingSurfaceStore(92, 72)

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'novel',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: () => ({ read, api }),
  }, NovelWorkspaceTab))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'novel-seal',
    label: () => t('tab'),
    locale: NS,
    store: novelStore,
    inject: novelInjected,
  }, NovelFloatButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'novel-studio',
    label: () => t('tab'),
    locale: NS,
    store: novelStore,
    inject: novelInjected,
  }, NovelProjectExplorer))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'tavern-seal',
    label: () => t('tavernTab'),
    locale: NS,
    store: tavernStore,
    inject: tavernInjected,
  }, NovelFloatButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'tavern-studio',
    label: () => t('tavernTab'),
    locale: NS,
    store: tavernStore,
    inject: tavernInjected,
  }, NovelProjectExplorer))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'tavern-chat',
    label: () => t('chatView'),
    locale: NS,
    store: tavernStore,
    inject: tavernInjected,
  }, TavernChatSurface))
}
