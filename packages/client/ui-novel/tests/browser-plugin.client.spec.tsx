// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { NovelFloatButton } from '../src/client/NovelFloatButton.tsx'
import { NovelProjectExplorer } from '../src/client/NovelProjectExplorer.tsx'
import { NovelWorkspaceTab } from '../src/client/NovelWorkspaceTab.tsx'
import type { NovelWorkspaceTabInjected } from '../src/client/NovelWorkspaceTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { root: '', world: { at: null, subjects: [] }, events: [], vows: [], decisions: [], chapters: [], manuscript: [], lore: [] }
type ReadResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench(options: { withoutNovelRemote?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const read = vi.fn<() => Promise<ReadResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  if (options.withoutNovelRemote !== true) {
    ctx.provide('remote.novelWorkspace', { workspace: read })
  }
  ctx.provide('connection' as never, { api: { tavern: {} } } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, read }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.plugins.tab': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-novel browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'connection'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(NovelWorkspaceTab)
    expect(entry.options).toMatchObject({ id: 'novel', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('小说工作区')
    expect(b.read).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => NovelWorkspaceTabInjected)()
    await expect(injected.read()).resolves.toEqual(EMPTY)
    expect(b.read).toHaveBeenCalledOnce()
    b.read.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.read()).rejects.toThrow('novelWorkspace.workspace failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('mounts the tavern surfaces even when the novel workspace Remote is absent', async () => {
    const b = await bench({ withoutNovelRemote: true })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    // The plugin still registers all four overlay surfaces (both seals + both explorers).
    const overlays = b.slots.entries('shell.overlay')
    expect(overlays).toHaveLength(4)
    // The tavern explorer injects a read that fails with a clear explanation,
    // but the tavern surface itself is present.
    const tavernStudio = overlays[3]!
    const injected = (tavernStudio.inject as unknown as () => NovelWorkspaceTabInjected)()
    await expect(injected.read()).rejects.toThrow('does not mount the novel workspace Remote')
    await b.ctx.fiber.dispose()
  })

  it('mounts two separate surfaces — novel studio and tavern — each with its own seal on a shared store', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const overlays = b.slots.entries('shell.overlay')
    expect(overlays).toHaveLength(4)
    const novelSeal = overlays[0]!
    const novelStudio = overlays[1]!
    const tavernSeal = overlays[2]!
    const tavernStudio = overlays[3]!
    expect(novelSeal.component).toBe(NovelFloatButton)
    expect(novelStudio.component).toBe(NovelProjectExplorer)
    expect(tavernSeal.component).toBe(NovelFloatButton)
    expect(tavernStudio.component).toBe(NovelProjectExplorer)
    expect(resolveSlotLabel(novelSeal.options.label)).toBe('小说工作区')
    expect(resolveSlotLabel(tavernSeal.options.label)).toBe('酒馆')
    // Each seal shares its store with its own surface, and the two surfaces
    // never share a store.
    expect(novelSeal.store).toBe(novelStudio.store)
    expect(tavernSeal.store).toBe(tavernStudio.store)
    expect(novelSeal.store).not.toBe(tavernSeal.store)
    // The injected mode selects which surface renders.
    expect(((novelStudio.inject as () => { mode: string })()?.mode)).toBe('novel')
    expect(((tavernStudio.inject as () => { mode: string })()?.mode)).toBe('tavern')
    expect(b.read).not.toHaveBeenCalled()

    await b.ctx.fiber.dispose()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    await vi.waitFor(() => { expect(b.slots.entries('shell.overlay')).toHaveLength(4) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Novel workspace')
    expect(resolveSlotLabel(b.slots.entries('shell.overlay')[0]!.options.label)).toBe('Novel workspace')
    expect(resolveSlotLabel(b.slots.entries('shell.overlay')[2]!.options.label)).toBe('Tavern')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(NovelWorkspaceTab)
    })
    await vi.waitFor(() => {
      expect(b.slots.entries('shell.overlay')[0]?.component).toBe(NovelFloatButton)
    })
    await vi.waitFor(() => {
      expect(b.slots.entries('shell.overlay')[1]?.component).toBe(NovelProjectExplorer)
    })
    await vi.waitFor(() => {
      expect(b.slots.entries('shell.overlay')[2]?.component).toBe(NovelFloatButton)
    })
    await vi.waitFor(() => {
      expect(b.slots.entries('shell.overlay')[3]?.component).toBe(NovelProjectExplorer)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
