# Agent Note: Novel workspace surfaces in the Web app

Status: implemented

English | [中文](2026-08-17-novel-workspace-settings-tab.zh.md)

## Problem

The novel subsystem ships a durable store, twelve model-facing tools, and a Remote API, but no browser surface to inspect the workspace: world fold point and subjects, story timeline, vow ledger, creative decisions, and chapter knowledge rows stay invisible until a model task or CLI run prints them. The settings UI also had no place to surface where the novel store actually lives, and once inside the settings dialog the view stays buried behind navigation.

## Decision

**`novel-api` is a Remote-only read projection.** `NovelApiGateway` registers the `novelWorkspace` service and one generated direct Remote, `novelWorkspace/workspace`, that resolves the optional `novel` service through `ctx.get()` and returns the whole store as one JSON-safe, display-form snapshot (display story times, full vow transition history, decisions with options and outcomes, chapter knowledge-control rows, and the store root). The service declares no same-process Cordis `Context` merge and no `novel` injection: deployments without the bundle still mount the gateway, and the missing runtime fails loud on the method call instead of at plugin load. Public payload types live under `./types`; Typert generates the Host and Client Remote artifacts.

**`ui-novel` is a browser-side Settings tab plus a right-edge dock.** The client plugin registers one localized `settings.plugins.tab` contribution with id `novel`, one `sidebar.footer.action` trigger with id `novel-dock-toggle`, and one `shell.overlay` dock with id `novel-dock`, all through `ctx.slots.inject()`, so they follow late declaration, redeclaration, locale changes, and teardown. The trigger and the dock mount one shared root-scope store handle built once in `apply`, so the open flag can never disagree between the two surfaces; the dock renders nothing while closed. Selecting the tab or opening the dock mounts it and lazily calls `ctx.remote.novelWorkspace.workspace()` through the `api-remotes` assembly; plugin activation performs no Remote read. The surfaces render the snapshot in five sections (world state, timeline, vow ledger, creative decisions, chapter knowledge) plus the store root directory, with localized copy, loading/failure/empty/retry states local to the mounted component, a refresh button, and an explanatory not-mounted state when the deployment mounts no novel service. The dock floats at the frame's right edge inside the click-through overlay layer, below the settings dialog, without reflowing any column.

**Registration follows the web-app bundle checklist.** The `dsh.client` row and bundle dependency live in `packages/bundle/web-app`, the aggregate reference in `tsconfig.client.json`, and explicit `tsconfig.base.json` paths for both packages; the build order remains host then client so the Remote artifacts reach consumers through node_modules.

## Alternatives considered

**A full-page route instead of a Settings tab.** Rejected because the settings plugin-tab is the established extension point for per-plugin browser surfaces (`ui-agent-preset`, `ui-settings-plugin-inventory`), and the tab stays visible only inside the settings dialog that already owns navigation chrome.

**A persistent fourth layout column instead of the overlay dock.** Rejected because the frame's three-track geometry (sidebar, conversation, details) is a settled contract with its own concession solver and e2e geometry assertions; an overlay dock gives the always-available surface without reflowing any column, and the click-through layer keeps the app underneath interactive.

**Periodic polling instead of on-demand snapshot reads.** Rejected because the projection contract is point-in-time: one snapshot per mount or refresh, no subscription, delta, or pagination, which keeps the gateway stateless and the surfaces in control of refetch timing.

## Consequences

The browser Settings dialog shows the novel tab and the sidebar foot shows the dock trigger whenever the web-app bundle mounts the novel rows, and an honest not-mounted state when it does not. The dock stays open across session and workspace switches until collapsed. The dock panel renders as frosted glass with a gold trim and star ornament (new `--dsw-alias-bg-frosted`/`--dsw-alias-accent-gold` theme tokens, light and dark). `docs/config-catalog.md` and the client slot catalog regenerate with both packages and all three contributions; both READMEs carry audited short Model Experience entries; the refreshed `plugin-config` golden records the tab and the refreshed `lifecycle-chrome` goldens record the footer trigger. The snapshot contract stays point-in-time and read-only; mutation continues to flow through the novel tools and service. Separately, the base bundle now pins `timeoutMs: 60000` on `pwsh-sandbox` too, matching `bash-sandbox`, so the settings shell card's composed default is platform-uniform.