# Agent Note: 网页应用中的小说工作区表面

Status: implemented

[English](2026-08-17-novel-workspace-settings-tab.md) | 中文

## 问题

小说子系统已有持久化存储、十二个模型面向工具和一套 Remote API,但没有浏览器面用于检视工作区:世界折叠点与主体、故事时间线、伏笔台账、创作决策与章节知识行,在模型任务或 CLI 运行打印之前都不可见。设置界面此前也没有位置展示小说数据实际存放的目录,而一旦进入设置对话框,视图又埋没在导航之后。

## 决策

**`novel-api` 是仅 Remote 的只读投影。** `NovelApiGateway` 注册 `novelWorkspace` 服务与一个生成的直接 Remote `novelWorkspace/workspace`:调用通过 `ctx.get()` 解析可选的 `novel` 服务,并将整个存储投影为一个 JSON 安全的展示形式快照(展示形式故事时间、完整伏笔流转历史、带选项与结果的创作决策、章节知识控制行与存储根目录)。该服务不声明同进程 Cordis `Context` 合并,也不声明 `novel` 注入:未挂载 bundle 的部署仍能挂载网关,缺失运行时的失败发生在方法调用处而非插件加载期。公开负载类型位于 `./types`;Typert 生成 Host 与 Client 两端的 Remote 产物。

**`ui-novel` 是浏览器端设置页签加右侧抽屉。** 客户端插件通过 `ctx.slots.inject()` 注册三个本地化贡献:`settings.plugins.tab`(id `novel`)、`sidebar.footer.action` 触发器(id `novel-dock-toggle`)与 `shell.overlay` 抽屉(id `novel-dock`),因此能跟随迟到声明、重新声明、语言切换与拆除。触发器与抽屉挂载同一个在 `apply` 中构造一次的共享 root 作用域 store 句柄,两个表面的开关状态永远不会分歧;抽屉关闭时不渲染任何内容。选中页签或打开抽屉时才挂载并惰性调用 `ctx.remote.novelWorkspace.workspace()`(经由 `api-remotes` 装配);插件激活阶段不发起任何 Remote 读取。这些表面以五个区段(世界状态、时间线、伏笔台账、创作决策、章节知识)加存储根目录渲染快照,文案本地化,加载/失败/空态/重试状态局限于已挂载组件,提供重新读取按钮,并在部署未挂载小说服务时展示说明性的未启用状态。抽屉悬浮于框架右缘的点击穿透悬浮层内,位于设置对话框之下,不挤压任何栏。

**注册遵循 web-app bundle 清单。** `dsh.client` 行与 bundle 依赖位于 `packages/bundle/web-app`,`tsconfig.client.json` 聚合引用、`tsconfig.base.json` 显式 paths 同时就位;构建顺序保持 host 先于 client,Remote 产物经 node_modules 到达消费方。

## 备选方案

**以全页路由代替设置页签。** 已否决:设置插件页签是按插件的浏览器界面既有扩展点(`ui-agent-preset`、`ui-settings-plugin-inventory` 先例),且页签仅存在于已拥有导航样式的设置对话框内。

**以常驻第四列代替悬浮抽屉。** 已否决:框架的三轨几何(侧栏、会话、详情)是已定型的契约,带自己的让步求解器与 e2e 几何断言;悬浮抽屉提供随时可用的表面而不挤压任何栏,点击穿透层也保证下方应用保持可交互。

**以周期轮询代替按需快照读取。** 已否决:投影契约是点态快照——每次挂载或刷新一份快照,无订阅、增量或分页,网关保持无状态,刷新时机由这些表面掌控。

## 后果

只要 web-app bundle 挂载了小说行,浏览器设置对话框就会出现小说页签,侧栏底部出现抽屉触发器;未挂载时呈现诚实的未启用状态。抽屉在收起前跨会话与工作区切换保持打开。抽屉面板以磨砂玻璃呈现,配金色描边与星形装饰(新增 `--dsw-alias-bg-frosted`/`--dsw-alias-accent-gold` 主题 token,明暗两套)。`docs/config-catalog.md` 与客户端 slot 目录随两包及全部三个贡献重新生成;两个 README 均带有审计过的短式 Model Experience 条目;重录后的 `plugin-config` golden 记录了该页签,重录后的 `lifecycle-chrome` golden 记录了底部触发器。快照契约保持点态且只读;变更继续经由小说工具与服务完成。另外,base bundle 现在也给 `pwsh-sandbox` 钉上 `timeoutMs: 60000`,与 `bash-sandbox` 一致,使设置中 shell 卡片的组合默认值跨平台统一。