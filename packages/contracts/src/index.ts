import { z } from 'zod'

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

const nonEmptyIdentifierSchema = z.string().trim().min(1)
const timestampSchema = z.string().trim().min(1)

/**
 * 校验跨进程传输的 Agent 消息。
 */
export const agentMessageSchema = z.strictObject({
  messageId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  role: z.enum(['user', 'agent', 'system', 'compaction']),
  content: z.string(),
  createdAt: timestampSchema,
})

/**
 * 校验跨进程传输的会话摘要。
 */
export const agentSessionSummarySchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  title: z.string(),
  state: z.enum([
    'idle',
    'queued',
    'running',
    'completed',
    'cancelled',
    'failed',
  ]),
  updatedAt: timestampSchema,
})

/**
 * 校验 Agent profile 文件状态。
 */
export const agentProfileStatusSchema = z.strictObject({
  initialized: z.boolean(),
  bootstrapRequired: z.boolean(),
  soulUpdatedAt: timestampSchema.nullable(),
  userUpdatedAt: timestampSchema.nullable(),
})

/**
 * 校验当前桌面应用正在操作的 Agent profile。
 */
export const agentProfileSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  displayName: z.string(),
  homePath: z.string(),
  profile: agentProfileStatusSchema,
})

/**
 * 校验可选 Provider 描述。
 */
export const providerDescriptorSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  displayName: z.string(),
})

/**
 * 校验可选模型描述。
 */
export const modelDescriptorSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
  displayName: z.string(),
})

/**
 * 校验 API Key 的脱敏配置状态。
 */
export const apiKeyStateSchema = z.strictObject({
  configured: z.boolean(),
  maskedValue: z.string().nullable(),
})

/**
 * 校验单个 Provider 的认证状态（可安全传给 Renderer）。
 */
export const providerAuthSnapshotSchema = z.strictObject({
  configured: z.boolean(),
  maskedValue: z.string().nullable(),
})

/**
 * 校验运行时 Provider 与 Model 设置。
 */
export const runtimeSettingsSchema = z.strictObject({
  selectedProviderId: z.string().nullable(),
  selectedModelId: z.string().nullable(),
})

/**
 * 校验运行时认证状态。
 */
export const runtimeAuthSnapshotSchema = z.strictObject({
  state: z.enum(['missing-api-key', 'api-key-configured']),
  apiKey: apiKeyStateSchema,
})

/**
 * 校验 Renderer 可以接收的完整运行时快照。
 */
export const runtimeSnapshotSchema = z.strictObject({
  activeAgent: agentProfileSchema,
  agents: z.array(
    z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
  ),
  providers: z.array(providerDescriptorSchema),
  models: z.array(modelDescriptorSchema),
  settings: runtimeSettingsSchema,
  auth: runtimeAuthSnapshotSchema,
  configuredProviders: z.record(z.string(), providerAuthSnapshotSchema),
  status: z.enum(['missing-config', 'ready']),
  configRecovery: z.strictObject({
    state: z.enum(['ok', 'corrupted', 'migration-failed']),
    hasBackup: z.boolean(),
  }),
})

/**
 * 校验持久化在磁盘上的 v2 Provider 凭据。
 */
