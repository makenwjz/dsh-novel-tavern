# `@deepseek-ai/dsh-novel-bundle`

English | [中文](README.zh.md)

The long-fiction writing capability as one installable profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts three rows over any profile root — the [`dsh-novel`](../../novel/novel/README.md) workspace service (the SQLite-backed world engine, plot vow ledger, creative decisions, chapter knowledge control, and Markdown export), the [`dsh-novel-tools`](../../novel/novel-tools/README.md) package (the 24 model-facing tools over `ctx.novel`), and the [`dsh-tavern`](../../novel/tavern/README.md) SillyTavern-compatible roleplay store. A profile mounts the bundle through its `dsh.profile.bundles` list or `dsh plugin --profile <name> add @deepseek-ai/dsh-novel-bundle`; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code. The package has no runtime API.

The service row's `root` config defaults to the `novel` directory under the process working directory; a profile override restates the whole `config` (a patch replaces a row's whole config, never merging). Because `novel_lint` is pure text analysis, a later patch layer may override the `novel` service row off (e.g. behind an agent preset that mounts only the tools) without breaking that tool; the other eleven tools then fail loud with the missing-runtime error, as documented in the tools package.

## Model Experience

Indirectly, through the inserted rows: this bundle contributes no model-visible text of its own. The tools package owns the model-facing tool surface; the service package owns the store contract.

#### KV Cache effect

None directly; each inserted row's package owns its effect.

## Known Limitations and Deferred Work

- **One shared store root per process** — the service row defaults to one `novel` directory; per-agent stores are not composed by this bundle (a preset that needs them configures the service row per session).
- **No bundle-owned UI surface** — the web UI renders tool results through the generic tool view; novel-specific views are deferred.