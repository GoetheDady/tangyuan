# 受控更新共享用户资料

所有 Agent 都可以根据对话提出更新共享 `~/.tangyuan/user.md`，但不能通过 Pi 的普通 `write`、`edit` 或 shell 工具直接修改该文件。更新必须调用 Main 提供的受控用户资料工具，由 Main 串行处理、校验内容并在写入前备份到 `~/.tangyuan/user.history/`。

受控工具拒绝 API Key、密码、令牌和其他敏感凭据。写入成功后，Main 通知所有活跃 Agent session reload 共享用户资料；并发请求按顺序应用，避免多个 Agent 读取同一旧版本后相互覆盖。路径保护必须由工具授权或 Pi extension 强制执行，不能只依赖 prompt 约束。
