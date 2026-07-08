# 实现 Provider/API Key/Model 配置与真实 SDK 验证

## What to build

实现配置页和 Main 侧配置保存流程。用户必须配置 Provider、API Key 和 Model，并通过真实 Pi SDK 验证后才能进入工作台。

配置保存在 Electron `userData` 下的 config JSON。API Key 在 MVP 阶段明文保存，但 UI 默认遮罩，日志、错误和测试 fixture 不能输出真实密钥。

## Acceptance criteria

- [ ] 未配置 Provider/API Key/Model 时，应用启动后进入配置页，不允许使用会话功能。
- [ ] Provider/Model 列表来自 Pi SDK ModelRegistry，并允许手动输入 provider/model id。
- [ ] 保存配置前使用真实 Pi SDK 验证，验证 prompt 固定为 `Reply with OK.`。
- [ ] 验证使用临时 session，禁用工具，不写会话历史，不进入会话列表。
- [ ] 验证成功才写入 config JSON；验证失败不保存 API Key，并显示脱敏错误。
- [ ] API Key UI 默认遮罩，日志和错误信息不包含完整 API Key。
- [ ] 用户可以取消验证。
- [ ] 测试覆盖配置缺失、验证成功、验证失败、取消验证、API Key 脱敏。

## Blocked by

- 建立 Driver、RuntimeSnapshot 与 IPC 契约
- 实现默认 Agent Home 与 profile 文件初始化
