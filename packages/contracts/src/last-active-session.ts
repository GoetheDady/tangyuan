import type { AgentId } from './types'

/**
 * 描述用户最后一次打开的会话及其所属 Agent，用于启动恢复。
 */
export interface LastActiveSession {
  agentId: AgentId
  sessionId: string
  updatedAt: string
}

/**
 * 描述用户切换最后激活会话时传给 Main 进程的请求。
 */
export interface SetLastActiveSessionRequest {
  agentId: AgentId
  sessionId: string
}