export const providerCredentialsSchema = z.strictObject({
  encryptedApiKey: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验持久化在磁盘上的 Agent 配置。
 */
export const agentConfigSchema = z.strictObject({
  displayName: z.string(),
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  archivedAt: z.string().nullable(),
})

/**
 * 校验 Agent soul 内容。
 */
export const soulContentSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  content: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验共享 user profile 内容。
 */
export const userProfileContentSchema = z.strictObject({
  content: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验 profile 维护操作结果。
 */
export const profileMaintenanceResultSchema = z.strictObject({
  target: z.enum(['soul', 'user']),
  success: z.boolean(),
  reason: z.string().optional(),
})

/**
 * 校验更新 soul 请求。
 */
export const updateSoulRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验更新共享 user profile 请求。
 */
export const updateUserProfileRequestSchema = z.strictObject({
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验读取 soul 请求。
 */
export const getSoulRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验 v2 版本磁盘配置结构。
 */
export const persistedConfigurationV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  providers: z.record(z.string(), providerCredentialsSchema),
  agents: z.record(z.string(), agentConfigSchema),
})

/**
 * 校验配置恢复信息。
 */
export const configRecoveryInfoSchema = z.strictObject({
  state: z.enum(['ok', 'corrupted', 'migration-failed']),
  hasBackup: z.boolean(),
})

/**
 * 校验可以安全暴露给 Renderer 的 Runtime 错误。
 */
export const agentRuntimeErrorPayloadSchema = z.strictObject({
  code: z.enum([
    'configuration-missing',
    'driver-unavailable',
    'provider-verification-failed',
    'session-not-found',
    'run-already-active',
    'run-cancelled',
    'unknown',
  ]),
  message: z.string(),
  recoverable: z.boolean(),
})

/**
 * 校验不含敏感参数的 Agent 活动摘要。
 */
export const agentActivitySchema = z.strictObject({
  kind: z.enum(['thinking', 'tool']),
  state: z.enum(['running', 'completed', 'failed']),
  label: z.string(),
})

/**
 * 校验 Bash 审批请求。
 */
export const bashApprovalRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  runId: nonEmptyIdentifierSchema,
  command: z.string().min(1),
  cwd: z.string().min(1),
  riskDescription: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: timestampSchema,
})

/**
 * 校验 Main 向 Renderer 推送的标准 Agent 事件。
 */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('session-created'),
    agentId: nonEmptyIdentifierSchema,
    session: agentSessionSummarySchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-appended'),
    agentId: nonEmptyIdentifierSchema,
    message: agentMessageSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-started'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-delta'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    messageId: nonEmptyIdentifierSchema,
    delta: z.string(),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-completed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    message: agentMessageSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-cancelled'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-failed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    error: agentRuntimeErrorPayloadSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('activity-updated'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    activity: agentActivitySchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('run-state-changed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    state: z.enum([
      'idle',
      'queued',
      'running',
      'completed',
      'cancelled',
      'failed',
    ]),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('profile-updated'),
    agentId: nonEmptyIdentifierSchema,
    target: z.enum(['soul', 'user']),
    updatedAt: timestampSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('runtime-error'),
    agentId: nonEmptyIdentifierSchema,
    error: agentRuntimeErrorPayloadSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-created'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-config-updated'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-archived'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-recovered'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('approval-required'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    approval: bashApprovalRequestSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('approval-resolved'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    approvalId: nonEmptyIdentifierSchema,
    status: z.enum(['approved', 'rejected']),
    occurredAt: timestampSchema,
  }),
])

/**
 * 校验创建会话请求。
 */
export const createSessionRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  title: z.string().trim().min(1),
})

/**
 * 校验读取会话消息请求。
 */
export const getSessionMessagesRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验发送消息请求，并保留用户输入的原始空白。
 */
export const sendMessageRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验取消运行请求。
 */
export const cancelRunRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验保存 Runtime 配置请求。
 */
export const runtimeConfigurationSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
  apiKey: z.string().refine((apiKey) => apiKey.trim().length > 0),
})

/**
 * 校验取消配置验证请求。
 */
export const cancelConfigurationVerificationRequestSchema = z.strictObject({
  verificationId: nonEmptyIdentifierSchema,
})

/**
 * 校验更新 Agent 默认配置请求。
 */
export const updateAgentConfigRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  defaultProviderId: z.string().nullable().optional(),
  defaultModelId: z.string().nullable().optional(),
})

/**
 * 校验归档 Agent 请求。
 */
export const archiveAgentRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验恢复 Agent 请求。
 */
export const recoverAgentRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验认领 Agent 目录请求。
 */
export const claimAgentDirectoryRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  displayName: z.string().trim().min(1),
})

/**
 * 校验设置 Session 模型请求。
 */
export const setSessionModelRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
})

/**
 * 校验设置 Session Thinking Level 请求。
 */
export const setSessionThinkingLevelRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  level: z.string().trim().min(1),
})

/**
 * 校验读取 Session 模型信息请求。
 */
export const getSessionModelInfoRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验单个 Skill 摘要。
 */
