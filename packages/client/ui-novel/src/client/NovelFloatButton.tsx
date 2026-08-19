/**
 * The draggable floating seal: a fixed-position gold button that can be moved
 * anywhere on screen and opens its fullscreen project surface on click.
 * Drag (past a small threshold) moves the button; a plain click toggles the
 * surface. Position is persisted in the shared floating-surface store.
 * @module @deepseek-ai/dsh-client-ui-novel/NovelFloatButton
 */

import { useRef, type PointerEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingSurfaceStore } from './explorer-store.ts'
import type { NovelExplorerInjected } from './NovelProjectExplorer.tsx'
import css from './NovelProjectExplorer.module.css'

/** Full component props assembled by the shell-overlay slot renderer. */
export type NovelFloatButtonProps =
  PropsStore<FloatingSurfaceStore>
  & PropsLocale<'settings.novel'>
  & InjectFace<NovelExplorerInjected>

/** Drag state tracked between pointerdown and pointerup. */
type DragState = {
  readonly startX: number
  readonly startY: number
  readonly origX: number
  readonly origY: number
  dragging: boolean
}

/** Render the draggable floating seal that opens one project surface. */
export function NovelFloatButton({ useStore, actions, t, mode }: NovelFloatButtonProps): ReactNode {
  const tavern = mode === 'tavern'
  const x = useStore(state => state.x)
  const y = useStore(state => state.y)
  const dragRef = useRef<DragState | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: x, origY: y, dragging: false }
    const move = (ev: globalThis.PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      const dx = ev.clientX - drag.startX
      const dy = ev.clientY - drag.startY
      if (!drag.dragging && Math.hypot(dx, dy) > 4) drag.dragging = true
      if (drag.dragging) actions.move(drag.origX + dx, drag.origY + dy)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const wasDrag = dragRef.current?.dragging === true
      dragRef.current = null
      if (!wasDrag) actions.toggle()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const label = t(tavern ? 'tavernTab' : 'tab')
  return (
    <button
      type="button"
      className={tavern ? `${css.floatButton} ${css.tavernSeal}` : css.floatButton}
      style={{ left: Math.max(0, x), top: Math.max(0, y) }}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
    >
      <span className={css.seal}>{tavern ? '🍺' : '✦'}</span>
    </button>
  )
}
