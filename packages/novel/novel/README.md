# @deepseek-ai/dsh-novel

English | [中文](README.zh.md)

The novel-writing workspace service: a long-fiction continuity store in SQLite with markdown export, owned by the host session.

## What it does

Mounting this package registers one singleton service, `ctx.novel` (`NovelService`). It keeps the fiction's world engine (subjects and their folded state over a story timeline), the plot vow ledger (planted promises with advance/payoff/abandon history), creative decisions (architecture-decision records for prose, with options, choice, and rationale), the chapter knowledge-control ledger (what reader, protagonist, and the draft itself must know or conceal per chapter), the plot structure (stories, threads, and scenes anchored to the world), and the canon lorebook (omniscient story bible plus per-subject knowledge layers). It also ships the neuro-book interop module (`./nb`): import a neuro-book project's `lorebook/` markdown and World Engine SQLite into the store, and export the store into a neuro-book-shaped project. The 24 tools of `dsh-novel-tools` implement the model-facing tools over this service; this package ships no tools.

Everything is durably stored under `<root>/state.sqlite` (the `root` config key, resolved relative to the process working directory, default `novel`). `exportMarkdown()` renders the store to stable markdown files under `<root>/world-engine/`, `<root>/plot/`, `<root>/decisions/`, and `<root>/chapters/`. Reads and writes are synchronous on one SQLite connection opened by the service's owning fiber, and the file is closed when that fiber disposes.

## Story time

A `StoryTime` is `{ year, month, day }` on the story's own timeline, independent of wall clock. Months and days are 1-based but not calendar-validated: month 13 and day 32 are legal positions. The timeline is bounded to ±99999 years. It serializes to the fixed-width `YYYYYY.MM.DD` form using an unsigned offset encoding (year + 100000), which keeps serialized times lexicographically sortable across the sign boundary; `parseStoryTime` accepts only that exact form and `validateStoryTime` rejects anything outside the bounds. `displayStoryTime` renders the same digits with a sign prefix for readability.

## Single owner

The store belongs to the host session that mounted the service. Tools resolve it through `ctx.get('novel')`; without the bundle no service exists and the tools report a missing runtime instead of fabricating one. See `dsh-novel-tools` for the tool surface and `dsh-novel-bundle` for the composition.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `root` | `'novel'` | Directory holding `state.sqlite` and the markdown export; resolved against the working directory. |

The value is validated by the Loader against the service's static `Config` (`z.string()`). A non-string root fails the mount loudly.

## Durable consistency

Writes happen in single transactions (`world events`, `vow transitions`, and `decisions` each commit atomically with their dependent rows). Foreign keys are enforced, WAL journaling is on, and `user_version` stamps the schema version. The `./invariant` companion (mounting `@deepseek-ai/dsh-invariants`) audits the store at runtime: orphaned `world_changes`/`vow_transitions` rows, story times that no longer parse, and vows marked paid off without a payoff transition. The store keeps no compatibility promise across schema versions.

## Export shape

A Service class plugin: it default-exports `NovelService` (which the Loader instantiates on the host plane with `Config`). The companion `./invariant` is a separate function/namespace plugin — it exports `name` / `inject` / `apply` and NO default, because a stray default export would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Mounted service

#### What the model sees

The model never sees this service directly; it reaches it through the tools registered by [`dsh-novel-tools`](../../novel/novel-tools/README.md). Model-visible text is confined to those tools' results, which embed story times in their display form (`1200.01.01`, `-12.11.03`), subject ids, vow ids, and decision ids.

#### Token effect

The service contributes no prompt tokens of its own. Each mounted tool contributes its fixed schema cost to requests where it is visible.

#### KV Cache effect

Prefix-stable: the service itself adds nothing to any request. Tool schemas are stable unless the composition changes tool visibility.

### Store and export

#### What the model sees

Exported documents are plain markdown: subject ledgers, the event timeline, the folded world state, the vow ledger with full transition history, decisions with options and choice, and per-chapter knowledge ledgers. Story times appear in their display form (`1200.01.01`, `-100.01.01`).

#### Token effect

None at runtime: exports are files the model can read with its file tools, not injected context. Markdown grows linearly with store size.

#### KV Cache effect

Exports do not participate in the request stream and have no cache effect. Nothing in the service reorders or rewrites request prefixes.

## Known Limitations and Deferred Work

- **One store, one process** — the connection is synchronous and owned by the mounting fiber; no concurrent writers, no network access, and no migration path across schema versions (the pre-release stance rejects old on-disk formats).
- **The story calendar is intentionally unvalidated** — month 13 and day 32 are legal positions, and years are bounded to ±99999.
- **The ledger has no deletion or reordering** — events, vows, transitions, decisions, and chapters are append-or-upsert only; correction is a new write, and `listVows` orders by planting time.
- **`createdAt` is wall-clock** — decisions record the real timestamp of the record, not a story time, and are listed newest first.
- **The export is a snapshot** — `exportMarkdown` writes current state; it is not a live view of the store.
