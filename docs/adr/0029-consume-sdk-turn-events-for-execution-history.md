# 消费 Pi SDK 原生 turn 事件构建执行历史

TangyuanRuntime 直接消费 Pi SDK 的 `turn_start` / `turn_end` 事件及其权威 `turnIndex` 来界定回合边界，而不再由 emitter 用「工具完成后又启动工具」这类启发式自行合成边界。实时流式路径与历史重建路径共用同一套回合/步骤组装逻辑：`turn_end` 携带完整的 assistant message 与 toolResults，与历史 session 文件中持久化的 `AssistantMessage` 同构，因此两条路径产出一致的回合结构。选择这样做是为了消除自造 turn 边界带来的步骤错位（思考与其触发的工具分属不同回合、第二轮步骤挂到第一条回复等 bug 的根源），并让重启后重新打开会话仍能还原完整执行历史。

## 背景

ADR 0028 确立了「TangyuanRuntime 把 Pi SDK 的 turn、message、tool call、tool result 归一化为结构化会话视图」。当时的实现并未消费 SDK 原生的 `turn_start` / `turn_end` 事件——`normalizePiSdkSessionEvent` 丢弃了它们，emitter 转而用启发式推断回合边界，历史重建函数 `mapPiSdkSessionEntryToTranscriptEntries` 则直接返回空回合（`turns: []`）。本 ADR 精化 0028，把「归一化 turn 事件」明确为「消费 SDK 权威 turn 事件」。

## 领域事实

- 一次执行尝试对应 Pi SDK 的一次 prompt 调用（`agent_start … agent_end`）。
- 一个回合对应 SDK 的一次 LLM 生成循环（`turn_start … turn_end`）；`turnIndex` 由 agent-session 层维护，`agent_start` 归零、每个 `turn_end` 后递增。
- SDK 的 `AssistantMessage.content` 为 `(TextContent | ThinkingContent | ToolCall)[]`，按产生顺序保留思考、文字、工具调用块，历史 session 文件同样如此持久化。
- Pi SDK 没有「跨回合累加的最终回复」概念；`getLastAssistantText()` 取的是最后一条 assistant 消息的文字。因此 `AgentReplyEntry.content` 的语义为「最后一个回合的文字」，而非所有回合文字的累加。

## Consequences

- 回合边界准确，步骤不再错位；无需再维护启发式切分逻辑。
- 历史会话无需数据迁移：transcript 始终从 SDK session 文件重建，重建逻辑改对后，旧会话下次打开即呈现新结构。
- Renderer 继续只消费结构化会话视图，不直接依赖 SDK 事件细节（延续 0028 的边界）。
