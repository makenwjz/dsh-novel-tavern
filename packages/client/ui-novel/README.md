# @deepseek-ai/dsh-client-ui-novel

English | [中文](README.zh.md)

**Novel workspace** and **tavern** surfaces for the Web app: a Settings tab plus two fullscreen project surfaces, each opened by its own draggable floating seal. The browser plugin registers one localized `settings.plugins.tab` contribution with id `novel`, and four `shell.overlay` contributions — the novel studio seal and fullscreen explorer (`novel-seal`, `novel-studio`) and the tavern seal and fullscreen explorer (`tavern-seal`, `tavern-studio`). Each seal shares a store handle with its own surface, so the open flag and screen position can never disagree between the button and the panel it opens; the two surfaces never share a store. It performs no Remote read during plugin activation: selecting the tab or opening a surface mounts it and lazily loads through [`api-remotes`](../../api/remotes/README.md).

The novel studio renders the whole novel workspace from one snapshot: the world fold point and subject cards with kind badges and folded fields, the story timeline in story order, the plot vow ledger with status chips and transition history, the creative decisions with options and outcomes, the chapter knowledge-control rows, manuscript drafts and the canon lorebook. Display-form story times and the store root directory are shown verbatim. Loading, failure, empty, and retry states stay local to the mounted component; a refresh button re-reads the snapshot on demand. When the deployment mounts no novel service, the read fails loud and the surfaces show an explanatory message instead of transport details.

The tavern surface is a WeChat-style chat app by default: a session list on the left (each tavern-bound conversation with the bound character's PNG portrait as avatar, hover to delete/archive a conversation) and a bubble conversation on the right. "Start new chat" creates a fresh session under the `tavern` agent preset, binds the character cards and worldbooks, and opens the conversation so the character greets you; messages are sent through `session.prompt` and the reply is picked up by polling `session.history`. A "Library" tab keeps the management surface: worldbooks with their entries, character cards with portrait images and extension fields, imports (character cards PNG with a `chara`/`ccv3` chunk, or JSON; worldbook JSON exports), deletes, and session binding controls (start/stop/unbind). Deleting a conversation archives the session through `workspace.archiveSession`, so it leaves every list while its data stays recoverable in storage. Common import failures are mapped to actionable explanations (for example a PNG without card metadata). The registrations use `ctx.slots.inject()`, so they follow late declaration, redeclaration, locale changes, and teardown without importing the slot owners.

## Model Experience

None, as this package only visualizes Host-owned snapshots and drives the tavern RPC domain in the browser; it registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or surface open** — the surfaces do not subscribe to store changes or automatically refetch after reconnect; switching tabs or reopening a surface preserves the current snapshot, while reopening Settings, closing and reopening a surface, or pressing refresh obtains a new one. Imports and deletes in the tavern surface reload the tree on demand.
- **Tavern management is browser-only** — mutations (import, delete, binding) flow through the tavern RPC domain; the novel workspace itself stays read-only here, with writes flowing through the novel tools and service.
