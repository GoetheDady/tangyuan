/**
 * 描述桌面会话当前可展示给用户的运行状态。
 */
export type AgentRunState =
  'idle' | 'running' | 'completed' | 'cancelled' | 'failed'

/**
 * 会话列表中展示的单个 Agent 会话摘要。
 */
export interface AgentSessionSummary {
  agentId: string
  sessionId: string
  title: string
  state: AgentRunState
  updatedAt: string
}

/**
 * 创建 v1 默认 Agent 的本地会话摘要。
 *
 * @param input - 会话标识、标题和更新时间。
 * @returns 默认归属 `tangyuan` Agent 且处于空闲状态的会话摘要。
 */
export function createDefaultSessionSummary(input: {
  sessionId: string
  title: string
  updatedAt: string
}): AgentSessionSummary {
  return {
    agentId: 'tangyuan',
    sessionId: input.sessionId,
    title: input.title,
    updatedAt: input.updatedAt,
    state: 'idle',
  }
}
