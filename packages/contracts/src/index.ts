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
  'idle' | 'running' | 'completed' | 'cancelled' | 'failed'

/**
 * 描述消息在对话消息列表里的来源。
 */
export type AgentMessageRole = 'user' | 'agent' | 'system'

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
  role: z.enum(['user', 'agent', 'system']),
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
  state: z.enum(['idle', 'running', 'completed', 'cancelled', 'failed']),
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
    state: z.enum(['idle', 'running', 'completed', 'cancelled', 'failed']),
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
  openExternalLink: 'tangyuan:open-external-link',
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
  [DESKTOP_IPC_CHANNELS.openExternalLink]: OpenExternalLinkRequest
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
  [DESKTOP_IPC_CHANNELS.openExternalLink]: openExternalLinkRequestSchema,
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
  [DESKTOP_IPC_CHANNELS.openExternalLink]: void
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
  [DESKTOP_IPC_CHANNELS.openExternalLink]: z.void(),
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
   * 请求 Main 进程校验协议后使用系统浏览器安全打开外部链接。
   *
   * @param request - 待打开的外部 URL。
   * @returns 无返回值；协议不允许或 URL 无效时 Promise 会 reject。
   * @throws 当 URL 协议不是 http/https 时 Promise 会 reject。
   */
  openExternalLink(request: OpenExternalLinkRequest): Promise<void>
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
    state:
      snapshot.auth.state ?? getRuntimeAuthState(derivedApiKey),
    apiKey: derivedApiKey,
  }

  return {
    ...snapshot,
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
