/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-novel-bundle`.
 * @module @deepseek-ai/dsh-novel-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-novel-bundle'

/** Cordis companion plugin name. */
export const name = 'novel-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static patch-list carrier (a YAML
// document of two loader rows owned by the novel service and tools packages);
// it mounts no service, emits no events, and owns no mutable relation to
// check. Each inserted row's own package carries that row's invariants.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
