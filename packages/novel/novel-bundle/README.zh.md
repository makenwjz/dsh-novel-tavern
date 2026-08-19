# `@deepseek-ai/dsh-novel-bundle`

[English](README.md) | 中文

把长篇小说写作能力作为一个可安装的 profile bundle 提供：[`cordis.patch.yml`](cordis.patch.yml) 在任何 profile 根上插入三行——[`dsh-novel`](../../novel/novel/README.md) 工作区服务（SQLite 支撑的世界引擎、剧情伏笔账本、创作决策、章节知识控制与 Markdown 导出）、[`dsh-novel-tools`](../../novel/novel-tools/README.md) 包（基于 `ctx.novel` 的 24 个面向模型工具）和 [`dsh-tavern`](../../novel/tavern/README.md) SillyTavern 兼容酒馆商店。profile 通过其 `dsh.profile.bundles` 列表挂载该 bundle，或用 `dsh plugin --profile <name> add @deepseek-ai/dsh-novel-bundle` 安装；profile 组合器通过 `dsh.bundle.patch` manifest 字段解析补丁，绝不通过代码。本包没有运行时 API。

服务行的 `root` 配置默认为进程工作目录下的 `novel` 目录；profile 覆盖需要重述整个 `config`（补丁替换整行配置，从不合并）。由于 `novel_lint` 是纯文本分析，后面的补丁层可以把 `novel` 服务行覆盖关闭（例如在只挂载工具的 agent preset 之后），而不会破坏该工具；其余 11 个工具此时会以 missing-runtime 错误大声失败，如工具包文档所述。

## Model Experience

间接地，通过插入的行：本 bundle 本身不贡献任何模型可见文本。工具包拥有面向模型的工具表面；服务包拥有存储契约。

#### KV Cache 影响

无直接影响；每个插入行所属的包拥有各自的影响。

## Known Limitations and Deferred Work

- **每个进程一个共享存储根** — 服务行默认为一个 `novel` 目录；本 bundle 不组合按 agent 隔离的存储（需要它的 preset 须按会话配置服务行）。
- **没有 bundle 自有的 UI 表面** — web UI 通过通用工具视图渲染工具结果；novel 专属视图已推迟。