/**
 * v1 默认 Agent 的稳定标识。
 */
export const TANGYUAN_DEFAULT_AGENT_ID = 'tangyuan'

/**
 * 当前配置文件的 schema 版本，用于顺序迁移。
 */
export const CURRENT_SCHEMA_VERSION = 2

/**
 * 描述 Agent 的唯一标识。
 */
export type AgentId = string

/**
 * 描述桌面会话当前可展示给用户的运行状态。
 */
export type AgentRunState =
  'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'

/**
 * 描述消息在对话消息列表里的来源。
 */
export type AgentMessageRole = 'user' | 'agent' | 'system' | 'compaction'

/**
 * 描述一个用户或 Agent 消息。
 */
export interface AgentMessage {
  messageId: string
  agentId: AgentId
  sessionId: string
  role: AgentMessageRole
  content: string
  createdAt: string
}

/**
 * 描述一次 Agent 运行的身份与状态。
 */
export interface ExecutionAttempt {
  /** 执行尝试的唯一标识，与 runId 相同。 */
  attemptId: string
  /** 关联的 run 标识。 */
  runId: string
  /** 当前执行状态。 */
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  /** 执行开始时间。 */
  startedAt: string
  /** 执行结束时间；未结束时为 null。 */
  completedAt: string | null
  /** 失败或取消时的错误信息；成功和运行中时为 undefined。 */
  error?: AgentRuntimeErrorPayload
}

/**
 * 描述结构化会话视图中的单条条目。
 *
 * 每个条目在 transcript 中拥有稳定索引，按时间顺序排列。
 */
export type TranscriptEntry =
  UserMessageEntry | AgentReplyEntry | CompactionEntry

/**
 * 描述用户发送的纯文本消息条目。
 */
export interface UserMessageEntry {
  readonly kind: 'user-message'
  /** 条目在 transcript 中的稳定位置。 */
  readonly index: number
  /** 对应的 AgentMessage 标识。 */
  readonly messageId: string
  /** 用户消息的纯文本内容。 */
  readonly content: string
  /** 消息发送时间。 */
  readonly createdAt: string
}

/**
 * 描述执行历史中的单步操作类型。
 */
export type TurnStepKind = 'thinking' | 'text' | 'tool-call'

/**
 * 描述执行历史中的一个步骤（思考、文本输出或工具调用）。
 */
export interface TurnStep {
  /** 步骤在 turn 内的稳定索引。 */
  readonly index: number
  /** 步骤类型。 */
  readonly kind: TurnStepKind
  /**
   * 步骤内容：thinking 原文 / text 内容 / tool 安全摘要。
   *
   * 对于 tool-call 步骤，此字段为不包含敏感参数、原始输出和
   * 文件内容的安全摘要，由确定性函数生成，不调用模型。
   */
  readonly content: string
  /** 工具调用唯一标识（仅 tool-call 步骤，用于实时更新与最终结果归并）。 */
  readonly toolCallId?: string
  /** 工具原名（仅 tool-call 步骤，用于 Renderer 显示工具名和生成安全摘要）。 */
  readonly toolName?: string
  /** 当前步骤状态。 */
  readonly status: 'running' | 'completed' | 'failed'
  /** 步骤开始时间。 */
  readonly startedAt: string
  /** 步骤结束时间；未结束时为 null。 */
  readonly completedAt: string | null
}

/**
 * 描述一次 Agent 运行中的单个 turn。
 *
 * 每个 turn 由多个步骤（thinking → text → tool-call）组成，
 * 在 tool call 或 run 结束时形成 turn 边界。
 */
export interface RunTurn {
  /** turn 在 attempt 内的稳定索引。 */
  readonly index: number
  /** 关联的 run 标识。 */
  readonly runId: string
  /** turn 内的步骤列表，按时间顺序排列。 */
  readonly steps: TurnStep[]
  /** 当前 turn 状态。 */
  readonly status: 'running' | 'completed' | 'cancelled' | 'failed'
  /** turn 开始时间。 */
  readonly startedAt: string
  /** turn 结束时间；未结束时为 null。 */
  readonly completedAt: string | null
}

/**
 * 描述 Agent 的最终文本回复条目。
 */
