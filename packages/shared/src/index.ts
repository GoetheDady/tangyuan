/**
 * v1 默认 Agent 的稳定标识。
 */
export const TANGYUAN_DEFAULT_AGENT_ID = 'tangyuan'

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
 * 描述消息在 transcript 里的来源。
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
  status: RuntimeStatus
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
 * 桌面端允许 Renderer 通过 Preload API 调用的 IPC channel。
 */
export const DESKTOP_IPC_CHANNELS = {
  runtimeGetSnapshot: 'tangyuan:runtime:get-snapshot',
  runtimeRefresh: 'tangyuan:runtime:refresh',
  sessionsList: 'tangyuan:sessions:list',
  sessionsCreate: 'tangyuan:sessions:create',
} as const

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
  [DESKTOP_IPC_CHANNELS.sessionsList]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: CreateSessionRequest
}

/**
 * 描述每个 IPC channel 对应的响应载荷。
 */
export interface DesktopIpcResponseMap {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsList]: AgentSessionSummary[]
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: AgentSessionSummary
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
}

/**
 * 根据运行时配置生成 Renderer 可直接展示的就绪状态。
 *
 * @param snapshot - 当前运行时资源快照，不包含派生状态。
 * @returns 如果 Provider、模型和 API Key 都存在则返回 `ready`，否则返回 `missing-config`。
 * @throws 此方法不会主动抛出错误。
 */
export function getRuntimeStatus(
  snapshot: RuntimeSnapshotInput,
): RuntimeStatus {
  return snapshot.settings.selectedProviderId &&
    snapshot.settings.selectedModelId &&
    snapshot.auth.apiKey.configured
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
 * @param snapshot - 不包含派生状态的运行时资源数据。
 * @returns 带有 `status` 的完整运行时资源快照。
 * @throws 此方法不会主动抛出错误。
 */
export function createRuntimeSnapshot(
  snapshot: RuntimeSnapshotInput,
): RuntimeSnapshot {
  return {
    ...snapshot,
    auth: {
      ...snapshot.auth,
      state: snapshot.auth.state ?? getRuntimeAuthState(snapshot.auth.apiKey),
    },
    status: getRuntimeStatus(snapshot),
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
