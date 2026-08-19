# @deepseek-ai/dsh-novel-tools

English | [中文](README.zh.md)

The 24 model-facing tools over the [`dsh-novel`](../novel/README.md) workspace service: world engine, plot structure and vow ledger, canon lorebook with knowledge layers, neuro-book interop, manuscript, creative decisions, chapter knowledge control, and style lint.

## What it does

Registers the following tools on `ctx.tools`:

| Tool | Reads | Writes |
| --- | --- | --- |
| `world_subject` | — | register or update a subject |
| `world_event` | — | record a timeline event with subject changes |
| `world_state` | — | folded world state at the latest or a given story time |
| `world_history` | list the story event log with subject changes | — |
| `plot_story` | — | create a plot story (causal spine) |
| `plot_thread` | — | create a plot thread inside a story |
| `plot_scene` | — | create or update a scene anchored to time/location/subjects, attaching the vows it should settle |
| `plot_list` | list the whole story/thread/scene tree with vow statuses and overdue hints | — |
| `lore_register` | — | register or update a canon lorebook entry (omniscient bible or character-scoped knowledge) |
| `lore_list` | list canon lore entries, filtered by category/subject/layer | — |
| `lore_context` | read the knowledge layer of one subject (omniscient + scoped) | — |
| `nb_import` | — | import a neuro-book project (lorebook markdown + World Engine SQLite) into the workspace |
| `nb_export` | — | export the workspace into a neuro-book-shaped project (lorebook markdown + World Engine SQLite + JSONL) |
| `manuscript_write` | — | upsert one chapter's prose draft |
| `manuscript_read` | list chapter drafts (one or all) | — |
| `vow_plant` | — | plant a plot vow |
| `vow_advance` / `vow_payoff` / `vow_abandon` | — | move a vow along its lifecycle |
| `vow_list` | list vows (optionally by status) | — |
| `decision_record` | — | record an open creative decision, optionally closing it |
| `decision_list` | list decisions newest first | — |
| `chapter_info` | — | upsert a chapter's knowledge-control ledger |
| `novel_lint` | lint manuscript prose | — |

All tools except `novel_lint` require the mounted service and resolve it through `ctx.get('novel')`. When the bundle is not composed they fail loud with `Error: <tool> requires the novel workspace service (mount the @deepseek-ai/dsh-novel-bundle bundle)` instead of fabricating a store. `novel_lint` is pure text analysis and works without the service.

## Story times

The tools accept and return story times in their display form (`1200.01.01`, `-12.11.03`): years 1 to 6 digits with an optional minus sign, then `.MM.DD`. The service stores the offset-encoded sortable form internally; the tools translate at the boundary (`parseDisplayStoryTime` in `dsh-novel`).

## Style lint

`novel_lint` runs 20 advisory rules over the submitted text (10 Chinese, 10 English): banned adverbs and exclamations, explanatory phrases, vague time jumps, formulaic not-but and binary-contrast runs, dialogue-tag and comma runs, word echoes, told emotion, passives, filler words, and more. Rules without a threshold report every hit; `zh/tag-run` (3 tags per line) and `zh/comma-run` (5 commas per line) report once per line once the line reaches the threshold. Hits carry the rule id, severity, 1-based line, and a bounded excerpt.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `includeLintTool` | `true` | whether `novel_lint` is registered at all |

Setting `includeLintTool: false` registers the other 23 tools only; it does not change their behavior.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)). The companion `./invariant` registers the package name with `dsh-invariants` and installs no checks: the durable-store relationships live in `dsh-novel`'s own companion.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated schemas for the 24 tools ([catalog](../../../docs/tool-catalog.md#deepseek-aidsh-novel-tools)), with story times documented as `±YYYY.MM.DD` display strings and the lint rules summarized in `novel_lint`'s description.

#### Token effect

Fixed schema cost on every request where the tools are visible: 23 tools by default, or 24 with `includeLintTool: true`.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Compositions that differ in `includeLintTool` cannot share the visible-tool prefix.

### Tool-call history and result

#### What the model sees

Each tool returns its durable ids (`subject-1`, `event-1`, `vow-1`, `decision-1`, `story-1`, `thread-1`, `scene-1`, `lore-1`), display-form story times, and statuses; `world_state` returns the folded fields (optionally at a past story time), `world_history` the event log with subject changes, `plot_list` the full story/thread/scene tree with each attached vow's status and an `overdue` hint, `lore_context` the omniscient canon plus one subject's scoped knowledge, `manuscript_read` the chapter drafts, `vow_list` the full transition history, `decision_list` the options and choice, `chapter_info` the knowledge ledger. Stable failures include `Error: <tool> requires the novel workspace service (...)` when the bundle is not mounted, schema-level `invalid arguments: ...` messages, and the service's own `novel: ...` domain errors (unknown subject, vow, story, thread, scene, or lore entry; repeated option label; invalid story time or scene status; lore scoping violations).

#### Token effect

Result size grows with store content the model reads (`world_state` folds every subject; `world_history` carries every change; `plot_list` carries the whole tree; `lore_context` carries the knowledge layer; `vow_list` carries full histories). Write results are small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Service-less calls fail loud** — without the bundle the 23 store tools reject every call; there is no offline or fallback mode.
- **Event history is a flat log** — `world_history` returns every event with its subject changes, but there is no per-subject timeline navigation or diff view; the markdown export remains the full-history artifact.
- **The plot tree is a flat read** — `plot_list` returns the whole tree in one call; there is no per-scene paging or incremental read.
- **The lorebook is tool-read only** — `lore_context` exposes knowledge layers on demand; there is no automatic per-session injection of canon into the prompt (that belongs to the tavern worldbook path).
- **The lint rule set is fixed** — 20 curated rules with two thresholds; rules are not configurable per composition.
- **No chunking for `novel_lint`** — long manuscripts must be submitted whole; the tool reports hits but does not rewrite.
