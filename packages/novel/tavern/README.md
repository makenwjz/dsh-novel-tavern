# @deepseek-ai/dsh-tavern

English | [中文](README.zh.md)

SillyTavern-compatible roleplay store for the novel workspace. `TavernService`
imports lorebook (worldbook) JSON exports and character cards (JSON or PNG with
a `chara`/`ccv3` text chunk), validates them loud, mints stable ids, and feeds
a per-session prompt section that injects the character and the
keyword-activated lorebook entries. Sessions bind to the store through a typed
`tavern/binding` session event, so the binding is a pure replay quantity
recovered from the session log on restarts and cold reads.

The store is process-wide (one lorebook + character card store per host), while
the binding is per-session. Store mutations need no session; binding reads and
writes name one. The prompt section registers against `ctx.systemPrompt` and
delegates activation to the keyword window (`activationTextLimit` characters of
recent message text) with constant entries always active.

Deployments that want to cut per-turn tokens and automatic title requests enable
`lean` mode: the character block trims to name, description, and first message,
and the browser surface drives `ctx.tavern.setLean` which also turns off
automatic session-title generation through the title service. Lorebooks support
activation stages (`stage` on an entry, `stage` on the binding): stage 0 entries
stay active on every stage, and `advanceStage` moves a session into the next
staged set. Character cards may carry MVU status variables under
`extensions.mvu.variables`; these inject as a status block in full mode.

## Model Experience

One prompt section, `tavern:context`, contributes the following model-visible
material in full tavern mode with an active lore set:

```text
## 角色扮演设定
你现在扮演 {name}。以下设定必须遵守：
- 性格: {personality}
- 背景: {scenario}
- 人物介绍: {description}
- 对话示例: {mesExample}
- 额外设定: {systemPrompt}
- 行为准则: {postHistoryInstructions}
## 角色状态
- {key}: {value}
本对话必须以上述角色的开场白开始：
{firstMes}
## 已激活的世界书设定
当前文本激活了以下世界设定，回答时不得与之矛盾：
- 《{bookName}》：{content}
```

Novel mode (or a tavern mode without a character card) injects only the
activated worldbook block; with no activated entries the section is empty. Lean
mode trims the character block to name, description, first message, and the
worldbook block. A binding carrying several `characterIds` injects one trimmed
roleplay block per card (name and description), followed by the worldbook
block; a single card injects the full block below. The `{{char}}` and `{{user}}`
macros substitute to the character name and `用户` respectively across every
card field.

#### KV Cache effect

The activation text window is capped at `activationTextLimit` characters
(default 4000). The injected section itself is prompt-visible on every assembly;
its size is the rendered template above. `lean` mode materially reduces the
per-turn character block.

## Known Limitations and Deferred Work

- **Multi-character roleplay is trimmed** — a binding with several
  `characterIds` injects name-and-description blocks only; full fields, MVU
  status, and openers stay single-character.
- **Integer activation stage only** — stage is an integer counter advanced
  explicitly by `advanceStage`; there is no automatic progression driven by
  story progress or a stage-aware worldbook format beyond the plain `stage`
  field.
- **MVU read-only** — status variables inject into the prompt but there is no
  runtime mutation path (no per-turn variable updates or UI editing).
- **Import ignores unknown fields** — tool-era extension fields parse without
  error but only the supported subset projects; unsupported field values are
  dropped silently.