export const skillSummarySchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  source: z.enum(['shared', 'agent']),
  path: z.string(),
  conflict: z
    .strictObject({
      overriddenPath: z.string(),
      overriddenSource: z.enum(['shared', 'agent']),
    })
    .optional(),
  hasScripts: z.boolean(),
})

/**
 * 校验 Agent Skills 状态。
 */
export const agentSkillsStatusSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  skills: z.array(skillSummarySchema),
  sharedSkillsCount: z.number().int().min(0),
  agentSkillsCount: z.number().int().min(0),
  conflictsCount: z.number().int().min(0),
})

/**
 * 校验读取指定 Agent Skills 的请求。
 */
export const listAgentSkillsRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验 Skill 审批请求。
 */
export const skillApprovalRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  operation: z.enum(['install', 'delete']),
  source: z.enum(['shared', 'agent']),
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  skillName: z.string().min(1),
  description: z.string(),
  hasScripts: z.boolean(),
  conflict: z
    .strictObject({
      overriddenPath: z.string(),
      overriddenSource: z.enum(['shared', 'agent']),
    })
    .optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: timestampSchema,
})

/**
 * 校验 Skill 操作参数。
 */
export const skillOperationParamsSchema = z.strictObject({
  operation: z.enum(['install', 'delete']),
  source: z.enum(['shared', 'agent']),
  agentId: nonEmptyIdentifierSchema,
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  skillName: z.string().min(1),
  skillDirPath: z.string().optional(),
})

/**
 * 校验 Skill 安装记录。
 */
export const skillInstallRecordSchema = z.strictObject({
  skillName: z.string().min(1),
  source: z.enum(['shared', 'agent']),
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  installedAt: timestampSchema,
  updatedAt: timestampSchema,
  status: z.enum(['active', 'deleted']),
})

/**
 * 校验 Session 模型信息。
 */
export const sessionModelInfoSchema = z.strictObject({
  providerId: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  thinkingLevel: z.string().nullable(),
  supportedThinkingLevels: z.array(z.string()),
  supportsThinking: z.boolean(),
})

/**
 * 描述 Renderer 请求 Main 安全打开外部链接的请求载荷。
 */
export interface OpenExternalLinkRequest {
  url: string
}

/**
 * Renderer 请求 Main 安全打开外部链接的 Zod schema。
 */
export const openExternalLinkRequestSchema = z.strictObject({
  url: z.string().min(1),
})

/**
 * 校验批准 Bash 执行的请求。
 */
export const approveBashRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
})

/**
 * 校验拒绝 Bash 执行的请求。
 */
export const rejectBashRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
})

/**
 * 桌面端允许 Renderer 通过 Preload API 调用的 IPC channel。
 */
export const DESKTOP_IPC_CHANNELS = {
  runtimeGetSnapshot: 'tangyuan:runtime:get-snapshot',
  runtimeRefresh: 'tangyuan:runtime:refresh',
  runtimeSaveConfiguration: 'tangyuan:runtime:save-configuration',
  runtimeCancelConfigurationVerification:
    'tangyuan:runtime:cancel-configuration-verification',
  runtimeRestoreFromBackup: 'tangyuan:runtime:restore-from-backup',
  runtimeResetConfiguration: 'tangyuan:runtime:reset-configuration',
  sessionsList: 'tangyuan:sessions:list',
  sessionsCreate: 'tangyuan:sessions:create',
  sessionsGetMessages: 'tangyuan:sessions:get-messages',
  sessionsSendMessage: 'tangyuan:sessions:send-message',
  sessionsCancelRun: 'tangyuan:sessions:cancel-run',
  agentsList: 'tangyuan:agents:list',
  agentsUpdateConfig: 'tangyuan:agents:update-config',
  agentsArchive: 'tangyuan:agents:archive',
  agentsRecover: 'tangyuan:agents:recover',
  agentsReconcile: 'tangyuan:agents:reconcile',
  agentsClaimDirectory: 'tangyuan:agents:claim-directory',
  agentsRebuildTangyuan: 'tangyuan:agents:rebuild-tangyuan',
  sessionsGetModelInfo: 'tangyuan:sessions:get-model-info',
  sessionsSetModel: 'tangyuan:sessions:set-model',
  sessionsSetThinkingLevel: 'tangyuan:sessions:set-thinking-level',
  profileGetSoul: 'tangyuan:profile:get-soul',
  profileGetUser: 'tangyuan:profile:get-user',
  profileUpdateSoul: 'tangyuan:profile:update-soul',
  profileUpdateUser: 'tangyuan:profile:update-user',
  skillsListAgent: 'tangyuan:skills:list-agent',
  skillsListShared: 'tangyuan:skills:list-shared',
  skillsInstall: 'tangyuan:skills:install',
  skillsDelete: 'tangyuan:skills:delete',
  skillsApproveOperation: 'tangyuan:skills:approve-operation',
  skillsRejectOperation: 'tangyuan:skills:reject-operation',
  skillsGetPendingApprovals: 'tangyuan:skills:get-pending-approvals',
  skillsGetInstallRecords: 'tangyuan:skills:get-install-records',
  openExternalLink: 'tangyuan:open-external-link',
  sessionsApproveBash: 'tangyuan:sessions:approve-bash',
  sessionsRejectBash: 'tangyuan:sessions:reject-bash',
  sessionsGetPendingApprovals: 'tangyuan:sessions:get-pending-approvals',
} as const

