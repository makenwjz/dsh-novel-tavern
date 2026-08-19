/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tavern`: every
 * attached session's folded binding must resolve to existing store files.
 * Bindings are session-log data and the store is mutable data, so the check
 * is the event/data relation the invariant contract requires.
 * @module @deepseek-ai/dsh-tavern/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern'

/** Cordis companion plugin name. */
export const name = 'tavern-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Fail on every binding reference that no store file backs.
 * @param dangling - the dangling references reported by the service.
 * @param fail - the package-attributed failure reporter.
 */
function checkBindings(dangling: readonly { sessionId: string; kind: 'worldbook' | 'character'; id: string }[], fail: InvariantFailure): void {
  for (const reference of dangling) {
    fail(`session ${JSON.stringify(reference.sessionId)} binds a missing ${reference.kind} ${JSON.stringify(reference.id)}`)
  }
}

/** Install the load-time binding audit. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  checkBindings(ctx.tavern.checkBindings(), fail)
}, { inject: ['tavern'] })

/**
 * Register the tavern invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
