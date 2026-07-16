# Renderer 使用 Zustand 管理状态

Renderer 使用 Zustand 管理 Agent 列表、session 摘要、当前消息、流式运行状态和临时界面状态，并按 Agent、session 和具体字段提供细粒度订阅。Electron Main 进程仍是业务事实来源，Zustand 只保存从 IPC 快照和事件得到的界面缓存，不持久化配置、会话或 Agent 数据。

该边界替代当前集中在单个 React Context 中的工作台状态，避免任一流式消息或运行状态变化触发无关界面重渲染，也为多 Agent 并发事件提供明确的归并位置。

Renderer 不再引入 TanStack Query 或 SWR。汤圆的数据源是 Main 快照和持续 IPC 事件，不是 HTTP 资源；Preload API 的调用结果和事件统一归并进 Zustand，避免异步缓存库与 Zustand 同时持有两份需要同步的状态。
