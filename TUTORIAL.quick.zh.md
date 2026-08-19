# DeepSeek Harness 小说 + 酒馆 模式 —— 简易上手教程（v0.1）

> **蹭个热度**：最近 DSH（DeepSeek Harness）和 SillyTavern 角色卡都挺火，我也凑个热闹，把「小说创作」和「AI 酒馆」塞进了 DSH，做成了一套开箱即用的插件集。做得比较糙，但**会持续更新**，有问题随时提。
>
> 仓库：https://github.com/makenwjz/dsh-novel-tavern
> 详细教程（含所有功能说明）：[TUTORIAL.zh.md](TUTORIAL.zh.md)

---

## 一、这是什么

一句话：**让你现有的 DeepSeek Harness 变成「写小说的工具 + 玩角色卡的酒馆」。**

- 🖋 **小说模式**：世界设定、剧情伏笔、创作决策、章节知识、正文草稿，配 24 个 AI 工具
- 🍺 **酒馆模式**：导入 SillyTavern 角色卡（PNG/JSON）和世界书，微信式聊天，角色卡自动渲染成好看的页面

---

## 二、怎么下载

**方式 1：直接下载压缩包（推荐小白）**

1. 打开仓库：https://github.com/makenwjz/dsh-novel-tavern
2. 点绿色 **Code** 按钮 → **Download ZIP**
3. 解压到任意目录，比如 `C:\dsh-novel-tavern`

**方式 2：git clone（推荐开发者）**

```sh
git clone https://github.com/makenwjz/dsh-novel-tavern.git
cd dsh-novel-tavern
```

---

## 三、下载好后放哪

这取决于你的 DSH 是怎么装的：

### 情况 A：你是拿这个仓库当 DSH 用（最简单）

把下载/解压出来的目录**直接当作你的 DSH 安装目录**，然后：

```sh
cd dsh-novel-tavern
pnpm install
pnpm run build:lib:host
pnpm run build:lib:client
# 启动（跟平时启动 DSH 一样）
node apps/cli/lib/bin.js web --port 3080
```

打开 http://127.0.0.1:3080 就能看到右下角多了 🖋（小说）和 🍺（酒馆）两个悬浮球。

### 情况 B：你已经有 DSH 了，只想加插件

把你的 DSH profile 指向本项目的包（推荐在本仓库里运行）：

```sh
# 在 dsh-novel-tavern 目录下
dsh plugin --profile web add @deepseek-ai/dsh-novel-bundle
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-novel
```

> `dsh-novel-bundle` = 小说服务 + 小说工具 + 酒馆商店；`ui-novel` = 浏览器界面。
> v0.1 还没发 npm，这两个名字需要在本仓库的 `packages/` 里被链接到，所以情况 B 本质上还是在仓库内操作。

### 情况 C：只要酒馆、不要小说

酒馆和小说是解耦的，不挂小说服务，酒馆面板一样能用（小说工作室会提示「未挂载」）。

---

## 四、使用教程（快速版）

### 酒馆玩法（角色扮演）

1. 进 DSH Web → 左下角设置 → Agent 预设选 **酒馆模式**
2. 点右下角 **🍺 酒馆悬浮球** → 切到「**资料库**」标签
3. **导入角色卡**：选你的 PNG 角色卡（SillyTavern 导出的那种）或 JSON 卡；卡里的世界书会自动拆出来
4. 回「聊天」标签 → 点 **＋ 开始新对话**
5. **开场白自动弹出**，右上角还能切换几个备用开场白
6. 直接打字聊天——角色按设定回应，消息会**渲染成漂亮的页面**（像魔女审判这类卡还有封面、周目切换按钮，都能点）

### 小说玩法（创作）

1. Agent 预设选 **小说模式**（默认就是）
2. 点 **🖋 小说悬浮球** 打开「小说工作室」
3. 跟 AI 说「新建一个角色 xxx」「记录世界事件」「写第一章」……24 个工具会自动干活
4. 界面里实时看：世界状态、时间线、伏笔、决策、章节、正文

### 常见坑

| 现象 | 怎么办 |
|---|---|
| 导入 PNG 提示「不是角色卡」 | 这张 PNG 没带 SillyTavern 元数据；用 SillyTavern 重新「角色卡图片」导出，或改用 JSON |
| 删不掉角色卡/世界书 | 有会话还绑着它；按提示点「去聊天解除绑定」→ 解除 → 回来删 |
| 回复里全是 `<now_plot>` 之类的标记 | 刷新页面；个别卡的脚本格式特殊的话提 issue |
| 浏览器按钮不能用 | `npx playwright install chromium`，或配置用你装的 Chrome/Edge |

---

## 五、版本与更新

- 当前：**v0.1**（功能可用，UI 和兼容性还在打磨）
- 会持续更新：开场白写进历史、MVU 变量、更多角色卡兼容、npm 一键安装……
- 求 star 求反馈：有问题/有「我的卡渲染不出来」的案例，直接提 issue

> 声明：本项目为社区自制扩展，与 DeepSeek 官方无关；SillyTavern 相关格式兼容仅用于本地个人使用，请遵守各平台与作者规定。
