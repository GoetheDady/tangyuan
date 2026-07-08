# 实现后台 profile 维护回合自动更新 soul.md/user.md

## What to build

每轮主回复结束后，最多启动一次后台 profile 维护回合。维护回合使用同一 Agent context，但不混入用户主回复。Agent 根据会话内容自行判断是否需要更新 `soul.md` 或 `user.md`。

更新不需要用户审批，但必须备份旧版本，不能写入密钥，并在 transcript 中显示非阻塞系统消息。

## Acceptance criteria

- [ ] 每轮主回复结束后最多启动一次 profile 维护回合。
- [ ] 维护回合不混入用户主回复，不阻塞用户阅读主回复。
- [ ] 只有明确偏好、边界或长期规则变化才更新。
- [ ] 单轮最多更新一次 `soul.md`，一次 `user.md`。
- [ ] 更新前通过 Pi SDK `read` 读取旧文件，并通过 `write` 备份到 `soul.history/` 或 `user.history/`。
- [ ] 更新使用 Pi SDK `edit` / `write` 工具完成。
- [ ] 内容无实质变化时不写文件。
- [ ] 更新后当前 session 刷新上下文，后续 session 注入新版 `soul.md` / `user.md`。
- [ ] UI 显示“已更新 Agent 规则”或“已更新用户画像”等系统消息。
- [ ] 禁止把 API Key、token、密码或密钥写入 `soul.md` / `user.md`。
- [ ] 测试覆盖无需更新、更新 user、更新 soul、备份失败、系统消息和密钥过滤。

## Blocked by

- 实现 bootstrap 对话生成 soul.md 与 user.md
