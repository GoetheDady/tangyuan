# 实现 Pi SDK session 持久化与会话列表恢复

## What to build

使用 Pi SDK 原生 session 持久化作为 transcript 的 source of truth。汤圆自己的 JSON 只保存 config、会话索引、摘要和 UI metadata。

用户重启应用后，应该能看到历史会话列表，并打开已有 session 查看消息。

## Acceptance criteria

- [ ] 新建会话使用 Pi SDK persistent session，并记录 `sdkSessionFile`。
- [ ] `userData/sessions/index.json` 保存 sessionId、sdkSessionFile、title、createdAt、updatedAt、provider、model、agentId、lastMessagePreview、status。
- [ ] `index.json` 使用临时文件加 rename 的原子写策略。
- [ ] 打开历史会话时通过 Pi SDK open/switch 到对应 session。
- [ ] transcript 以 Pi SDK session messages 为准，汤圆不复制完整 transcript。
- [ ] index 丢失时可以通过 SDK session list 尝试重建基础列表。
- [ ] 重启应用后会话列表和选中 Provider/Model 可恢复。
- [ ] 测试覆盖创建索引、更新摘要、重启恢复、索引丢失降级、打开历史会话。

## Blocked by

- 接入 PiSdkDriver 创建真实会话并发送首条消息
- 实现流式事件、运行状态与取消响应