/**
 * Main 进程向 Renderer 推送 Agent 标准事件时使用的 IPC channel。
 */
export const DESKTOP_AGENT_EVENT_CHANNEL = 'tangyuan:agent:event'

/**
 * 描述桌面端允许使用的 IPC channel 名称。
 */
export type DesktopIpcChannel =
  (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS]

/**
 * 描述每个 IPC channel 对应的请求载荷。
 */
export interface DesktopIpcRequestMap {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: RuntimeConfiguration
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]: CancelConfigurationVerificationRequest
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsList]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: CreateSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: GetSessionMessagesRequest
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: SendMessageRequest
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: CancelRunRequest
  [DESKTOP_IPC_CHANNELS.agentsList]: undefined
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: UpdateAgentConfigRequest
  [DESKTOP_IPC_CHANNELS.agentsArchive]: ArchiveAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsRecover]: RecoverAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: undefined
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: ClaimAgentDirectoryRequest
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: GetSessionModelInfoRequest
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: SetSessionModelRequest
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: SetSessionThinkingLevelRequest
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: GetSoulRequest
  [DESKTOP_IPC_CHANNELS.profileGetUser]: undefined
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: UpdateSoulRequest
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: UpdateUserProfileRequest
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: ListAgentSkillsRequest
  [DESKTOP_IPC_CHANNELS.skillsListShared]: undefined
  [DESKTOP_IPC_CHANNELS.skillsInstall]: SkillOperationParams
  [DESKTOP_IPC_CHANNELS.skillsDelete]: SkillOperationParams
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: ApproveBashRequest
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: RejectBashRequest
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: undefined
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: undefined
  [DESKTOP_IPC_CHANNELS.openExternalLink]: OpenExternalLinkRequest
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: ApproveBashRequest
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: RejectBashRequest
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: undefined
}

/**
 * 保存每个 IPC channel 对应的运行时请求 schema。
 */
export const desktopIpcRequestSchemas = {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: runtimeConfigurationSchema,
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]:
    cancelConfigurationVerificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsList]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: createSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: getSessionMessagesRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: sendMessageRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: cancelRunRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: updateAgentConfigRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsArchive]: archiveAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRecover]: recoverAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: claimAgentDirectoryRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: getSessionModelInfoRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: setSessionModelRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]:
    setSessionThinkingLevelRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: getSoulRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileGetUser]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: updateSoulRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: updateUserProfileRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: listAgentSkillsRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsListShared]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.skillsInstall]: skillOperationParamsSchema,
  [DESKTOP_IPC_CHANNELS.skillsDelete]: skillOperationParamsSchema,
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: approveBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.openExternalLink]: openExternalLinkRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: approveBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: z.undefined(),
} satisfies Record<DesktopIpcChannel, z.ZodType>

/**
 * 在 Main 进程调用 Runtime 前重新校验 IPC 请求。
 *
 * @param channel - Renderer 调用的 IPC channel。
 * @param payload - Electron 传入的未知请求载荷。
 * @returns 通过对应 schema 校验后的类型化请求。
 * @throws 当请求载荷不符合 contract 时抛出 ZodError。
 */
