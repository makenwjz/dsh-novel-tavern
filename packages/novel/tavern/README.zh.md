# @deepseek-ai/dsh-tavern

[English](README.md) | 中文

小说工作区内置的 SillyTavern 兼容酒馆商店。`TavernService` 导入世界书（lorebook/worldbook）JSON 导出与角色卡（JSON，或带 `chara`/`ccv3` 文本块的 PNG），大声校验失败、铸造稳定 id，并通过按会话的提示词区块注入角色与关键词命中的世界书条目。会话通过类型化 `tavern/binding` 会话事件绑定到商店，因此绑定是纯回放量，在重启与冷读时从会话日志恢复。

商店是进程级（每主机一份世界书 + 角色卡商店），绑定则是每会话的。商店变更无需会话；绑定读写都要指名会话。提示词区块向 `ctx.systemPrompt` 注册，把激活委托给关键词窗口（`activationTextLimit` 字符的最近消息文本），常驻条目始终激活。

想削减每轮 token 与自动标题请求的部署可开启 `lean` 模式：角色块精简为名字、人物介绍与开场白，浏览器端通过 `ctx.tavern.setLean` 驱动，同时关闭标题服务的自动生成。世界书支持激活阶段（条目的 `stage`、绑定的 `stage`）：阶段 0 的条目在任意阶段都激活，`advanceStage` 把会话推进到下一阶段集合。角色卡可在 `extensions.mvu.variables` 下携带 MVU 状态变量；完整模式会注入为状态块。

## Model Experience（模型体验）

提示词区块 `tavern:context` 在完整酒馆模式且存在命中世界书时贡献以下模型可见材料：

```text
## 角色扮演设定
你现在扮演 {name}。以下设定必须遵守：
- 性格: {personality}
- 背景: {scenario}
- 人物介绍: {description}
- 对话示例: {mesExample}
- 额外设定: {systemPrompt}
- 行为准则: {postHistoryInstructions}
## 角色状态
- {key}: {value}
本对话必须以上述角色的开场白开始：
{firstMes}
## 已激活的世界书设定
当前文本激活了以下世界设定，回答时不得与之矛盾：
- 《{bookName}》：{content}
```

小说模式（或没有角色卡的酒馆模式）只注入命中的世界书块；没有命中条目时区块为空。极简模式把角色块精简为名字、人物介绍、开场白与世界书块。`{{char}}` 与 `{{user}}` 宏在全部角色字段中替换为角色名与 `用户`。

#### KV Cache 影响

激活文本窗口上限为 `activationTextLimit` 字符（默认 4000）。注入的区块本身在每次装配时对提示词可见；其大小为上面渲染的模板。`lean` 模式会实质缩减每轮角色块。

## Known Limitations and Deferred Work（已知限制与后续工作）

- **多角色扮演为精简块** — 绑定带多个 `characterIds` 时只注入名字与人物介绍块；完整字段、MVU 状态与开场白仍为单角色专属。
- **仅整数激活阶段** — 阶段是整数计数器，由 `advanceStage` 显式推进；没有按剧情进度自动推进，也没有超出普通 `stage` 字段的阶段感知世界书格式。
- **MVU 只读** — 状态变量注入提示词，但没有运行时变更路径（无每轮变量更新或 UI 编辑）。
- **导入忽略未知字段** — 工具时代扩展字段解析不报错，但只投影支持子集；不支持的字段值被静默丢弃。
