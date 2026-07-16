# 分离聊天页与控制台页

Renderer 使用 React Router 的 HashRouter 提供两类顶层路由：聊天页只承载 Agent、session、消息流和对话动作；控制台页集中管理共享 Provider/API Key、各 Agent 的 Provider/Model、Agent 状态和归档。打包后的 Electron 使用 hash 路由，不依赖服务端 history fallback。

缺少可用模型服务凭据时，聊天路由进入配置阻断并导航到控制台，而不是维护独立 `/setup` 页面。该决定取代 ADR-0001 的 `/setup` 与 `/chat` 双页面设计。

聊天使用 `/chat/:agentId/:sessionId?`；控制台使用 `/console/providers`、`/console/agents` 和 `/console/agents/:agentId` 嵌套路由。控制台可以修改 Agent 配置和恢复归档，但不提供创建 Agent；创建仍只能由默认 Agent 通过对话和受控工具完成。
