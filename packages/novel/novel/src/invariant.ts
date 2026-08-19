/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-novel`: the store's
 * durable consistency is checked at mount, since the store is mutable data the
 * service owns outright (no event stream exists for the novel domain).
 * @module @deepseek-ai/dsh-novel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { IntegrityReport } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-novel'

/** Cordis companion plugin name. */
export const name = 'novel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Fail on any durable inconsistency in the store.
 * @param report - the service's integrity report.
 * @param fail - the package-attributed failure reporter.
 */
function checkIntegrity(report: IntegrityReport, fail: InvariantFailure): void {
  if (report.orphanChanges > 0) {
    fail(`world_changes has ${report.orphanChanges} row(s) whose event or subject no longer exists`)
  }
  if (report.orphanTransitions > 0) {
    fail(`vow_transitions has ${report.orphanTransitions} row(s) whose vow no longer exists`)
  }
  if (report.unparsableStoryTimes.length > 0) {
    fail(`unparsable story time(s): ${report.unparsableStoryTimes.join(', ')}`)
  }
  if (report.payoffWithoutTransition.length > 0) {
    fail(`paid-off vow(s) without a payoff transition: ${report.payoffWithoutTransition.join(', ')}`)
  }
  if (report.unparsableSceneLists.length > 0) {
    fail(`scene(s) with an unparsable subject/vow list: ${report.unparsableSceneLists.join(', ')}`)
  }
}

/** Install the load-time store consistency check. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  checkIntegrity(ctx.novel.checkIntegrity(), fail)
}, { inject: ['novel'] })

/**
 * Register the novel invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
