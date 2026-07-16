# Pi Agent 是产品基础

汤圆不是可切换多种 Agent 引擎的通用壳层，而是基于 Pi Agent 构建的本地桌面产品。架构可以直接利用 Pi Agent 的会话、运行和工具能力，不为替换底层 Agent 引擎设计兼容层；现有 Driver 接口仅在确有测试或进程边界价值时保留，而不代表多引擎扩展承诺。

Pi Agent 的原始类型和事件止于 Electron Main 进程。Main 进程将其转换为汤圆自己的会话、消息和运行状态后再通过 IPC 交给 Renderer，避免界面依赖 Pi Agent 的内部表示，并集中控制跨进程数据和敏感信息。