export interface AgentReplyEntry {
  readonly kind: 'agent-reply'
  /** 条目在 transcript 中的稳定位置。 */
  readonly index: number
  /** 对应的 AgentMessage 标识。 */
  readonly messageId: string
  /** Agent 回复的 Markdown 内容。 */
  readonly content: string
  /** 消息创建时间。 */
  readonly createdAt: string
  /** 产生此回复的执行尝试。 */
  readonly attempt: ExecutionAttempt | null
  /** 本次 attempt 中的所有 turn；旧 transcript 中为空数组。 */
  readonly turns: RunTurn[]
  /** 关联的用户消息标识，用于多尝试重试场景；重试时不重复产生 UserMessage。 */
  readonly inReplyTo?: string
}

/**
 * 描述上下文压缩提示条目。
 */
export interface CompactionEntry {
  readonly kind: 'compaction'
  /** 条目在 transcript 中的稳定位置。 */
  readonly index: number
  /** 压缩发生的时间戳。 */
  readonly timestamp: string
}

/**
 * 描述某一时刻的结构化会话快照。
 */
export interface TranscriptSnapshot {
  /** 所属会话标识。 */
  readonly sessionId: string
  /** 所属 Agent 标识。 */
  readonly agentId: string
  /** 按时间排序的 transcript 条目列表。 */
  readonly entries: TranscriptEntry[]
  /** 快照生成时间。 */
  readonly updatedAt: string
}

/**
 * 描述结构化会话视图的增量更新。
 *
 * Renderer 通过 AgentEvent 接收 TranscriptDelta，
 * 并按纯函数方式应用到本地 TranscriptSnapshot。
 */
export type TranscriptDelta =
  | {
      readonly type: 'entry-appended'
      readonly entry: TranscriptEntry
    }
  | {
      readonly type: 'entry-updated'
      readonly index: number
      readonly entry: TranscriptEntry
    }
  | {
      readonly type: 'delta-appended'
      readonly index: number
      readonly delta: string
    }
  | {
      readonly type: 'attempt-status-changed'
      readonly index: number
      readonly attempt: ExecutionAttempt
    }
  | {
      readonly type: 'step-appended'
      /** agent-reply 条目的索引。 */
      readonly index: number
      /** 目标 turn 在 turns 数组中的索引。 */
      readonly turnIndex: number
      readonly step: TurnStep
    }
  | {
      readonly type: 'step-updated'
      /** agent-reply 条目的索引。 */
      readonly index: number
      /** 目标 turn 在 turns 数组中的索引。 */
      readonly turnIndex: number
      /** 目标 step 在 steps 数组中的索引。 */
      readonly stepIndex: number
      readonly step: TurnStep
    }
  | {
      readonly type: 'reply-finalized'
      /** agent-reply 条目的索引。 */
      readonly index: number
    }

/**
 * 会话列表中展示的单个 Agent 会话摘要。
 */
export interface AgentSessionSummary {
  agentId: AgentId
  sessionId: string
  title: string
  state: AgentRunState
  updatedAt: string
}

/**
 * 描述 Agent Runtime 统一错误码。
 */
export type AgentRuntimeErrorCode =
  | 'configuration-missing'
  | 'driver-unavailable'
  | 'provider-verification-failed'
  | 'session-not-found'
  | 'run-already-active'
  | 'run-cancelled'
  | 'unknown'

/**
 * 描述可以安全传给 Renderer 的 Agent Runtime 错误。
 */
export interface AgentRuntimeErrorPayload {
  code: AgentRuntimeErrorCode
  message: string
  recoverable: boolean
}

/**
 * 描述 Agent 运行中可展示给用户的简略活动类型。
 */
export type AgentActivityKind = 'thinking' | 'tool'

/**
 * 描述 Agent 运行中可展示给用户的简略活动状态。
 */
export type AgentActivityState = 'running' | 'completed' | 'failed'

/**
 * 描述 Agent 运行中不含敏感参数的简略活动。
 */
export interface AgentActivity {
  kind: AgentActivityKind
  state: AgentActivityState
  label: string
  /** 可选：关联的 turn step 标识，用于 Renderer 链接到时间线。 */
  stepId?: string
  /** 可选：工具调用唯一标识，用于 Runtime 归并同一工具的实时更新和最终结果。 */
  toolCallId?: string
  /** 可选：工具原名，用于生成安全摘要。 */
  toolName?: string
}

/**
 * 描述 Bash 审批请求的当前状态。
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/**
 * 描述一次 Bash 执行的审批请求（传给 Renderer 展示）。
 */
