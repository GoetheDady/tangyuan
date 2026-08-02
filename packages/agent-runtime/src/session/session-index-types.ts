import type {
  AgentId,
  AgentRunState,
  ForkSource,
  AgentRuntimeErrorPayload,
} from '@yuanxiao/contracts'

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
 * 描述元宵写入 userData/sessions/index.json 的单个会话索引条目。
 */
export interface PersistedSessionIndexEntry {
  sessionId: string
  sdkSessionFile: string
  title: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  /** 会话运行配置中的 Thinking Level；未设置过时省略。 */
  thinkingLevel?: string
  agentId: AgentId
  lastMessagePreview: string
  status: AgentRunState
  /** 会话归档时间；未归档时省略。 */
  archivedAt?: string
  /** 执行尝试记录列表，用于会话重建时还原 attempt 状态。 */
  attempts?: PersistedAttemptEntry[]
  /** 分叉来源信息；为根会话（非分叉）时省略。 */
  forkedFrom?: ForkSource
}

/**
 * 描述元宵本地会话索引文件结构。
 */
export interface PersistedSessionIndex {
  sessions: PersistedSessionIndexEntry[]
}