export function parseDesktopIpcRequest<Channel extends DesktopIpcChannel>(
  channel: Channel,
  payload: unknown,
): DesktopIpcRequest<Channel> {
  return desktopIpcRequestSchemas[channel].parse(
    payload,
  ) as DesktopIpcRequest<Channel>
}

/**
 * 描述每个 IPC channel 对应的响应载荷。
 */
export interface DesktopIpcResponseMap {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsList]: AgentSessionSummary[]
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: AgentMessage[]
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: AgentMessage[]
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.agentsList]: AgentSummary[]
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsArchive]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsRecover]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: {
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: AgentSummary
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: SoulContent
  [DESKTOP_IPC_CHANNELS.profileGetUser]: UserProfileContent
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: ProfileMaintenanceResult
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: ProfileMaintenanceResult
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsListShared]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsInstall]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsDelete]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: void
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: void
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: SkillApprovalRequest[]
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: SkillInstallRecord[]
  [DESKTOP_IPC_CHANNELS.openExternalLink]: void
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: void
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: void
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: BashApprovalRequest[]
}

/**
 * 保存每个 IPC channel 对应的运行时响应 schema。
 */
export const desktopIpcResponseSchemas = {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]:
    runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsList]: z.array(agentSessionSummarySchema),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: z.array(agentMessageSchema),
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: z.array(agentMessageSchema),
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.array(
    z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
  ),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsArchive]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsRecover]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.strictObject({
    agents: z.array(
      z.strictObject({
        agentId: nonEmptyIdentifierSchema,
        displayName: z.string(),
        status: z.enum(['active', 'archived']),
        defaultProviderId: z.string().nullable(),
        defaultModelId: z.string().nullable(),
        homePath: z.string(),
        archivedAt: z.string().nullable(),
        directoryStatus: z.enum(['healthy', 'damaged']),
      }),
    ),
    unclaimedDirectories: z.array(
      z.strictObject({
        agentId: nonEmptyIdentifierSchema,
        homePath: z.string(),
        hasSoul: z.boolean(),
      }),
    ),
  }),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: soulContentSchema,
  [DESKTOP_IPC_CHANNELS.profileGetUser]: userProfileContentSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: profileMaintenanceResultSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: profileMaintenanceResultSchema,
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsListShared]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsInstall]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsDelete]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: z.void(),
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: z.void(),
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: z.array(
    skillApprovalRequestSchema,
  ),
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: z.array(
    skillInstallRecordSchema,
  ),
  [DESKTOP_IPC_CHANNELS.openExternalLink]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: z.array(
    bashApprovalRequestSchema,
  ),
} satisfies Record<DesktopIpcChannel, z.ZodType>

/**
 * 在 Main 进程把响应传给 Renderer 前重新校验 IPC 返回值。
 *
 * @param channel - Renderer 调用的 IPC channel。
 * @param response - Runtime 返回的未知响应载荷。
 * @returns 通过对应 schema 校验后的类型化响应。
 * @throws 当响应载荷不符合 contract 时抛出 ZodError。
 */
export function parseDesktopIpcResponse<Channel extends DesktopIpcChannel>(
  channel: Channel,
  response: unknown,
): DesktopIpcResponse<Channel> {
  return desktopIpcResponseSchemas[channel].parse(
    response,
  ) as DesktopIpcResponse<Channel>
}

/**
 * 描述某个 IPC channel 需要的请求载荷。
 */
export type DesktopIpcRequest<Channel extends DesktopIpcChannel> =
  DesktopIpcRequestMap[Channel]

/**
 * 描述某个 IPC channel 会返回的响应载荷。
 */
export type DesktopIpcResponse<Channel extends DesktopIpcChannel> =
  DesktopIpcResponseMap[Channel]

/**
 * 描述调用某个 IPC channel 时是否需要传 payload 参数。
 */
export type DesktopIpcPayloadArgs<Channel extends DesktopIpcChannel> =
  DesktopIpcRequest<Channel> extends undefined
    ? []
    : [payload: DesktopIpcRequest<Channel>]

/**
 * Renderer 能通过 `window.api` 调用的桌面端能力。
 */
