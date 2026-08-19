# novel/ — long-form fiction writing capability family

English | [中文](README.zh.md)

The novel-writing workspace: a durable fiction continuity store and the model-facing tools that drive it.

| Package | Role | ctx key |
|---|---|---|
| [`novel/`](novel/README.md) | The `ctx.novel` workspace service: world engine, plot vow ledger, creative decisions, chapter knowledge control, markdown export. | `ctx.novel` |
| [`novel-tools/`](novel-tools/README.md) | The 24 model-facing novel tools over `ctx.novel`. | (registers on `ctx.tools`) |
| [`novel-api/`](novel-api/README.md) | Read-only Remote projection of the novel workspace for the Web visualization. | `ctx.novelWorkspace` |
| [`novel-bundle/`](novel-bundle/README.md) | Installable `dsh --profile` bundle that mounts the service and its tools together. | — |

The service package owns the store contract; the tools package owns the model-facing surface. The bundle is the composition that makes both available to an agent.
