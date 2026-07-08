# 建立 Driver、RuntimeSnapshot 与 IPC 契约

## What to build

建立汤圆 v1 的跨进程和运行时契约，让 Renderer 只能通过 Preload API 与 Main 通信，Main 通过 DesktopAppStore 调用 AgentSessionDriver / RuntimeResourceDriver，Pi SDK 只允许存在于 agent-runtime 的 PiSdkDriver 内部。

这一张 issue 交付的是可测试的契约和薄链路，不要求真实 Pi SDK 会话跑通。

## Acceptance criteria

- [ ] `packages/shared` 定义会话、消息、运行状态、Agent profile、配置、IPC 请求/响应、RuntimeSnapshot 等共享类型。
- [ ] `packages/agent-runtime` 定义 `AgentSessionDriver`、`RuntimeResourceDriver`、统一 Agent 事件类型和错误类型。
- [ ] `apps/desktop` 暴露类型化 Preload API，Renderer 不能直接访问 Node.js 或 Pi SDK。
- [ ] Main 侧有 DesktopAppStore 的最小骨架，负责连接 IPC、状态和 Driver 接口。
- [ ] RuntimeSnapshot 至少包含 Provider、Model、API Key 配置状态、activeAgent、profile 初始化状态。
- [ ] 类型和接口命名为英文，JSDoc 使用中文，方法必须说明参数、返回值和错误。
- [ ] 测试覆盖 Renderer 无法直接 import Pi SDK、Preload API shape、DesktopAppStore 调用 Driver 契约。

## Blocked by

- 初始化工程骨架与基础质量门禁