export interface DesktopPreloadApi {
  /**
   * 读取当前运行时快照。
   *
   * @returns Provider、模型、API Key 和 activeAgent 状态。
   * @throws 当 Main 进程无法读取运行时资源时，Promise 会 reject。
   */
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>

  /**
   * 刷新运行时资源并返回最新快照。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 Provider 或模型资源刷新失败时，Promise 会 reject。
   */
  refreshRuntime(): Promise<RuntimeSnapshot>

  /**
   * 验证并保存运行时配置。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当 Main 进程验证失败或保存失败时，Promise 会 reject。
   */
  saveRuntimeConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>

  /**
   * 取消正在进行的配置验证。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当 Main 进程无法取消验证时，Promise 会 reject。
   */
  cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>

  /**
   * 读取当前 Agent 的会话列表。
   *
   * @returns 会话摘要列表。
   * @throws 当会话索引读取失败时，Promise 会 reject。
   */
  listSessions(): Promise<AgentSessionSummary[]>

  /**
   * 创建一个新的 Agent 会话。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 Driver 无法创建会话时，Promise 会 reject。
   */
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>

  /**
   * 读取指定会话的对话消息。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 会话里的消息列表。
   * @throws 当会话不存在或 Main 进程无法读取消息时，Promise 会 reject。
   */
  getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]>

  /**
   * 向指定 Agent 会话发送一条用户消息。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后可展示的最新消息列表。
   * @throws 当配置缺失、会话不存在或 Agent 运行失败时，Promise 会 reject。
   */
  sendMessage(request: SendMessageRequest): Promise<AgentMessage[]>

  /**
   * 取消指定会话正在运行的 Agent 响应。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 取消后的会话摘要。
   * @throws 当会话不存在或 Main 进程无法取消运行时，Promise 会 reject。
   */
  cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>

  /**
   * 订阅 Main 进程转发的 Agent 标准事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 取消订阅方法。
   * @throws 此方法不会主动抛出错误。
   */
  subscribeToAgentEvents(listener: AgentEventListener): () => void

  /**
   * 列出所有 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当 Main 进程无法读取配置时，Promise 会 reject。
   */
  listAgents(): Promise<AgentSummary[]>

  /**
   * 从备份恢复配置。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  restoreFromBackup(): Promise<RuntimeSnapshot>

  /**
   * 重置配置并删除当前和备份配置文件（不删除 Agent 数据或 Pi session）。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当重置失败时，Promise 会 reject。
   */
  resetConfiguration(): Promise<RuntimeSnapshot>

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param request - Agent 标识和要更新的默认 Provider/Model。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  updateAgentConfig(request: UpdateAgentConfigRequest): Promise<AgentSummary>

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param request - 要归档的 Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆或配置保存失败时，Promise 会 reject。
   */
  archiveAgent(request: ArchiveAgentRequest): Promise<AgentSummary>

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param request - 要恢复的 Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  recoverAgent(request: RecoverAgentRequest): Promise<AgentSummary>

  /**
   * 执行目录对账：标记损坏 Agent 并发现未归属目录。
   *
   * @returns 包含更新后 Agent 列表和未归属目录的对账报告。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }>

  /**
   * 认领未归属的 Agent 目录，为其创建配置条目。
   *
   * @param request - 目录的 agentId 和展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当目录不存在或配置保存失败时，Promise 会 reject。
   */
  claimAgentDirectory(
    request: ClaimAgentDirectoryRequest,
  ): Promise<AgentSummary>

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  rebuildTangyuanHome(): Promise<AgentSummary>

  /**
   * 读取当前 Session 使用的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 的模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  setSessionModel(request: SetSessionModelRequest): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo>

  /**
   * 读取指定 Agent 的 soul（身份/角色）内容。
   *
   * @param request - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 Agent 不存在或文件读取失败时，Promise 会 reject。
   */
  getSoul(request: GetSoulRequest): Promise<SoulContent>

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件不存在或读取失败时，Promise 会 reject。
   */
  getUserProfile(): Promise<UserProfileContent>

  /**
   * 更新指定 Agent 的 soul 内容。
   *
   * @param request - Agent 标识和新 soul 内容。
   * @returns profile 维护结果，包含成功状态和可能的失败原因。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateSoul(request: UpdateSoulRequest): Promise<ProfileMaintenanceResult>

  /**
   * 更新共享 user profile 内容。
   *
   * @param request - 新 user profile 内容。
   * @returns profile 维护结果，包含成功状态和可能的失败原因。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateUserProfile(
    request: UpdateUserProfileRequest,
  ): Promise<ProfileMaintenanceResult>

  /**
   * 请求 Main 进程校验协议后使用系统浏览器安全打开外部链接。
   *
   * @param request - 待打开的外部 URL。
   * @returns 无返回值；协议不允许或 URL 无效时 Promise 会 reject。
   * @throws 当 URL 协议不是 http/https 时 Promise 会 reject。
   */
  openExternalLink(request: OpenExternalLinkRequest): Promise<void>

  /**
   * 读取指定 Agent 实际生效的 Skill 列表及冲突诊断。
   *
   * @param request - Agent 标识。
   * @returns Agent 的 Skill 摘要列表。
   * @throws 当 Agent 不存在或 Skill 目录读取失败时，Promise 会 reject。
   */
  listAgentSkills(request: ListAgentSkillsRequest): Promise<SkillSummary[]>

  /**
   * 读取共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当共享 Skill 目录读取失败时，Promise 会 reject。
   */
  listSharedSkills(): Promise<SkillSummary[]>

  /**
   * 安装或更新 Skill。
   *
   * @param params - 操作类型、来源、目标 Agent、Skill 名称和源目录路径。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、Skill 校验失败或文件操作失败时，Promise 会 reject。
   */
  installSkill(params: SkillOperationParams): Promise<SkillSummary[]>

  /**
   * 删除 Skill。
   *
   * @param params - 操作类型、来源、目标 Agent 和 Skill 名称。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足或文件操作失败时，Promise 会 reject。
   */
  deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]>

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  approveSkillOperation(request: ApproveBashRequest): Promise<void>

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  rejectSkillOperation(request: RejectBashRequest): Promise<void>

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingSkillApprovals(): Promise<SkillApprovalRequest[]>

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  getSkillInstallRecords(): Promise<SkillInstallRecord[]>

  /**
   * 批准指定 Bash 审批请求，使命令继续执行。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  approveBash(request: ApproveBashRequest): Promise<void>

  /**
   * 拒绝指定 Bash 审批请求，向 Agent 返回拒绝工具结果。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  rejectBash(request: RejectBashRequest): Promise<void>

  /**
   * 读取所有待审批的 Bash 请求。
   *
   * @returns 待审批请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingApprovals(): Promise<BashApprovalRequest[]>
}

/**
 * 根据运行时配置生成 Renderer 可直接展示的就绪状态。
 *
 * 只有同时满足以下条件才返回 `ready`：
 * 1. 已选择默认 Provider 和 Model
 * 2. 所选 Provider 的凭据已配置
 *
 * @param snapshot - 当前运行时资源快照，不包含派生状态。
 * @returns 满足会话启动条件时返回 `ready`，否则返回 `missing-config`。
 * @throws 此方法不会主动抛出错误。
 */
