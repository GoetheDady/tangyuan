# 使用全局 Pi session 目录与汤圆索引

所有 Agent 的 Pi JSONL session 文件统一保存在 `~/.tangyuan/sessions/pi-sdk/`，继续作为消息、原生元数据、模型切换和分支树的唯一真相。每个 Agent 的唯一 workspace `cwd` 写入 Pi session header，`SessionManager.list(cwd, sharedSessionDir)` 据此过滤所属 session。

汤圆维护一份全局 `~/.tangyuan/sessions/index.json`，只保存 `agentId`、跨 Agent 查询索引、可重建字段和汤圆扩展数据。index 丢失时使用 `SessionManager.listAll(sharedSessionDir)` 扫描全部 JSONL，再按 header `cwd` 对照 Agent workspace 重建；index 不得反向覆盖 Pi session。

MVP 不提供 Pi session 的分支、fork、clone 或完整树导航界面，只展示当前 active branch 的线性消息。底层 JSONL 继续保留 Pi 原生树结构，不做破坏性扁平化，为以后开放分支能力保留兼容性。

长 session 使用 Pi Agent 原生自动 compaction，将摘要 entry 继续写入同一 Pi JSONL。汤圆不维护第二套上下文摘要，MVP 不提供手动 compact 操作，只在界面以非阻断状态提示较早上下文已经压缩。
