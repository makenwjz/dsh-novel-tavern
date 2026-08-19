/**
 * The floating-surface store factory: one shared open flag plus the floating
 * seal's screen position per surface. The seal and its fullscreen surface read
 * and write the same handle, so they can never disagree about visibility or
 * placement. One instance per surface (novel studio, tavern).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Surface state: closed by default, seal pinned near the right edge. */
type SurfaceState = { open: boolean; x: number; y: number }

/** Annotation twin of the actions literal; drift fails at the defineStore call. */
type SurfaceActions = {
  toggle: (draft: SurfaceState) => void
  move: (draft: SurfaceState, x: number, y: number) => void
}

/**
 * Create one floating-surface store handle.
 * @param x - the initial seal x position.
 * @param y - the initial seal y position.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFloatingSurfaceStore(x: number, y: number): EngineStoreHandle<SurfaceState, SurfaceActions> {
  return defineStore({
    init: (): SurfaceState => ({ open: false, x, y }),
    actions: {
      toggle: (draft) => { draft.open = !draft.open },
      move: (draft, nextX, nextY) => { draft.x = nextX; draft.y = nextY },
    },
  })
}

/** The handle type components derive their PropsStore share from. */
export type FloatingSurfaceStore = EngineStoreHandle<SurfaceState, SurfaceActions>