export interface BashApprovalRequest {
  approvalId: string
  agentId: AgentId
  sessionId: string
  runId: string
  command: string
  cwd: string
  riskDescription: string
  status: ApprovalStatus
  createdAt: string
}

/**
 * 描述 Renderer 批准 Bash 执行时传给 Main 的请求。
 */
export interface ApproveBashRequest {
  approvalId: string
}

/**
 * 描述 Renderer 拒绝 Bash 执行时传给 Main 的请求。
 */
export interface RejectBashRequest {
  approvalId: string
}

/**
 * 描述 Agent 运行过程中发给 TangyuanRuntime 和 Renderer 的标准事件。
 */
export type AgentEvent =
  | {
      type: 'session-created'
      agentId: AgentId
      session: AgentSessionSummary
      occurredAt: string
    }
  | {
      type: 'message-appended'
      agentId: AgentId
      message: AgentMessage
      /** 可选：关联的用户消息标识，用于重试场景标识 inReplyTo。 */
      inReplyTo?: string
      occurredAt: string
    }
  | {
      type: 'turn-started'
      agentId: AgentId
      sessionId: string
      runId: string
      occurredAt: string
    }
  | {
      type: 'message-delta'
      agentId: AgentId
      sessionId: string
      runId: string
      messageId: string
      delta: string
      /** 区分 thinking 原文和普通文本增量，默认为 'text'。 */
      deltaKind?: 'text' | 'thinking'
      occurredAt: string
    }
  | {
      type: 'message-completed'
      agentId: AgentId
      sessionId: string
      runId: string
      message: AgentMessage
      occurredAt: string
    }
  | {
      type: 'turn-cancelled'
      agentId: AgentId
      sessionId: string
      runId: string
      occurredAt: string
    }
  | {
      type: 'turn-failed'
      agentId: AgentId
      sessionId: string
      runId: string
      error: AgentRuntimeErrorPayload
      occurredAt: string
    }
  | {
      type: 'activity-updated'
      agentId: AgentId
      sessionId: string
      runId: string
      activity: AgentActivity
      occurredAt: string
    }
  | {
      type: 'run-state-changed'
      agentId: AgentId
      sessionId: string
      state: AgentRunState
      occurredAt: string
    }
  | {
      type: 'profile-updated'
      agentId: AgentId
      target: 'soul' | 'user'
      updatedAt: string
      occurredAt: string
    }
  | {
      type: 'runtime-error'
      agentId: AgentId
      error: AgentRuntimeErrorPayload
      occurredAt: string
    }
  | {
      type: 'agent-created'
      agentId: AgentId
      agent: AgentSummary
      occurredAt: string
    }
  | {
      type: 'agent-config-updated'
      agentId: AgentId
      agent: AgentSummary
      occurredAt: string
    }
  | {
      type: 'agent-archived'
      agentId: AgentId
      agent: AgentSummary
      occurredAt: string
    }
  | {
      type: 'agent-recovered'
      agentId: AgentId
      agent: AgentSummary
      occurredAt: string
    }
  | {
      type: 'approval-required'
      agentId: AgentId
      sessionId: string
      approval: BashApprovalRequest
      occurredAt: string
    }
  | {
      type: 'approval-resolved'
      agentId: AgentId
      sessionId: string
      approvalId: string
      status: 'approved' | 'rejected'
      occurredAt: string
    }
  | {
      type: 'skill-approval-required'
      agentId: AgentId
      approval: SkillApprovalRequest
      occurredAt: string
    }
  | {
      type: 'skill-approval-resolved'
      agentId: AgentId
      approvalId: string
      status: 'approved' | 'rejected'
      occurredAt: string
    }
  | {
      type: 'transcript-delta'
      agentId: AgentId
      sessionId: string
      delta: TranscriptDelta
      occurredAt: string
    }

/**
 * 处理 Agent 标准事件的回调方法。
 */
export type AgentEventListener = (event: AgentEvent) => void

/**
 * 描述事件订阅句柄。
 */
