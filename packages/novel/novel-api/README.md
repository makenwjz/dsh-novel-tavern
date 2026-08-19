# @deepseek-ai/dsh-novel-api

English | [中文](README.zh.md)

Read-only Host projection of the novel workspace for the Web visualization. `NovelApiGateway` registers the `novelWorkspace` service and publishes one generated direct Remote, `novelWorkspace/workspace`. Every call resolves the optional `novel` service through `ctx.get()` and projects the whole store into one JSON-safe snapshot with display-form story times: the world fold point and subject states, the story events in story order, the plot vows with their full transition history, the creative decisions with options and outcomes, and the chapter knowledge-control rows. The store root directory accompanies the snapshot so the settings UI can surface where the data lives.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge and no `novel` injection: deployments without the bundle still mount the gateway, and the missing runtime fails loud on the method call instead of at plugin load. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

## Model Experience

None, as this Host-only read projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time snapshot only** — every `workspace()` call re-reads the store; the snapshot has no subscription, delta, or pagination, so the settings UI decides when to refetch.
- **No mutation path** — the projection is read-only; model and CLI mutation continue to flow through the novel tools and service.