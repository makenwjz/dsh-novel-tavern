# @deepseek-ai/dsh-novel-tools

[English](README.md) | 中文

建立在 [`dsh-novel`](../novel/README.md) 工作区服务之上的 24 个模型端工具:世界引擎、剧情结构与誓约账本、canon 设定库与知识分层、neuro-book 互操作、正文管理、创作决策、章节知识控制与风格检查。

## 功能

在 `ctx.tools` 上注册以下工具:

| 工具 | 读 | 写 |
| --- | --- | --- |
| `world_subject` | — | 注册或更新主体 |
| `world_event` | — | 记录带主体变更的时间轴事件 |
| `world_state` | — | 最新或指定故事时间处的折叠世界状态 |
| `world_history` | 列出带主体变更的故事事件日志 | — |
| `plot_story` | — | 创建剧情故事(因果主轴) |
| `plot_thread` | — | 在故事内创建剧情线程 |
| `plot_scene` | — | 创建或更新场景,锚定时间/地点/出场主体,挂载本场景应了结的伏笔 |
| `plot_list` | 列出完整 story/thread/scene 树,含伏笔状态与超期提示 | — |
| `lore_register` | — | 注册或更新 canon 设定条目(全知圣经或角色私有知识) |
| `lore_list` | 按类别/主体/分层筛选列出 canon 设定 | — |
| `lore_context` | 读取某主体的知识层(全知 + 私有) | — |
| `nb_import` | — | 把 neuro-book 项目(lorebook Markdown + 世界引擎 SQLite)导入工作区 |
| `nb_export` | — | 把工作区导出为 neuro-book 形态项目(lorebook Markdown + 世界引擎 SQLite + JSONL) |
| `manuscript_write` | — | upsert 某章正文草稿 |
| `manuscript_read` | 列出章节正文(单章或全部) | — |
| `vow_plant` | — | 立下剧情誓约 |
| `vow_advance` / `vow_payoff` / `vow_abandon` | — | 推进誓约生命周期 |
| `vow_list` | 列出誓约(可按状态过滤) | — |
| `decision_record` | — | 记录开放创作决策,可选当场关闭 |
| `decision_list` | 按最新在前列出决策 | — |
| `chapter_info` | — | upsert 章节知识控制账本 |
| `novel_lint` | 检查稿件散文 | — |

除 `novel_lint` 外的所有工具都要求挂载服务,并通过 `ctx.get('novel')` 解析。未组合 bundle 时,它们大声失败:`Error: <tool> requires the novel workspace service (mount the @deepseek-ai/dsh-novel-bundle bundle)`,而不是伪造一个存储。`novel_lint` 是纯文本分析,不依赖服务即可工作。

## 故事时间

工具接受并返回显示形式的故事时间(`1200.01.01`、`-12.11.03`):1 至 6 位年(可带负号),后接 `.MM.DD`。服务内部保存偏移编码的可排序形式;工具在边界处转换(`dsh-novel` 的 `parseDisplayStoryTime`)。

## 风格检查

`novel_lint` 对提交文本运行 20 条建议性规则(10 条中文、10 条英文):禁用瞬间副词与感叹号连用、解说词、空洞时间、公式化"不是…而是…"与二元对比排比、对话标签与逗号密集、词语复读、告知式情感、被动语态、口头禅等。无阈值的规则报告每次命中;`zh/tag-run`(每行 3 个标签)与 `zh/comma-run`(每行 5 个逗号)在行达到阈值后每行只报一次。命中携带规则 id、严重级别、从 1 起的行号与有界摘录。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `includeLintTool` | `true` | 是否注册 `novel_lint` |

设为 `includeLintTool: false` 时只注册其余 23 个工具;不改变其余工具的行为。

## 导出形态

一个函数/命名空间插件:导出 `name` / `inject` / `apply` 且无默认导出。多余的默认导出会经 Loader 的 `unwrapExports` 折叠模块并丢失 `inject`(见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md))。伴生 `./invariant` 向 `dsh-invariants` 注册包名但不安装任何检查:持久存储关系由 `dsh-novel` 自己的伴生负责。

## Model Experience

### 工具 schema

#### 模型看到什么

模型看到 24 个工具生成的 schema([目录](../../../docs/tool-catalog.md#deepseek-aidsh-novel-tools)),故事时间文档化为 `±YYYY.MM.DD` 显示字符串,`novel_lint` 的描述中概括了规则。

#### Token 影响

工具可见的每个请求承担固定 schema 成本:默认 23 个工具,`includeLintTool: true` 时为 24 个。

#### KV Cache 影响

定义与可见性不变时前缀稳定。`includeLintTool` 取值不同的组合无法共享可见工具前缀。

### 工具调用历史与结果

#### 模型看到什么

每个工具返回其持久 id(`subject-1`、`event-1`、`vow-1`、`decision-1`、`story-1`、`thread-1`、`scene-1`、`lore-1`)、显示形式故事时间与状态;`world_state` 返回折叠字段(可选指定过去的故事时间),`world_history` 返回带主体变更的事件日志,`plot_list` 返回完整 story/thread/scene 树(含每个挂载伏笔的状态与 `overdue` 超期提示),`lore_context` 返回全知 canon 加某主体的私有知识,`manuscript_read` 返回章节正文草稿,`vow_list` 返回完整转移历史,`decision_list` 返回选项与选择,`chapter_info` 返回知识账本。稳定失败包括未挂载 bundle 时的 `Error: <tool> requires the novel workspace service (...)`、schema 层的 `invalid arguments: ...` 消息,以及服务自身的 `novel: ...` 领域错误(未知主体、誓约、故事、线程、场景或设定条目;重复选项标签;非法故事时间或场景状态;设定作用域违例)。

#### Token 影响

结果大小随模型读取的存储内容增长(`world_state` 折叠每个主体;`world_history` 携带全部变更;`plot_list` 携带整棵树;`lore_context` 携带知识层;`vow_list` 携带完整历史)。写入结果小而形状固定。

#### KV Cache 影响

只增;新可见内容跟随可复用请求前缀,不会使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **无服务即大声失败** —— 未挂载 bundle 时,23 个存储工具拒绝每次调用;没有离线或降级模式。
- **事件历史是平铺日志** —— `world_history` 返回每个事件及其主体变更,但没有按主体的时间线导航或 diff 视图;逐事件全量历史仍在 Markdown 导出中。
- **剧情树是单次平铺读取** —— `plot_list` 一次返回整棵树;没有按场景分页或增量读取。
- **设定库仅工具读取** —— `lore_context` 按需暴露知识层;没有自动的每会话 canon 提示词注入(那属于酒馆世界书路径)。
- **规则集固定** —— 20 条精选规则带两个阈值;规则不可按组合配置。
- **`novel_lint` 不分块** —— 长稿件须整体提交;工具只报告命中,不重写。
