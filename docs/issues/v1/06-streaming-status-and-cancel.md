# 实现流式事件、运行状态与取消响应

## What to build

把 Pi SDK 的流式事件映射成汤圆统一事件，并在 UI 中展示文本流、运行状态、取消状态、错误状态和简略 thinking/tool 状态。

v1 支持不同会话同时 running；同一会话同一时间只允许一个 active run。

## Acceptance criteria

- [ ] 支持 `turn-started`、`message-delta`、`message-completed`、`turn-failed`、`turn-cancelled`。
- [ ] 文本 delta 能流式更新 transcript。
- [ ] thinking 显示简略状态，例如“思考中”。
- [ ] 工具事件显示简略状态，例如“正在读取文件”“正在搜索”“工具失败”，不展示原始 JSON 或完整敏感参数。
- [ ] 同一会话运行中不能再次发送消息。
- [ ] 不同会话可以同时 running，会话列表显示 running 标记。
- [ ] 用户可以取消某个会话的当前 run，取消后 UI 进入 cancelled，已生成内容保留。
- [ ] 退出应用时取消所有 active run。
- [ ] 测试覆盖成功流、错误流、取消流、多会话并发和同会话防重复发送。

## Blocked by

- 接入 PiSdkDriver 创建真实会话并发送首条消息
