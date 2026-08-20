# DeepSeek Harness 小说模式 + 酒馆模式 集成教程

> 版本：**v0.1** ｜ 仓库：<https://github.com/makenwjz/dsh-novel-tavern>
>
> 让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 变成**小说创作工作台 + SillyTavern 风格的角色扮演酒馆**。本项目由两个互相独立又可联动的模式组成，并做了完整的浏览器 UI（原神风、微信式聊天、角色卡渲染）。

---

## 目录

1. [这是什么](#1-这是什么)
2. [功能总览](#2-功能总览)
3. [安装](#3-安装)
4. [快速开始：酒馆模式](#4-快速开始酒馆模式)
5. [快速开始：小说模式](#5-快速开始小说模式)
6. [角色卡深度支持](#6-角色卡深度支持)
7. [常见问题](#7-常见问题)
8. [版本 0.1 已知限制](#8-版本-01-已知限制)
9. [致谢与许可](#9-致谢与许可)

---

## 1. 这是什么

DeepSeek Harness（DSH）本身是一个 **Plugin-based Agent Harness**（基于 Cordis，一切皆插件）。本项目为它新增了两套能力：

- **小说模式（novel）**：一个长篇小说创作工作区——世界引擎（主体/势力/地点/物品 + 故事时间线折叠）、剧情伏笔账本、创作决策记录、章节知识控制、正文手稿、canon 设定库（分知识层），以及 24 个面向模型的工具。还支持与 [neuro-book](https://github.com/notnotype/neuro-book) 项目互操作（导入/导出）。
- **酒馆模式（tavern）**：一个 **SillyTavern 兼容的角色扮演商店**——导入角色卡（PNG 或 JSON）与世界书（lorebook），在**微信风格的聊天界面**里开始对话：开场白自动加载、角色卡 PNG 作为头像、消息按卡的脚本渲染成精美的 HTML 页面、卡的封面按钮（一周目/二周目/三周目/后日谈）通过桥接真正生效。

两个模式各自拥有独立的 **agent preset**（小说模式 / 酒馆模式），可在 DSH Web 界面切换。

---

## 2. 功能总览

### 小说模式

| 能力 | 说明 |
|---|---|
| 世界引擎 | 注册主体（角色/地点/势力/物品）、字段折叠、按故事时间查询任意时刻状态 |
| 剧情结构 | Story / Thread / Scene，场景锚定故事时间与出场主体 |
| 伏笔账本 | 埋设 / 推进 / 兑现 / 放弃，带完整动作历史 |
| 创作决策 | 选项 + 利弊 + 选择理由，面向散文的架构决策 |
| 章节知识控制 | 每章「读者知道 / 主角知道 / 必须隐瞒 / 可以暗示」 |
| 正文手稿 | 按章 upsert / 读取 |
| canon 设定库 | 全知层 + 角色私有层，注册 / 列表 / 上下文注入 |
| 文风检查 | `novel_lint` 纯文本规则引擎（不依赖服务也可用） |
| 章节写作工作流 | `chapter_workflow`：完整写作简报（知识控制+世界状态+设定+待兑现伏笔+上一章）+ 六步计划（审阅→规划→写→lint→查→同步账本） |
| 写作上下文注入 | `chapter_context`：一次调用返回本章所需全部上下文，模型"写的时候知道自己在哪、欠什么债" |
| 一致性检查 | `manuscript_check`：草稿 vs canon/时间线/角色状态，返回提及主体与完整设定供核对 |
| 账本自动同步 | `manuscript_scan`：扫描正文识别新伏笔信号、应推进/兑现的伏笔、提及的主体 |
| neuro-book 互操作 | `nb_import` / `nb_export`：lorebook markdown + 世界引擎 SQLite 双向迁移 |
| 浏览器 UI | 原神风全屏「小说工作室」：世界状态、时间线、伏笔、决策、章节、正文、设定库，目录式浏览 |

### 酒馆模式

| 能力 | 说明 |
|---|---|
| 角色卡导入 | SillyTavern V2/V3：PNG（`chara`/`ccv3` 文本块，支持 tEXt/iTXt/zTXt、base64、UTF-16、deflate 兜底）或 JSON；自动提取卡内嵌世界书 |
| 世界书 | lorebook JSON 导入（关键词激活 + 常驻条目 + selective 次关键词 + stage） |
| 注入预算保护 | 100+ 条大世界书默认 12000 字符预算，按插入顺序截断，防 prompt 爆炸 |
| 微信式聊天 | 左侧会话列表（角色头像）+ 右侧气泡对话 + 底部输入栏 |
| 开场白加载 | 开始新对话即自动弹出开场白，右上角可切换（first_mes + 备用开场白）；**首次发送时真正写入会话历史**，模型从开场白续写（SillyTavern 行为） |
| 角色卡渲染 | 消息按卡的 `regex_scripts`（正文美化/封面/CG渲染/变量更新美化等）渲染成 HTML，在沙箱 iframe 中展示（禁脚本同源，安全），**按内容自动撑高 + 可拖动调节** |
| promptOnly 脚本 | 卡里作用于 prompt 的脚本（变量更新对 AI 不可见、屏蔽思维链复读等）在注入端执行，模型看不到的机制不占上下文 |
| MVU 变量系统 | 会话级角色变量（`## 角色状态` 注入 prompt）；卡封面按钮经桥接 `replaceMvuData` 真实更新变量；模型每轮 `<json_patch>` 自动回放（周目/章节/场景名等） |
| 世界书条目编辑 | 资料库每条世界书可独立启用/禁用（持久化到存储文件）；卡前端周目切换在会话级覆盖生效 |
| Prompt Preset | 导入 SillyTavern Chat Completion Preset，按作者顺序组装 prompt：marker（世界书/角色介绍/性格/场景/对话示例）自动解析为对应资源，`{{char}}`/`{{user}}` 宏替换（参考 dsh-rp-distribution） |
| 卡前端桥接 | 卡的封面脚本调用的 SillyTavern API（`getChatMessages`/`setChatMessage`/`setWorldbookEntry`/`updateWorldbookWith`/`showToast`）由桥接 shim 映射到 DSH：**进入魔女监牢 = 切换开场白；一周目/二周目切换 = 按条目名启用/禁用世界书**（会话级，不硬编码卡规则） |
| 会话资源 | 聊天头部「会话资源」面板：Prompt 预设下拉、**世界书多选勾选**、**我的 Persona 编辑**、聊天导入（ST JSONL）/导出 |
| 多说话人署名 | 多角色会话中，消息以 `{名字}` 开头时自动标注说话人并切换对应角色头像 |
| 分支重写 | 每条角色回复带「重写」按钮：从该回复之前 fork 子会话并重新生成（SillyTavern 刷回复行为），父会话原样保留 |
| 会话管理 | 解除绑定 / 删除对话（归档）、错误提示点名绑定会话并可一键跳转 |
| 脚本清单 | 资料库角色卡详情以徽章形式展示卡携带的正则脚本/辅助脚本（启用/禁用/类型） |
| UI | 干净现代暗色界面（原神金 → 中性底 + 靛蓝强调），统一聊天/资料库观感 |

---

## 3. 安装

### 方式 A：把本项目作为源码仓库使用（推荐开发/社区体验）

```sh
git clone https://github.com/makenwjz/dsh-novel-tavern.git
cd dsh-novel-tavern
pnpm install
pnpm run build:lib:host && pnpm run build:lib:client
```

然后把本项目的三个包登记进 DSH 的 profile bundles：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-novel-bundle
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-novel
```

（`@deepseek-ai/dsh-novel-bundle` 会一次性挂载 novel 服务 + novel-tools + tavern 商店；`dsh-client-ui-novel` 提供浏览器 UI。若你的 DSH 用本地 checkout 运行，将上面三个包的依赖链接到 `packages/` 即可。）

### 方式 B：直接以 DSH 插件安装（若已发布到 npm）

```sh
dsh plugin --profile web add <npm包名>
```

> 本项目 v0.1 以源码形式发布；npm 发布在后续版本跟进。

### 方式 C：仅酒馆（不挂小说服务）

酒馆商店与 UI 与小说服务解耦：不挂 `dsh-novel` 时酒馆面板依然可用（小说工作室会提示未挂载）。

---

## 4. 快速开始：酒馆模式

### 4.1 切换到酒馆模式

1. 打开 DSH Web（默认 `http://127.0.0.1:3080`）
2. 左下角「设置 → Agent 预设」选择 **酒馆模式**（或在 `~/.dsh/settings.yaml` 设 `agent-presets.default: tavern`）

### 4.2 导入角色卡

1. 点击右下角 **🍺 酒馆悬浮球** → 打开酒馆界面（默认「聊天」视图）
2. 切到「**资料库**」标签
3. 「导入角色卡」选择文件：
   - **PNG 卡**：SillyTavern 导出的带 `chara`/`ccv3` 元数据的 PNG
   - **JSON 卡**：V2/V3 JSON
4. 卡内嵌的世界书会自动提取并出现在「世界书」列表
5. 也可单独「导入世界书」（lorebook JSON）或粘贴 JSON

> 如果 PNG 不是角色卡（没有 `chara`/`ccv3` 数据），会给出明确中文提示，不会假导入。

### 4.3 开始新对话

1. 回到「聊天」视图，点 **＋ 开始新对话**
2. 系统自动创建一个酒馆会话（agent preset 为 `tavern`），绑定角色卡与世界书
3. **开场白自动弹出**——右上角下拉可切换：开场白 1/2/3/4/5（对应卡的 first_mes 与备用开场白）
4. 直接在下框输入消息，角色按设定回应；回复消息按卡的脚本渲染成 HTML 页面（沙箱 iframe，可拖动底部 `⋮⋮` 调整高度）

### 4.4 角色卡的封面 / 周目切换（如「魔女审判」类卡）

卡的封面页面带「进入魔女监牢」「一周目/二周目/三周目/后日谈」等按钮，这些按钮通过桥接真正生效：

- **进入魔女监牢** → 把选中周目的开场白设为对话第一条消息
- **一周目/二周目/三周目/后日谈** → 按条目名启用/禁用对应世界书条目（比如只激活 `A1_C1_*`），模型上下文随之切换

> 不需要理解卡的命名规则：桥接按**卡告诉我们的条目名**做会话级过滤，任何「切章节/切周目」的卡都通用。

### 4.5 会话管理

- **切换开场白**：聊天顶部下拉
- **解除绑定**：聊天顶部「解除绑定」按钮，彻底清空该会话的角色+世界书绑定（之后才能删除对应项目）
- **删除对话**：左侧会话列表悬停行尾 `✕`，确认后归档（数据仍在存储中可找回）
- **删除角色卡/世界书**：资料库详情里删除；若被会话绑定，提示会点名会话并提供「去聊天解除绑定」一键跳转

---

## 5. 快速开始：小说模式

1. 切换 Agent 预设为 **小说模式**（默认即小说模式）
2. 点击 **🖋 小说悬浮球** 打开「小说工作室」全屏浏览器
3. 通过对话使用 24 个工具（`world_subject`、`world_event`、`world_state`、`world_history`、`plot_story/thread/scene`、`vow_*`、`decision_*`、`chapter_info`、`manuscript_write/read`、`lore_*`、`novel_lint`、`nb_import/export` 等）
4. 浏览器界面实时展示：世界状态、时间线、伏笔台账、创作决策、章节知识、正文、设定库

> 所有工具都有中文描述；`novel_lint` 纯文本可用，其余需要挂载 novel 服务（`@deepseek-ai/dsh-novel-bundle`）。

---

## 6. 角色卡深度支持

### 支持的卡格式

| 类型 | 说明 |
|---|---|
| V2 PNG | `chara` chunk（base64 JSON；支持 Latin-1/UTF-8、UTF-16、deflate、BOM 兜底） |
| V3 PNG | `ccv3` chunk（`{spec, data}` 信封自动解开） |
| JSON | V2/V3、`{spec,data}` 信封、宽松字段校验（错误类型自动纠偏不炸卡） |
| 内嵌世界书 | V3 `character_book` 或旧版 `extensions.world_book`，导入时自动拆出为独立世界书 |

### 消息渲染

卡携带的 `regex_scripts`（`markdownOnly` 类，如正文美化/封面/CG渲染/变量更新美化）会作用于消息文本，产出 HTML 后在**沙箱 iframe** 中渲染：

- 禁脚本、禁同源（`sandbox="allow-scripts"`），样式正常显示
- 高度按内容自动撑开，底部把手可拖动调整
- 卡自己的前端 JS 通过桥接 shim 运行（视觉交互可用，ST 专属 API 映射到 DSH）

### 世界书激活

- 关键词命中 + 常驻（constant）条目 + selective 次关键词 + stage
- **会话级条目名禁用**（卡前端驱动周目/章节切换）
- **注入预算**：默认 12000 字符/轮，按插入顺序保留核心设定，防止 100+ 条大世界书撑爆上下文

---

## 7. 常见问题

| 问题 | 解决 |
|---|---|
| 导入 PNG 提示「缺少 chara/ccv3 数据」 | 该 PNG 不是带元数据的 SillyTavern 角色卡；用 SillyTavern 的「角色卡图片」导出，或改用 JSON 卡 |
| 删除角色卡/世界书提示「仍被会话绑定」 | 提示会点名会话；点「去聊天解除绑定」→ 对会话点「解除绑定」→ 回来删除 |
| 世界书很大、每轮 token 爆炸 | 已内置注入预算（默认 12000 字符）；可在 tavern 配置调 `activationCharBudget` |
| 开场白没弹出来 | 确认页面已刷新、卡含开场白（资料库看详情）；v0.1 已知：开场白为显示层加载 |
| 模型回复裸露 `<now_plot>`/`<update>` 标记 | 卡的正则脚本格式为 `/pattern/flags`，本项目已正确解析；若个别卡脚本格式特殊请反馈 |
| 浏览器工具不可用 | 需 Chromium 系浏览器：`npx playwright install chromium` 或配置 `launch.channel: chrome/msedge` |

---

## 8. 版本 0.2 已知限制

- 开场白已写入会话历史；但**开场白切换仅在对话未开始时有效**（与 SillyTavern 一致，对话开始后不可改）
- MVU 变量为**扁平键值**注入（嵌套路径折叠为末段键名，如 `/world_info/time/current_time` → `current_time`）；完整嵌套变量渲染在规划中
- 世界书条目手动编辑作用于**存储文件**（全局生效）；卡前端周目切换是**会话级**覆盖，两者叠加
- `promptOnly` 脚本已执行（作用于注入文本）；卡内 `tavern_helper` 脚本本身仍不执行
- 浏览器 UI 与原神风样式为定制实现，未做多主题适配
- 未经上游 CI 全量校验（跳过 lint/翻译配对钩子），以功能可用为准

### 后续计划

- 流式回复、卡内图片资源
- 多 agent 扮演（每个 NPC 一个 agent）与小说编辑团队
- 小说↔酒馆设定互通、时间线拖动条、场景卡片看板
- 消息编辑（DSH 会话为追加式，需 surface 替换方案，待后续版本）
- npm 发布、一键安装、插件市场上架
- 更多卡兼容性测试

---

## 9. 致谢与许可

- 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）扩展
- 酒馆兼容 SillyTavern 生态（角色卡/世界书格式）
- 小说模式参考 [neuro-book](https://github.com/notnotype/neuro-book) 的概念
- 本项目代码遵循 MIT License

> 类脑社区的朋友们：有问题、想法、或者「我的卡渲染不出来」的案例，欢迎提 issue 或讨论。
