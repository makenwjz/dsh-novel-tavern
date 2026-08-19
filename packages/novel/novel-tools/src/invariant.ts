/** Package-owned novel workspace tool invariants. @module @deepseek-ai/dsh-novel-tools/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-novel-tools'

/** Cordis companion plugin name. */
export const name = 'novel-tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The tools resolve an optional service and fail loud when it is missing; the
 * durable store relationship lives in `dsh-novel`'s own companion. Nothing
 * else in this package owns data, so its installer stays empty by design.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: this package owns no durable state of its own.
}

/**
 * Register the novel-tools invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
