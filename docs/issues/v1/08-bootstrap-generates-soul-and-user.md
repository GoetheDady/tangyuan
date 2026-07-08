# 实现 bootstrap 对话生成 soul.md 与 user.md

## What to build

实现首次初始化对话：用户完成真实 SDK 配置验证后，第一次会话根据固定 `bootstrap.md` 模板向用户提问。Agent 根据用户回答自行判断 bootstrap 是否完成，完成后通过 Pi SDK 工具写入 `soul.md` 和 `user.md`，并删除 `bootstrap.md`。

bootstrap 对话是普通 session，进入历史列表。

## Acceptance criteria

- [ ] 未完成 bootstrap 时，应用进入 bootstrap 会话，而不是普通工作台空会话。
- [ ] bootstrap 使用固定问题模板，Agent 可以自行追问。
- [ ] bootstrap 完成由 Agent 根据固定问题和用户回答自行判断，不要求用户点击完成按钮。
- [ ] 完成后通过 Pi SDK `write` / `edit` 工具写入 `soul.md` 和 `user.md`。
- [ ] `soul.md` 至少包含身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。
- [ ] `user.md` 至少包含称呼、语言与语气偏好、常见工作类型、决策偏好、需要先确认的事项、禁止触碰的信息和边界、长期偏好。
- [ ] 写入成功后通过 Pi SDK 工具删除 `bootstrap.md`。
- [ ] 后续 session 会注入 `soul.md` 和 `user.md`。
- [ ] 测试覆盖 bootstrap 状态、完成写入、删除 bootstrap、历史列表可追溯首次会话。

## Blocked by

- 接入 PiSdkDriver 创建真实会话并发送首条消息
- 实现流式事件、运行状态与取消响应
- 实现 Pi SDK session 持久化与会话列表恢复
