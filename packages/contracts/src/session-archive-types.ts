import type { AgentId } from './types'

/** 会话谱系归档前需要停止的活动类型。 */
export type SessionLineageActivityKind =
  'running' | 'queued' | 'pending-approval' | 'pending-clarification'

/** 单个会话中会被归档操作停止的活动。 */
export interface SessionLineageActivity {
  sessionId: string
  title: string
  kinds: SessionLineageActivityKind[]
}

/** 归档会话谱系的请求。 */
export interface ArchiveSessionRequest {
  agentId: AgentId
  sessionId: string
  /** 用户是否已经确认停止子树中的全部活动。 */
  confirmActivityStop: boolean
}

/** 恢复会话谱系的请求。 */
export interface RecoverSessionRequest {
  agentId: AgentId
  sessionId: string
}

/** 会话谱系归档的结果。 */
export interface ArchiveSessionResult {
  status: 'confirmation-required' | 'archived'
  affectedSessionIds: string[]
  affectedActivities: SessionLineageActivity[]
}
