# novel/ — 长篇小说写作能力家族

[English](README.md) | 中文

小说写作工作区:一个持久的小说连续性存储与驱动它的面向模型工具。

| 包 | 角色 | ctx key |
|---|---|---|
| [`novel/`](novel/README.md) | `ctx.novel` 工作区服务:世界引擎、剧情伏笔账本、创作决策、章节知识控制、Markdown 导出。 | `ctx.novel` |
| [`novel-tools/`](novel-tools/README.md) | 24 个基于 `ctx.novel` 的面向模型小说工具。 | (注册到 `ctx.tools`) |
| [`novel-api/`](novel-api/README.md) | 面向网页可视化的小说工作区只读 Remote 投影。 | `ctx.novelWorkspace` |
| [`novel-bundle/`](novel-bundle/README.md) | 可安装的 `dsh --profile` 包,把服务与其工具组合挂载在一起。 | — |

服务包拥有存储契约;工具包拥有面向模型的表面。bundle 是让二者对 agent 可用的组合。