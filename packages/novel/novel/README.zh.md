# @deepseek-ai/dsh-novel

[English](README.md) | 中文

小说创作工作区服务:以 SQLite 为底的长篇虚构连贯性存储,支持 Markdown 导出,由宿主会话持有。

## 功能

挂载本包会注册一个单例服务 `ctx.novel`(`NovelService`)。它维护小说的世界引擎(主体及其在故事时间轴上的折叠状态)、剧情誓约账本(已立誓约及其推进/兑现/放弃历史)、创作决策(面向散文的架构决策记录,含选项、选择与理由)、章节知识控制账本(每章读者、主角与草稿本身须知或须隐藏的内容)、剧情结构(story/thread/scene,场景锚定世界时间与出场主体),以及 canon 设定库(全知世界圣经 + 按主体的知识分层)。它还携带 neuro-book 互操作模块(`./nb`):把 neuro-book 项目的 `lorebook/` Markdown 与世界引擎 SQLite 导入本存储,并把本存储导出为 neuro-book 形态的项目。`dsh-novel-tools` 包的 24 个模型端工具建立在此服务之上;本包不提供任何工具。

一切持久化在 `<root>/state.sqlite` 下(`root` 配置项,相对进程工作目录解析,默认 `novel`)。`exportMarkdown()` 将存储渲染为 `<root>/world-engine/`、`<root>/plot/`、`<root>/decisions/`、`<root>/chapters/` 下的稳定 Markdown 文件。读写同步执行于挂载该服务的 fiber 打开的单条 SQLite 连接,连接在 fiber 释放时关闭。

## 故事时间

`StoryTime` 是故事自身时间轴上的 `{ year, month, day }`,与挂钟时间无关。月、日从 1 起但不做日历校验:13 月、32 日都是合法位置。时间轴限定在 ±99999 年内。它序列化为定宽 `YYYYYY.MM.DD` 形式,使用无符号偏移编码(年 + 100000),使序列化文本跨符号边界保持字典序可排序;`parseStoryTime` 只接受该精确形式,`validateStoryTime` 拒绝越界值。`displayStoryTime` 与 `parseDisplayStoryTime` 负责与人(及模型)打交道的 `±YYYY.MM.DD` 形式。

## 单一属主

存储属于挂载了该服务的宿主会话。工具通过 `ctx.get('novel')` 解析它;未挂载 bundle 时不存在服务,工具会报告缺失运行时而不是伪造一个。工具面见 `dsh-novel-tools`,组合方式见 `dsh-novel-bundle`。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `root` | `'novel'` | 存放 `state.sqlite` 与 Markdown 导出的目录;相对工作目录解析。 |

该值由 Loader 依据服务的静态 `Config`(`z.string()`)校验。非字符串的 root 会在挂载时大声失败。

## 持久一致性

写入发生在单事务内(世界事件、誓约转移、决策各自连同依赖行原子提交)。外键强制开启,WAL 日志开启,`user_version` 标记模式版本。`./invariant` 伴生(挂载 `@deepseek-ai/dsh-invariants`)在运行时审计存储:孤儿 `world_changes`/`vow_transitions` 行、无法再解析的故事时间、标记为已兑现却没有兑现转移的誓约。存储跨模式版本不提供兼容承诺。

## 导出形态

一个 Service 类插件:默认导出 `NovelService`(Loader 在宿主平面以其 `Config` 实例化)。伴生 `./invariant` 是独立的函数/命名空间插件——它导出 `name` / `inject` / `apply` 且无默认导出,因为多余的默认导出会经 Loader 的 `unwrapExports` 折叠模块并丢失 `inject`(见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md))。

## Model Experience

### 挂载的服务

#### 模型看到什么

模型从不直接看到本服务;它经由 [`dsh-novel-tools`](../../novel/novel-tools/README.md) 注册的工具触达。模型可见文本限于这些工具的结果,其中故事时间以显示形式(`1200.01.01`、`-12.11.03`)出现,连同主体 id、誓约 id 与决策 id。

#### Token 影响

服务自身不贡献任何提示词 token。每个已挂载工具在其可见的请求中贡献固定的 schema 成本。

#### KV Cache 影响

前缀稳定:服务本身不向任何请求添加内容。工具 schema 在组合不改变工具可见性时保持稳定。

### 存储与导出

#### 模型看到什么

导出的文档是普通 Markdown:主体账本、事件时间轴、折叠后的世界状态、带完整转移历史的誓约账本、含选项与选择的决策,以及每章知识账本。故事时间以显示形式(`1200.01.01`、`-100.01.01`)出现。

#### Token 影响

运行时为零:导出是模型可用文件工具读取的文件,不是注入的上下文。Markdown 随存储规模线性增长。

#### KV Cache 影响

导出不参与请求流,无缓存影响。服务不重排或改写请求前缀。

## Known Limitations and Deferred Work

- **单存储、单进程** —— 连接是同步的且归挂载 fiber 所有;无并发写者、无网络访问、无跨模式版本迁移路径(预发布立场拒绝旧的磁盘格式)。
- **故事日历刻意不做校验** —— 13 月与 32 日是合法位置,年份限定 ±99999。
- **账本无删除或重排** —— 事件、誓约、转移、决策与章节只增或 upsert;纠错即新写入,`listVows` 按立约时间排序。
- **`createdAt` 是挂钟时间** —— 决策记录的是真实时间戳而非故事时间,按最新在前列出。
- **导出是快照** —— `exportMarkdown` 写入当前状态;它不是存储的实时视图。