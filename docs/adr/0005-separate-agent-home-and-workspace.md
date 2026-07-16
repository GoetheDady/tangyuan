# 分离 Agent Home 与工作空间

每个 Agent 使用独立目录 `~/.tangyuan/agents/<agentId>/`，其中 `soul.md` 和 `skills/` 属于 Agent Home，实际工作文件放在其 `workspace/` 子目录。MVP 中一个 Agent 固定拥有一个工作空间，Pi Agent 的 `cwd` 指向该 `workspace/`，从目录层面隔离不同 Agent 的工作文件，也避免把身份资料与普通工作产物混放。

长期记忆不属于对话 MVP：运行时不创建记忆工具，不注入或检索 `memory/`，也不引入向量数据库。该能力以后单独设计；已有空目录不代表功能已经存在。

`user.md` 描述唯一用户，不属于任何单个 Agent Home；应用只在 `~/.tangyuan/user.md` 维护一份共享用户资料，历史版本保存在 `~/.tangyuan/user.history/`，并把当前内容注入所有 Agent 的上下文。每个 Agent 不复制 `user.md` 或用户历史目录。

默认 Agent 使用保留且不可变的 `agentId = "tangyuan"`，不能归档或删除。用户创建的 Agent 使用创建后不可变的 UUID，并以 `agentId` 作为目录名、配置键和 session 关联标识。用户在创建 Agent 时填写可重复、可含中文的 `displayName`；MVP 不提供重命名，展示名称不得作为文件路径或稳定标识。

MVP 删除 Agent 时执行可恢复归档，不永久删除 Agent Home、workspace 或 session。`config.json` 为该 Agent 记录 `archivedAt`，活跃列表默认隐藏它；MVP 不自动清空归档文件，为后续恢复或显式彻底删除保留数据。