export interface AgentEventSubscription {
  /**
   * 取消事件订阅。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  unsubscribe(): void
}

/**
 * 描述 Agent profile 文件是否已经初始化以及最近更新时间。
 */
export interface AgentProfileStatus {
  initialized: boolean
  bootstrapRequired: boolean
  soulUpdatedAt: string | null
  userUpdatedAt: string | null
}

/**
 * 描述当前桌面应用正在操作的 Agent。
 */
export interface AgentProfile {
  agentId: AgentId
  displayName: string
  homePath: string
  profile: AgentProfileStatus
}

/**
 * 描述 Agent 的 soul（身份/角色）内容。
 */
export interface SoulContent {
  agentId: AgentId
  content: string
  updatedAt: string
}

/**
 * 描述共享 user profile 内容。
 */
export interface UserProfileContent {
  content: string
  updatedAt: string
}

/**
 * 描述 profile 维护操作结果。
 */
export interface ProfileMaintenanceResult {
  target: 'soul' | 'user'
  success: boolean
  /** 失败原因，如缺少备份、含敏感信息、权限不足等。 */
  reason?: string
}

/**
 * 描述更新 Agent soul 的请求。
 */
export interface UpdateSoulRequest {
  agentId: AgentId
  content: string
}

/**
 * 描述更新共享 user profile 的请求。
 */
export interface UpdateUserProfileRequest {
  content: string
}

/**
 * 描述读取 Agent soul 的请求。
 */
export interface GetSoulRequest {
  agentId: AgentId
}

/**
 * 描述 Agent 目录在磁盘上的健康状态。
 */
export type AgentDirectoryStatus = 'healthy' | 'damaged'

/**
 * 描述 Agent 列表中展示的 Agent 摘要（不含 profile 文件状态）。
 */
export interface AgentSummary {
  agentId: AgentId
  displayName: string
  status: 'active' | 'archived'
  defaultProviderId: string | null
  defaultModelId: string | null
  homePath: string
  archivedAt: string | null
  directoryStatus: AgentDirectoryStatus
}

/**
 * 描述一个可选的模型 Provider。
 */
export interface ProviderDescriptor {
  providerId: string
  displayName: string
}

/**
 * 描述 Provider 下可选的模型。
 */
export interface ModelDescriptor {
  providerId: string
  modelId: string
  displayName: string
}

/**
 * 描述 API Key 是否已配置，以及界面可展示的脱敏值。
 */
export interface ApiKeyState {
  configured: boolean
  maskedValue: string | null
}

/**
 * 描述运行时认证状态。
 */
export type RuntimeAuthState = 'missing-api-key' | 'api-key-configured'

/**
 * 描述运行时可持久化或可展示的设置状态。
 */
export interface RuntimeSettings {
  selectedProviderId: string | null
  selectedModelId: string | null
}

/**
 * 描述运行时认证状态和 API Key 展示状态。
 */
export interface RuntimeAuthSnapshot {
  state: RuntimeAuthState
  apiKey: ApiKeyState
}

/**
 * 描述运行时资源是否已满足最小会话启动条件。
 */
export type RuntimeStatus = 'missing-config' | 'ready'

/**
 * Renderer 用于展示 Provider、模型、认证和 Agent 归属的运行时快照。
 */
export interface RuntimeSnapshot {
  activeAgent: AgentProfile
  agents: AgentSummary[]
  providers: ProviderDescriptor[]
  models: ModelDescriptor[]
  settings: RuntimeSettings
  auth: RuntimeAuthSnapshot
  /** 按 providerId 索引的 Provider 凭据配置状态；Renderer 只能读取脱敏值。 */
  configuredProviders: Record<string, ProviderAuthSnapshot>
  status: RuntimeStatus
  configRecovery: ConfigRecoveryInfo
}

/**
 * 创建 RuntimeSnapshot 时使用的输入。
 */
export interface RuntimeSnapshotInput {
  activeAgent: AgentProfile
  agents?: AgentSummary[]
  providers: ProviderDescriptor[]
  models: ModelDescriptor[]
  settings: RuntimeSettings
  auth: {
    state?: RuntimeAuthState
    apiKey: ApiKeyState
  }
  /** 按 providerId 索引的 Provider 凭据配置状态。*/
  configuredProviders?: Record<string, ProviderAuthSnapshot>
  configRecovery?: ConfigRecoveryInfo
}

/**
 * 描述默认 Agent Home 初始化时要创建的文件和目录状态。
 */
export interface AgentHomeBootstrapStatus {
  initialized: boolean
  bootstrapRequired: boolean
  bootstrapFileExists: boolean
  soulFileExists: boolean
  userFileExists: boolean
  soulUpdatedAt: string | null
  userUpdatedAt: string | null
}

/**
 * 描述用户创建新会话时传给 Main 进程的请求。
 */
export interface CreateSessionRequest {
  agentId: AgentId
  title: string
}

/**
 * 描述读取会话列表时传给 Driver 的过滤条件。
 */
export interface ListSessionsRequest {
  agentId: AgentId
}

/**
 * 描述打开单个会话消息时需要的定位信息。
 */
export interface GetSessionMessagesRequest {
  agentId: AgentId
  sessionId: string
}

/**
 * 描述向 Agent 会话发送消息的请求。
 */
export interface SendMessageRequest {
  agentId: AgentId
  sessionId: string
  content: string
}

/**
 * 描述取消正在运行的 Agent 响应时需要的定位信息。
 */
export interface CancelRunRequest {
  agentId: AgentId
  sessionId: string
}

/**
 * 描述重试失败的用户消息时需要的定位信息。
 *
 * 重试复用原始用户请求，创建新的执行尝试，不追加重复 UserMessage。
 */
export interface RetryRunRequest {
  agentId: AgentId
  sessionId: string
  /** 要重试的原始用户消息标识。 */
  userMessageId: string
}

/**
 * 描述保存运行时配置时传入的 Provider、模型和凭据。
 */
export interface RuntimeConfiguration {
  providerId: string
  modelId: string
  apiKey: string
}

/**
 * 描述取消配置验证时传给 Main 进程的请求。
 */
export interface CancelConfigurationVerificationRequest {
  verificationId: string
}

/**
 * 描述更新 Agent 默认配置时传给 Main 进程的请求。
 */
export interface UpdateAgentConfigRequest {
  agentId: AgentId
  defaultProviderId?: string | null
  defaultModelId?: string | null
}

/**
 * 描述归档 Agent 时传给 Main 进程的请求。
 */
export interface ArchiveAgentRequest {
  agentId: AgentId
}

/**
 * 描述恢复已归档 Agent 时传给 Main 进程的请求。
 */
export interface RecoverAgentRequest {
  agentId: AgentId
}

/**
 * 描述认领未归属 Agent 目录时传给 Main 进程的请求。
 */
export interface ClaimAgentDirectoryRequest {
  agentId: string
  displayName: string
}

/**
 * 描述目录对账中发现的未归属 Agent 目录。
 */
export interface UnclaimedDirectory {
  agentId: string
  homePath: string
  hasSoul: boolean
}

/**
 * 描述设置 Session 当前模型时传给 Main 进程的请求。
 */
export interface SetSessionModelRequest {
  agentId: AgentId
  sessionId: string
  providerId: string
  modelId: string
}

/**
 * 描述设置 Session Thinking Level 时传给 Main 进程的请求。
 */
export interface SetSessionThinkingLevelRequest {
  agentId: AgentId
  sessionId: string
  level: string
}

/**
 * 描述读取 Session 模型信息时传给 Main 进程的请求。
 */
export interface GetSessionModelInfoRequest {
  agentId: AgentId
  sessionId: string
}

/**
 * 校验安全打开外部链接请求。
 */
export interface OpenExternalLinkRequest {
  url: string
}

/**
 * Renderer 用于展示当前 Session 使用的模型和 Thinking Level 信息。
 */
export interface SessionModelInfo {
  providerId: string
  modelId: string
  displayName: string
  thinkingLevel: string | null
  supportedThinkingLevels: string[]
  supportsThinking: boolean
}

/**
 * 描述单个 Skill 的摘要信息（Render 可见）。
 */
export interface SkillSummary {
  /** Skill 名称（来自 SKILL.md frontmatter 的 name 字段）。 */
  name: string
  /** Skill 描述（来自 SKILL.md frontmatter 的 description 字段）。 */
  description: string
  /** Skill 来源：shared 表示共享 Skill，agent 表示 Agent 专属 Skill。 */
  source: 'shared' | 'agent'
  /** SKILL.md 文件的绝对路径。 */
  path: string
  /** 当同名 Skill 在两层同时存在时的冲突信息。 */
  conflict?: {
    /** 被覆盖的 Skill 路径。 */
    overriddenPath: string
    /** 被覆盖的 Skill 来源。 */
    overriddenSource: 'shared' | 'agent'
  }
  /** Skill 目录是否包含 scripts 子目录。 */
  hasScripts: boolean
}

/**
 * 描述某个 Agent 的 Skill 加载状态。
 */
export interface AgentSkillsStatus {
  agentId: AgentId
  /** 当前 Agent 实际生效的 Skill 列表（专属覆盖共享后的最终列表）。 */
  skills: SkillSummary[]
  /** 共享 Skill 总数（含被覆盖的）。 */
  sharedSkillsCount: number
  /** Agent 专属 Skill 总数。 */
  agentSkillsCount: number
  /** 同名冲突 Skill 数量。 */
  conflictsCount: number
}

/**
 * 描述读取指定 Agent Skills 的请求。
 */
export interface ListAgentSkillsRequest {
  agentId: AgentId
}

/**
 * 描述一次 Skill 操作的审批请求（传给 Renderer 展示）。
 */
export interface SkillApprovalRequest {
  approvalId: string
  agentId: AgentId
  /** 操作类型。 */
  operation: 'install' | 'delete'
  /** Skill 来源范围。 */
  source: 'shared' | 'agent'
  /** 专属 Skill 操作时的目标 Agent。 */
  targetAgentId?: AgentId
  skillName: string
  /** SKILL.md 中的 description 字段内容。 */
  description: string
  /** Skill 目录是否包含 scripts 子目录。 */
  hasScripts: boolean
  /** 当同名 Skill 在两层同时存在时的冲突信息。 */
  conflict?: {
    overriddenPath: string
    overriddenSource: 'shared' | 'agent'
  }
  status: ApprovalStatus
  createdAt: string
}

/**
 * 描述一次 Skill 操作的参数。
 */
export interface SkillOperationParams {
  operation: 'install' | 'delete'
  source: 'shared' | 'agent'
  /** 发起操作的 Agent 标识。 */
  agentId: AgentId
  /** 专属 Skill 操作时的目标 Agent。 */
  targetAgentId?: AgentId
  skillName: string
  /** 源 Skill 目录路径（install 操作使用）。 */
  skillDirPath?: string
}

/**
 * 控制台展示的单条 Skill 安装记录。
 */
export interface SkillInstallRecord {
  skillName: string
  source: 'shared' | 'agent'
  targetAgentId?: AgentId
  installedAt: string
  updatedAt: string
  status: 'active' | 'deleted'
}

/**
 * 持久化在磁盘上的 Skill 安装记录结构。
 */
export interface PersistedSkillRecords {
  skills: SkillInstallRecord[]
}

/**
 * 描述持久化在磁盘上的单个 Provider 凭据（API Key 已加密）。
 */
export interface ProviderCredentials {
  encryptedApiKey: string
  updatedAt: string
}

/**
 * 描述持久化在磁盘上的单个 Agent 配置。
 */
export interface AgentConfig {
  displayName: string
  defaultProviderId: string | null
  defaultModelId: string | null
  status: 'active' | 'archived'
  archivedAt: string | null
}

/**
 * 描述 v2 版本磁盘配置结构。
 */
export interface PersistedConfigurationV2 {
  schemaVersion: 2
  providers: Record<string, ProviderCredentials>
  agents: Record<string, AgentConfig>
}

/**
 * 描述 v1 版本磁盘配置结构（用于迁移）。
 */
export interface PersistedConfigurationV1 {
  providerId: string
  modelId: string
  apiKey: string
}

/**
 * 描述解密后的 Provider 凭据（仅存在于 Main 进程内存中）。
 */
export interface InternalProviderCredentials {
  apiKey: string
  updatedAt: string
}

/**
 * 描述解密后的运行时配置（仅存在于 Main 进程内存中，不离开 Main 进程）。
 */
export interface InternalRuntimeConfig {
  schemaVersion: number
  providers: Record<string, InternalProviderCredentials>
  agents: Record<string, AgentConfig>
}

/**
 * 描述配置完整性状态。
 */
export type ConfigRecoveryState = 'ok' | 'corrupted' | 'migration-failed'

/**
 * 描述配置恢复信息。
 */
export interface ConfigRecoveryInfo {
  state: ConfigRecoveryState
  hasBackup: boolean
}

/**
 * 描述单个 Provider 的认证状态（Renderer 可见）。
 */
export interface ProviderAuthSnapshot {
  configured: boolean
  maskedValue: string | null
}

/**
 * 描述配置存储加解密抽象，由 Electron Main 注入 safeStorage 实现。
 */
export interface ConfigEncryptionAdapter {
  /** 加密明文 API Key，返回 base64 密文。 */
  encrypt(plaintext: string): Promise<string>
  /** 解密 base64 密文，返回明文 API Key。 */
  decrypt(ciphertext: string): Promise<string>
  /** 检查当前系统是否可用加密能力。 */
  isAvailable(): boolean
}