export function getRuntimeStatus(
  snapshot: RuntimeSnapshotInput,
): RuntimeStatus {
  const { selectedProviderId, selectedModelId } = snapshot.settings
  if (!selectedProviderId || !selectedModelId) return 'missing-config'
  const configuredProviders = snapshot.configuredProviders ?? {}
  return configuredProviders[selectedProviderId]?.configured
    ? 'ready'
    : 'missing-config'
}

/**
 * 根据 API Key 配置状态生成认证状态。
 *
 * @param apiKey - API Key 的配置和脱敏展示状态。
 * @returns 已配置时返回 `api-key-configured`，否则返回 `missing-api-key`。
 * @throws 此方法不会主动抛出错误。
 */
export function getRuntimeAuthState(apiKey: ApiKeyState): RuntimeAuthState {
  return apiKey.configured ? 'api-key-configured' : 'missing-api-key'
}

/**
 * 生成带有默认状态字段的运行时资源快照。
 *
 * `auth` 字段从 `configuredProviders` 和当前选中的 Provider 派生：
 * - 如果选中 Provider 在 `configuredProviders` 中，`auth.apiKey` 取其值
 * - 否则 `auth.apiKey` 为未配置状态
 *
 * @param snapshot - 不包含派生状态的运行时资源数据。
 * @returns 带有 `status` 的完整运行时资源快照。
 * @throws 此方法不会主动抛出错误。
 */
