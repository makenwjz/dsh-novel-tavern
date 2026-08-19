# @deepseek-ai/dsh-novel-api

[English](README.md) | 中文

面向网页可视化的小说工作区只读 Host 投影。`NovelApiGateway` 注册 `novelWorkspace` 服务,并发布一个生成的直连 Remote:`novelWorkspace/workspace`。每次调用通过 `ctx.get()` 惰性解析可选的 `novel` 服务,把整个存储投影成一份 JSON 安全、故事时间为展示形式的快照:世界折叠点与主体状态、按故事顺序排列的事件、带完整演进历史的伏笔台账、带选项与结局的创作决策,以及章节知识控制行。快照附带存储根目录,方便设置界面说明数据存放位置。

该服务仅面向 Remote,刻意不声明同进程 Cordis `Context` 合并,也不注入 `novel`:未挂载 bundle 的部署仍能挂载网关,缺失的运行时会在这个方法被调用时大声失败,而不是在插件加载期失败。客户端包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组装消费它,而不是直接导入 Host 实现。公开载荷类型位于 `./types`,`./typert` 与 `./remote` 暴露 Typert 生成的 Host 与 Client Remote 产物。

## Model Experience

无——本包是纯只读 Host 投影,不注册任何提示词、工具、消息或 provider 请求。

#### KV Cache effect

无;本包从不组装模型输入。

## Known Limitations and Deferred Work

- **仅点状快照** —— 每次 `workspace()` 调用都会重读存储;快照没有订阅、增量或分页,由设置界面决定何时重新拉取。
- **无变更路径** —— 投影只读;模型与 CLI 的变更仍然经由 novel 工具与服务完成。