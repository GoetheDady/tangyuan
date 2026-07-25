# 受控更新共享用户画像

所有 Agent 都可以根据对话自行判断是否更新共享 `~/.tangyuan/profile/user.md`，但不能通过 Pi 的普通 `write`、`edit` 或 shell 工具直接修改该文件。Agent 必须在正常回复回合中调用 Main 提供的受控 `update_user_profile` 工具，由 Main 校验内容，并在实际写入前自动备份到 `~/.tangyuan/profile/user.history/`。

受控工具拒绝 API Key、密码、令牌和其他敏感凭据。写入成功后，Main 通知所有活跃 Agent session reload 共享用户画像；并发请求通过版本检查拒绝基于旧内容的覆盖。路径保护必须由工具授权或 Pi extension 强制执行，不能只依赖 prompt 约束。