export function createRuntimeSnapshot(
  snapshot: RuntimeSnapshotInput,
): RuntimeSnapshot {
  const configuredProviders = snapshot.configuredProviders ?? {}

  // 从选中 Provider 派生向后兼容的 auth 字段
  const selectedProviderId = snapshot.settings.selectedProviderId
  const selectedProviderAuth = selectedProviderId
    ? configuredProviders[selectedProviderId]
    : undefined
  const derivedApiKey: ApiKeyState = selectedProviderAuth ?? {
    configured: false,
    maskedValue: null,
  }
  const derivedAuth: RuntimeAuthSnapshot = {
    state: snapshot.auth.state ?? getRuntimeAuthState(derivedApiKey),
    apiKey: derivedApiKey,
  }

  return {
    ...snapshot,
    agents: snapshot.agents ?? [
      {
        agentId: snapshot.activeAgent.agentId,
        displayName: snapshot.activeAgent.displayName,
        status: 'active' as const,
        defaultProviderId: snapshot.settings.selectedProviderId,
        defaultModelId: snapshot.settings.selectedModelId,
        homePath: snapshot.activeAgent.homePath,
        archivedAt: null,
        directoryStatus: 'healthy' as const,
      },
    ],
    configuredProviders,
    auth: derivedAuth,
    status: getRuntimeStatus({ ...snapshot, configuredProviders }),
    configRecovery: snapshot.configRecovery ?? {
      state: 'ok',
      hasBackup: false,
    },
  }
}

/**
 * 生成适合 Renderer 展示的 Agent profile 状态。
 *
 * @param status - 默认 Agent Home 的 bootstrap 和 profile 文件状态。
 * @returns 适合写入 RuntimeSnapshot 的 profile 状态。
 * @throws 此方法不会主动抛出错误。
 */
export function createAgentProfileStatus(
  status: AgentHomeBootstrapStatus,
): AgentProfileStatus {
  return {
    initialized: status.initialized,
    bootstrapRequired: status.bootstrapRequired,
    soulUpdatedAt: status.soulUpdatedAt,
    userUpdatedAt: status.userUpdatedAt,
  }
}

/**
 * 创建 v1 默认 Agent 的本地会话摘要。
 *
 * @param input - 会话标识、标题和更新时间。
 * @returns 默认归属 `tangyuan` Agent 且处于空闲状态的会话摘要。
 * @throws 此方法不会主动抛出错误。
 */
export function createDefaultSessionSummary(input: {
  sessionId: string
  title: string
  updatedAt: string
}): AgentSessionSummary {
  return {
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId: input.sessionId,
    title: input.title,
    updatedAt: input.updatedAt,
    state: 'idle',
  }
}

/**
 * 将 v1 格式的配置迁移为 v2 内部运行时配置。
 *
 * v1 的单个 providerId/modelId/apiKey 被迁移为：
 * - providers[providerId] = { apiKey, updatedAt: now }
 * - agents.tangyuan = { defaultProviderId: providerId, defaultModelId: modelId, ... }
 *
 * 迁移后 API Key 仍为明文（未加密），需由 Runtime 在下次写入时加密。
 *
 * @param v1 - v1 磁盘配置格式。
 * @param now - 当前时间戳，用于填充 updatedAt 字段。
 * @returns v2 内部运行时配置。
 * @throws 此方法不会主动抛出错误。
 */
export function migrateConfigV1ToV2(
  v1: PersistedConfigurationV1,
  now: string,
): InternalRuntimeConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    providers: {
      [v1.providerId]: {
        apiKey: v1.apiKey,
        updatedAt: now,
      },
    },
    agents: {
      [TANGYUAN_DEFAULT_AGENT_ID]: {
        displayName: '汤圆',
        defaultProviderId: v1.providerId,
        defaultModelId: v1.modelId,
        status: 'active',
        archivedAt: null,
      },
    },
  }
}
