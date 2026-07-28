import type {
  AgentId,
  AgentRunState,
  ForkSource,
  AgentRuntimeErrorPayload,
} from '@tangyuan/contracts'

/**
 * 描述会话的一次执行尝试记录，用于会话重建时还原 attempt 状态。
 */
export interface PersistedAttemptEntry {
  attemptId: string
  runId: string
  /** 该尝试对应的 Agent 消息标识。 */
  messageId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  startedAt: string
  completedAt: string | null
  error?: AgentRuntimeErrorPayload
  /** 关联的用户消息标识；重试场景的 inReplyTo。 */
  inReplyTo?: string
}

/**
 * 描述汤圆写入 userData/sessions/index.json 的单个会话索引条目。
 */
export interface PersistedSessionIndexEntry {
  sessionId: string
  sdkSessionFile: string
  title: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  agentId: AgentId
  lastMessagePreview: string
  status: AgentRunState
  /** 执行尝试记录列表，用于会话重建时还原 attempt 状态。 */
  attempts?: PersistedAttemptEntry[]
  /** 分叉来源信息；为根会话（非分叉）时省略。 */
  forkedFrom?: ForkSource
}

/**
 * 描述汤圆本地会话索引文件结构。
 */
export interface PersistedSessionIndex {
  sessions: PersistedSessionIndexEntry[]
}
