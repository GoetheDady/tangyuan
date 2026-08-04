import type {
  AgentId,
  AgentSessionSummary,
  TranscriptSnapshot,
} from './types'

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

/**
 * Runtime 为聊天主界面恢复的完整会话续接快照。
 */
export interface SessionResumeSnapshot {
  sessions: AgentSessionSummary[]
  archivedSessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary
  transcript: TranscriptSnapshot
}
