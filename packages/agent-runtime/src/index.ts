import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createTangyuanRuntimeForTesting,
  type TangyuanRuntime,
} from './TangyuanRuntime'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createRuntimeSnapshot,
  migrateConfigV1ToV2,
  persistedConfigurationV2Schema,
  type AgentConfig,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type ConfigEncryptionAdapter,
  type ConfigRecoveryState,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type InternalProviderCredentials,
  type InternalRuntimeConfig,
  type ListSessionsRequest,
  type ModelDescriptor,
  type PersistedConfigurationV1,
  type PersistedConfigurationV2,
  type ProviderAuthSnapshot,
  type ProfileMaintenanceResult,
  type ProviderCredentials,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SkillSummary,
  type SkillOperationParams,
  type SkillInstallRecord,
  type SoulContent,
  type UserProfileContent,
} from '@tangyuan/contracts'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
  buildTranscriptSnapshot,
  applyTranscriptDelta,
  createAgentProfileStatus,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CompactionEntry,
  type ConfigEncryptionAdapter,
  type CreateSessionRequest,
  type ExecutionAttempt,
  type GetSessionMessagesRequest,
  type InternalRuntimeConfig,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SkillSummary,
  type TranscriptDelta,
  type TranscriptEntry,
  type TranscriptSnapshot,
  type UserMessageEntry,
  type AgentReplyEntry,
} from '@tangyuan/contracts'
export { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
export type { TangyuanRuntime } from './TangyuanRuntime'

/**
 * 创建 Electron Main 使用的默认 TangyuanRuntime。
 *
 * @returns 内部使用同一个 Pi SDK Driver 管理资源与会话的运行时实例。
 * @throws 此方法不会主动抛出错误；具体初始化错误会由运行时异步方法返回。
 */
export function createTangyuanRuntime(
  options?: PiSdkDriverOptions,
): TangyuanRuntime {
  // eslint-disable-next-line prefer-const -- assigned after driver/runtime creation
  let gatewayInstance: ToolApprovalGateway | undefined

  const driver = new PiSdkDriver({
    ...options,
    toolApprovalGateway: {
      requestBashApproval: (params) => {
        if (!gatewayInstance) {
          return Promise.resolve({ approved: false })
        }
        return gatewayInstance.requestBashApproval(params)
      },
      validateFilePath: (params) => {
        if (!gatewayInstance) {
          return { allowed: false, reason: '审批网关未初始化。' }
        }
        return gatewayInstance.validateFilePath(params)
      },
    },
  })

  const runtime = createTangyuanRuntimeForTesting({
    runtimeDriver: driver,
    sessionDriver: driver,
  })

  gatewayInstance = runtime.createToolApprovalGateway()

  return runtime
}

/**
 * 描述 Pi SDK 临时配置验证时使用的固定 prompt。
 */
const CONFIGURATION_VERIFICATION_PROMPT = 'Reply with OK.'

/**
 * 默认 Agent profile 注入到 Pi SDK prompt 时使用的分隔标题。
 */
const PROFILE_CONTEXT_HEADER = '汤圆长期上下文'

/**
 * 描述 Pi SDK 验证配置时需要的参数。
 */
export interface PiSdkVerificationRequest extends RuntimeConfiguration {
  prompt: string
  signal: AbortSignal
}

/**
 * 工具审批与文件路径校验网关。
 *
 * 由 TangyuanRuntime 实现，注入到 PiSdkDriver 的自定义工具中，
 * 用于在执行 bash 前创建审批、在校验文件路径时判断是否允许访问。
 */
export interface ToolApprovalGateway {
  /**
   * 请求用户批准一次 Bash 执行。
   *
   * @param params - 审批所需上下文（Agent、session、run、命令、工作目录、风险说明）。
   * @returns 用户批准后 resolve `{ approved: true }`，拒绝后 resolve `{ approved: false }`。
   * @throws 此方法不会主动抛出错误；审批超时或取消通过 approved: false 表示。
   */
  requestBashApproval(params: {
    agentId: string
    sessionId: string
    runId: string
    command: string
    cwd: string
    riskDescription: string
  }): Promise<{ approved: boolean }>

  /**
   * 校验文件路径是否允许当前 Agent 访问。
   *
   * @param params - 校验上下文（Agent、路径、操作类型）。
   * @returns allowed 为 true 表示允许访问；为 false 时 reason 包含拒绝原因。
   * @throws 此方法不会主动抛出错误。
   */
  validateFilePath(params: {
    agentId: string
    path: string
    operation: 'read' | 'write' | 'edit'
  }): { allowed: boolean; reason?: string }
}

/**
 * 描述创建真实 Pi SDK 会话时需要的参数。
 */
export interface PiSdkCreateSessionRequest extends RuntimeConfiguration {
  sessionId: string
  sdkSessionFile: string
  cwd: string
  /** Agent 专属 Skills 目录路径（用于 DefaultResourceLoader）。 */
  agentSkillsPath: string
  /** 共享 Skills 目录路径（用于 DefaultResourceLoader）。 */
  sharedSkillsPath: string
  /** 仅在 tangyuan session 中提供，用于 create_agent 工具回调。 */
  onCreateAgent?: (displayName: string) => Promise<AgentSummary>
  /** 工具审批与路径校验网关（用于 bash 审批和文件路径保护）。 */
  toolApprovalGateway?: ToolApprovalGateway
}

/**
 * 描述打开已有 Pi SDK 会话时需要的参数。
 */
export interface PiSdkOpenSessionRequest extends RuntimeConfiguration {
  sessionId: string
  sdkSessionFile: string
  cwd: string
  /** Agent 专属 Skills 目录路径（用于 DefaultResourceLoader）。 */
  agentSkillsPath: string
  /** 共享 Skills 目录路径（用于 DefaultResourceLoader）。 */
  sharedSkillsPath: string
  /** 工具审批与路径校验网关（用于 bash 审批和文件路径保护）。 */
  toolApprovalGateway?: ToolApprovalGateway
}

/**
 * 描述从 Pi SDK 原生持久化中列出会话时需要的参数。
 */
export interface PiSdkListSessionsRequest {
  cwd: string
  sessionDir: string
}

/**
 * 描述从 Pi SDK 原生持久化中读取消息时需要的参数。
 */
export interface PiSdkReadMessagesRequest {
  sessionId: string
  sdkSessionFile: string
}

/**
 * 描述 Pi SDK 原生 session 列表里的单个会话。
 */
export interface PiSdkStoredSession {
  sessionId: string
  sdkSessionFile: string
  title?: string
  createdAt: string
  updatedAt: string
}

/**
 * 描述 Pi SDK 流式事件归一前的最小事件集合。
 */
export type PiSdkStreamEvent =
  | {
      type: 'text-delta'
      delta: string
    }
  | {
      type: 'thinking-started'
    }
  | {
      type: 'tool-started'
      toolName: string
      toolInput?: unknown
    }
  | {
      type: 'tool-completed'
      toolName: string
    }
  | {
      type: 'tool-failed'
      toolName: string
    }

/**
 * 描述 Pi SDK prompt 调用时可接收的事件回调。
 */
export interface PiSdkPromptOptions {
  /**
   * 接收 Pi SDK 流式事件的回调。
   *
   * @param event - 已归一到最小集合的 Pi SDK 事件。
   * @returns 无返回值。
   * @throws 回调抛出的错误会透传给 prompt 调用方。
   */
  onEvent?(event: PiSdkStreamEvent): void
}

/**
 * 描述 Pi SDK 会话运行器的最小能力。
 */
export interface PiSdkSessionHandle {
  /**
   * Pi SDK 实际写入的原生 session 文件路径。
   *
   * @remarks 测试替身可以省略；真实 SDK 创建会话时会返回带时间戳的文件名。
   */
  sdkSessionFile?: string

  /**
   * 向真实 Pi SDK 会话发送 prompt。
   *
   * @param prompt - 已注入 profile 上下文的用户输入。
   * @param options - 可选流式事件回调。
   * @returns Agent 最后一条文本回复；没有文本回复时返回 null。
   * @throws 当 SDK 调用失败时，Promise 会 reject。
   */
  prompt(prompt: string, options?: PiSdkPromptOptions): Promise<string | null>

  /**
   * 取消当前会话正在运行的 Agent 响应。
   *
   * @returns 无返回值。
   * @throws 当 SDK 无法取消时，Promise 会 reject。
   */
  abort(): Promise<void>

  /**
   * 释放真实 Pi SDK 会话资源。
   *
   * @returns 无返回值。
   * @throws 此方法不应主动抛出错误。
   */
  dispose(): void

  /**
   * 切换当前会话的模型。
   *
   * @param providerId - 目标 Provider 标识。
   * @param modelId - 目标模型标识。
   * @param apiKey - 目标 Provider 的 API Key（跨 Provider 切换时需要）。
   * @returns 无返回值。
   * @throws 当模型不存在或未配置凭据时，Promise 会 reject。
   */
  setModel?(providerId: string, modelId: string, apiKey?: string): Promise<void>

  /**
   * 切换当前会话的 Thinking Level。
   *
   * @param level - 目标 Thinking Level。
   * @returns 无返回值。
   * @throws 当会话不支持 Thinking 时可能会 reject。
   */
  setThinkingLevel?(level: string): Promise<void>

  /**
   * 读取当前会话的模型和 Thinking Level 信息。
   *
   * @returns 当前会话的模型信息。
   * @throws 当会话信息无法读取时，Promise 会 reject。
   */
  getModelInfo?(): Promise<SessionModelInfo>

  /**
   * 重新加载 ResourceLoader（Skill 变更后刷新系统提示词）。
   *
   * @returns 无返回值。
   * @throws 当 reload 失败时，Promise 会 reject。
   */
  reload?(): Promise<void>
}

/**
 * 描述从 Pi SDK ModelRegistry 读取到的资源列表。
 */
export interface PiSdkRuntimeResources {
  providers: ProviderDescriptor[]
  models: ModelDescriptor[]
}

/**
 * 描述 Pi SDK 操作的窄网关，方便产品代码真实调用 SDK，测试代码替换外部网络。
 */
export interface PiSdkGateway {
  /**
   * 读取 SDK ModelRegistry 中可展示的 Provider 和 Model。
   *
   * @returns Provider 和模型描述列表。
   * @throws 当 SDK 资源读取失败时，Promise 会 reject。
   */
  listProvidersAndModels(): Promise<PiSdkRuntimeResources>

  /**
   * 使用临时 session 验证 Provider/API Key/Model。
   *
   * @param request - 验证所需配置、固定 prompt 和取消信号。
   * @returns 无返回值；成功 resolve 表示验证通过。
   * @throws 当 SDK 调用失败、模型不可用或用户取消时，Promise 会 reject。
   */
  verifyConfiguration(request: PiSdkVerificationRequest): Promise<void>

  /**
   * 创建真实 Pi SDK 会话运行器。
   *
   * @param request - 已验证配置、会话标识和 Agent Home 工作目录。
   * @returns 可发送 prompt 和取消运行的会话运行器。
   * @throws 当 SDK 无法创建会话或模型不存在时，Promise 会 reject。
   */
  createSession(request: PiSdkCreateSessionRequest): Promise<PiSdkSessionHandle>

  /**
   * 打开已有 Pi SDK 会话运行器。
   *
   * @param request - 已保存配置、会话标识、SDK session 文件和 Agent Home 工作目录。
   * @returns 可发送 prompt 和取消运行的会话运行器。
   * @throws 当 SDK 无法打开会话或模型不存在时，Promise 会 reject。
   */
  openSession(request: PiSdkOpenSessionRequest): Promise<PiSdkSessionHandle>

  /**
   * 从 Pi SDK 原生持久化中读取会话列表。
   *
   * @param request - Pi SDK session 所属工作目录和 session 目录。
   * @returns SDK 侧能恢复出的会话摘要列表。
   * @throws 当 SDK session 目录无法读取时，Promise 会 reject。
   */
  listSessions(request: PiSdkListSessionsRequest): Promise<PiSdkStoredSession[]>

  /**
   * 从 Pi SDK 原生 session 文件读取 transcript 消息。
   *
   * @param request - 会话标识和 SDK session 文件。
   * @returns 转换成汤圆标准消息结构后的 transcript。
   * @throws 当 SDK session 文件无法读取或解析时，Promise 会 reject。
   */
  readMessages(request: PiSdkReadMessagesRequest): Promise<AgentMessage[]>
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
}

/**
 * 描述汤圆本地会话索引文件结构。
 */
export interface PersistedSessionIndex {
  sessions: PersistedSessionIndexEntry[]
}

/**
 * 描述默认 Agent Home 中 profile/bootstrap 文件的当前状态。
 */
interface AgentHomeStatus {
  initialized: boolean
  bootstrapRequired: boolean
  bootstrapFileExists: boolean
  soulFileExists: boolean
  userFileExists: boolean
  soulUpdatedAt: string | null
  userUpdatedAt: string | null
}

type ProfileMaintenanceTarget = 'soul' | 'user'

interface ProfileMaintenanceFileSnapshot {
  target: ProfileMaintenanceTarget
  path: string
  historyPath: string
  content: string
  historyFiles: Set<string>
}

interface ProfileMaintenanceSnapshot {
  soul: ProfileMaintenanceFileSnapshot
  user: ProfileMaintenanceFileSnapshot
}

/**
 * 创建 AgentRuntimeError 时使用的输入。
 */
export interface AgentRuntimeErrorInput extends AgentRuntimeErrorPayload {
  cause?: unknown
}

/**
 * 定义 Agent 会话 Driver 需要实现的能力。
 */
export interface AgentSessionDriver {
  /**
   * 读取指定 Agent 的会话摘要列表。
   *
   * @param request - 会话列表过滤条件。
   * @returns 会话摘要列表。
   * @throws 当底层 SDK 或持久化层读取失败时，Promise 会 reject。
   */
  listSessions(request: ListSessionsRequest): Promise<AgentSessionSummary[]>

  /**
   * 创建一个新的 Agent 会话。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当底层 SDK 或持久化层无法创建会话时，Promise 会 reject。
   */
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>

  /**
   * 读取指定会话的消息列表。
   *
   * @param request - 会话定位信息。
   * @returns 会话消息列表。
   * @throws 当会话不存在或消息读取失败时，Promise 会 reject。
   */
  getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]>

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和用户消息内容。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  sendMessage(request: SendMessageRequest): Promise<void>

  /**
   * 取消指定会话正在运行的 Agent 响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值，取消结果通过 AgentEvent 推送。
   * @throws 当会话不存在或 SDK 无法取消运行时，Promise 会 reject。
   */
  cancelRun(request: CancelRunRequest): Promise<void>

  /**
   * 创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当目录创建、配置写入或加密失败时，Promise 会 reject。
   */
  createAgent?(displayName: string): Promise<AgentSummary>

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param agentId - Agent 标识。
   * @param patch - 要更新的配置字段。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  updateAgentConfig?(
    agentId: AgentId,
    patch: Partial<Pick<AgentConfig, 'defaultProviderId' | 'defaultModelId'>>,
  ): Promise<AgentSummary>

  /**
   * 归档指定的自定义 Agent。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆或配置保存失败时，Promise 会 reject。
   */
  archiveAgent?(agentId: AgentId): Promise<AgentSummary>

  /**
   * 恢复已归档的 Agent。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  recoverAgent?(agentId: AgentId): Promise<AgentSummary>

  /**
   * 执行目录对账，对照配置与磁盘目录状态。
   *
   * @returns 对账报告，包含更新后的 Agent 列表和未归属目录。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  reconcileAgentDirectories?(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: import('@tangyuan/contracts').UnclaimedDirectory[]
  }>

  /**
   * 认领未归属的 Agent 目录。
   *
   * @param agentId - 目录对应的 agentId。
   * @param displayName - Agent 展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当目录不存在或配置保存失败时，Promise 会 reject。
   */
  claimAgentDirectory?(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary>

  /**
   * 按固定模板重建汤圆目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  rebuildTangyuanHome?(): Promise<AgentSummary>

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  getSessionModelInfo?(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  setSessionModel?(request: SetSessionModelRequest): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  setSessionThinkingLevel?(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo>

  /**
   * 读取指定 Agent 的 soul（身份/角色）内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 Agent 不存在或文件读取失败时，Promise 会 reject。
   */
  getSoul?(agentId: AgentId): Promise<import('@tangyuan/contracts').SoulContent>

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件不存在或读取失败时，Promise 会 reject。
   */
  getUserProfile?(): Promise<import('@tangyuan/contracts').UserProfileContent>

  /**
   * 更新指定 Agent 的 soul（含权限校验和备份验证）。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @param requestedByAgentId - 发起更新请求的 Agent 标识（用于权限校验）。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateSoul?(
    agentId: AgentId,
    content: string,
    requestedByAgentId: AgentId,
  ): Promise<import('@tangyuan/contracts').ProfileMaintenanceResult>

  /**
   * 更新共享 user profile（含备份验证和敏感信息过滤）。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateUserProfile?(
    content: string,
  ): Promise<import('@tangyuan/contracts').ProfileMaintenanceResult>

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表，专属覆盖共享后的最终结果。
   * @throws 当 Skill 目录不存在或解析失败时，Promise 会 reject。
   */
  listAgentSkills?(
    agentId: AgentId,
  ): Promise<import('@tangyuan/contracts').SkillSummary[]>

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当共享 Skill 目录不存在或解析失败时，Promise 会 reject。
   */
  listSharedSkills?(): Promise<import('@tangyuan/contracts').SkillSummary[]>

  /**
   * 重新加载指定 Agent 所有活跃 session 的 ResourceLoader。
   *
   * 用于 Agent 专属 Skill 变更后刷新该 Agent 的会话。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当 reload 失败时，Promise 会 reject。
   */
  reloadAgentSessions?(agentId: AgentId): Promise<void>

  /**
   * 重新加载全部活跃 session 的 ResourceLoader。
   *
   * 用于共享 Skill 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当 reload 失败时，Promise 会 reject。
   */
  reloadAllSessions?(): Promise<void>

  /**
   * 安装或更新 Skill（含 SKILL.md 校验和原子写入）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当校验失败或文件操作失败时，Promise 会 reject。
   */
  installSkill?(
    params: import('@tangyuan/contracts').SkillOperationParams,
  ): Promise<import('@tangyuan/contracts').SkillSummary[]>

  /**
   * 删除 Skill（含备份）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  deleteSkill?(
    params: import('@tangyuan/contracts').SkillOperationParams,
  ): Promise<import('@tangyuan/contracts').SkillSummary[]>

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  getSkillInstallRecords?(): Promise<
    import('@tangyuan/contracts').SkillInstallRecord[]
  >

  /**
   * 订阅 Agent Driver 发出的标准事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription
}

/**
 * 定义运行时资源 Driver 需要实现的能力。
 */
export interface RuntimeResourceDriver {
  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当配置或资源状态无法读取时，Promise 会 reject。
   */
  getSnapshot(): Promise<RuntimeSnapshot>

  /**
   * 刷新 Provider、模型和认证状态。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当底层 Provider 资源刷新失败时，Promise 会 reject。
   */
  refresh(): Promise<RuntimeSnapshot>

  /**
   * 保存并验证运行时配置。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当真实 SDK 验证失败或配置无法保存时，Promise 会 reject。
   */
  saveConfiguration?(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>

  /**
   * 取消正在进行的配置验证。
   *
   * @param request - 需要取消的验证标识；v1 只维护一个当前验证。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当底层 SDK 或运行时无法取消验证时，Promise 会 reject。
   */
  cancelConfigurationVerification?(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>

  /**
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  restoreFromBackup?(): Promise<RuntimeSnapshot>

  /**
   * 删除配置文件和备份（不删除 Agent 数据或 Pi session）。
   *
   * @returns 无返回值。
   * @throws 当文件删除失败时，Promise 会 reject。
   */
  resetConfiguration?(): Promise<void>
}

/**
 * Agent Runtime 统一错误类型。
 */
export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode
  readonly recoverable: boolean

  /**
   * 创建一个可安全序列化的 Runtime 错误。
   *
   * @param input - 错误码、展示消息、可恢复状态和可选原始原因。
   * @returns AgentRuntimeError 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(input: AgentRuntimeErrorInput) {
    super(input.message)
    this.name = 'AgentRuntimeError'
    this.code = input.code
    this.recoverable = input.recoverable
  }

  /**
   * 转换为可传给 Renderer 的安全 JSON。
   *
   * @returns 不包含 cause 和敏感信息的错误载荷。
   * @throws 此方法不会主动抛出错误。
   */
  toJSON(): AgentRuntimeErrorPayload {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    }
  }
}

/**
 * 创建 PiSdkDriver 时可注入的依赖。
 */
export interface PiSdkDriverOptions {
  now?: () => string
  agentHomePath?: string
  fsRoot?: string
  userDataPath?: string
  gateway?: PiSdkGateway
  encryptionAdapter?: ConfigEncryptionAdapter
  /** 工具审批与路径校验网关（用于 bash 审批和文件路径保护）。 */
  toolApprovalGateway?: ToolApprovalGateway
}

/**
 * 读取持久化配置后的结果。
 */
interface ConfigReadResult {
  config: InternalRuntimeConfig | null
  recoveryState: ConfigRecoveryState
  hasBackup: boolean
}

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver implements AgentSessionDriver, RuntimeResourceDriver {
  private readonly now: () => string
  private readonly agentHomePath: string
  private readonly fsRoot: string
  private readonly userDataPath: string
  private readonly gateway: PiSdkGateway
  private readonly encryptionAdapter: ConfigEncryptionAdapter | null
  private readonly listeners = new Set<AgentEventListener>()
  private readonly sessions = new Map<string, AgentSessionSummary>()
  private readonly sessionIndex = new Map<string, PersistedSessionIndexEntry>()
  private readonly messages = new Map<string, AgentMessage[]>()
  private readonly sessionHandles = new Map<string, PiSdkSessionHandle>()
  private readonly activeRunIds = new Map<string, string>()
  private readonly runSequenceBySession = new Map<string, number>()
  private configurationVerificationController: AbortController | null = null
  private toolApprovalGateway: ToolApprovalGateway | undefined

  /**
   * 创建 Pi SDK Driver 骨架。
   *
   * @param options - 时间函数、默认 Agent Home 路径和文件系统根目录等可替换依赖。
   * @returns PiSdkDriver 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(options: PiSdkDriverOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.agentHomePath = options.agentHomePath ?? '~/.tangyuan/agents/tangyuan'
    this.fsRoot = options.fsRoot ?? homedir()
    this.userDataPath = options.userDataPath ?? join(this.fsRoot, '.tangyuan')
    this.gateway = options.gateway ?? new RealPiSdkGateway()
    this.encryptionAdapter = options.encryptionAdapter ?? null
    this.toolApprovalGateway = options.toolApprovalGateway
  }

  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 刷新运行时资源。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async refresh(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 使用真实 Pi SDK 验证 Provider/API Key/Model 后保存配置。
   *
   * @param configuration - 用户输入的模型服务、模型和接口密钥。
   * @returns 保存后的 RuntimeSnapshot，API Key 只包含脱敏展示值。
   * @throws 当配置缺失、SDK 验证失败或写入失败时，Promise 会 reject。
   */
  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    const normalizedConfiguration =
      this.normalizeRuntimeConfiguration(configuration)
    const controller = new AbortController()
    this.configurationVerificationController = controller

    try {
      await this.gateway.verifyConfiguration({
        ...normalizedConfiguration,
        prompt: CONFIGURATION_VERIFICATION_PROMPT,
        signal: controller.signal,
      })
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw new AgentRuntimeError({
          code: 'run-cancelled',
          message: '已取消配置验证。',
          recoverable: true,
        })
      }

      throw new AgentRuntimeError({
        code: 'provider-verification-failed',
        message: `配置验证失败：${sanitizeErrorMessage(error, normalizedConfiguration.apiKey)}`,
        recoverable: true,
      })
    } finally {
      if (this.configurationVerificationController === controller) {
        this.configurationVerificationController = null
      }
    }

    const readResult = await this.readPersistedConfiguration()
    const internalConfig = this.buildInternalConfigForSave(
      readResult.config,
      normalizedConfiguration,
    )
    await this.writePersistedConfiguration(internalConfig)
    return this.readRuntimeSnapshot()
  }

  /**
   * 取消当前配置验证。
   *
   * @param request - 取消请求；v1 只维护一个当前验证，verificationId 用于日志和未来扩展。
   * @returns 当前 RuntimeSnapshot。
   * @throws 当快照读取失败时，Promise 会 reject。
   */
  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    void request
    this.configurationVerificationController?.abort()
    this.configurationVerificationController = null

    return this.readRuntimeSnapshot()
  }

  /**
   * 读取指定 Agent 的会话摘要列表。
   *
   * @param request - 会话列表过滤条件。
   * @returns 该 Agent 下的会话摘要列表。
   * @throws 此骨架实现不会主动抛出错误。
   */
  async listSessions(
    request: ListSessionsRequest,
  ): Promise<AgentSessionSummary[]> {
    await this.loadSessionIndex()

    return [...this.sessions.values()]
      .filter((session) => session.agentId === request.agentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * 创建一个新的真实 Pi SDK 会话摘要。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当配置损坏、Agent 不存在或已归档、运行时配置不完整时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    const readResult = await this.readPersistedConfiguration()

    if (readResult.recoveryState !== 'ok') {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '配置文件已损坏，请先恢复或重置配置。',
        recoverable: true,
      })
    }

    const agentConfig = readResult.config?.agents[request.agentId]

    if (!agentConfig || agentConfig.status === 'archived') {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent「${request.agentId}」不存在或已归档。`,
        recoverable: true,
      })
    }

    const [configuration] = await Promise.all([
      this.readRequiredRuntimeConfiguration(request.agentId),
      this.loadSessionIndex(),
    ])
    const sessionId = this.createNextSessionId()
    const now = this.now()
    const sdkSessionFile = this.resolveSdkSessionFile(sessionId)
    const cwd =
      request.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.resolveAgentHomePath()
        : this.resolveAgentWorkspacePath(request.agentId)
    await mkdir(dirname(sdkSessionFile), { recursive: true })
    const baseRequest = {
      ...configuration,
      sessionId,
      sdkSessionFile,
      cwd,
      agentSkillsPath: this.resolveAgentSkillsPath(request.agentId),
      sharedSkillsPath: this.resolveSharedSkillsPath(),
    }
    const createSessionRequest: PiSdkCreateSessionRequest = this
      .toolApprovalGateway
      ? { ...baseRequest, toolApprovalGateway: this.toolApprovalGateway }
      : baseRequest

    if (request.agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      createSessionRequest.onCreateAgent = async (displayName: string) =>
        this.createAgent(displayName)
    }

    const handle = await this.gateway.createSession(createSessionRequest)
    const persistedSdkSessionFile = handle.sdkSessionFile ?? sdkSessionFile
    const session: AgentSessionSummary = {
      agentId: request.agentId,
      sessionId,
      title: request.title,
      updatedAt: now,
      state: 'idle',
    }
    const indexEntry: PersistedSessionIndexEntry = {
      sessionId,
      sdkSessionFile: persistedSdkSessionFile,
      title: request.title,
      createdAt: now,
      updatedAt: now,
      provider: configuration.providerId,
      model: configuration.modelId,
      agentId: request.agentId,
      lastMessagePreview: '',
      status: 'idle',
    }

    this.sessions.set(session.sessionId, session)
    this.sessionIndex.set(session.sessionId, indexEntry)
    this.messages.set(session.sessionId, [])
    this.sessionHandles.set(session.sessionId, handle)
    await this.writeSessionIndex()
    this.emit({
      type: 'session-created',
      agentId: request.agentId,
      session,
      occurredAt: this.now(),
    })

    return session
  }

  /**
   * 读取指定会话的消息列表。
   *
   * @param request - 会话定位信息。
   * @returns 当前本地 transcript 消息列表。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async getMessages(
    request: GetSessionMessagesRequest,
  ): Promise<AgentMessage[]> {
    await this.ensureSessionLoaded(request.sessionId)
    this.assertKnownSession(request.sessionId, request.agentId)

    const cachedMessages = this.messages.get(request.sessionId)

    if (cachedMessages?.length) {
      return [...cachedMessages]
    }

    await this.ensureSessionHandle(request.sessionId)
    const indexEntry = this.getKnownSessionIndexEntry(request.sessionId)
    const messages = await this.gateway.readMessages({
      sessionId: request.sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
    })
    this.messages.set(request.sessionId, messages)

    return [...messages]
  }

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和消息内容。
   * @returns 无返回值。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<void> {
    await this.ensureSessionLoaded(request.sessionId)
    const session = this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (
      this.activeRunIds.has(request.sessionId) ||
      session.state === 'running'
    ) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }

    if (!handle) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId} 的 Pi SDK 运行器。`,
        recoverable: true,
      })
    }

    const content = request.content.trim()

    if (!content) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '请输入要发送给汤圆的消息。',
        recoverable: true,
      })
    }

    const userMessage = this.appendMessage({
      agentId: request.agentId,
      sessionId: request.sessionId,
      role: 'user',
      content,
    })
    this.emit({
      type: 'message-appended',
      agentId: request.agentId,
      message: userMessage,
      occurredAt: this.now(),
    })
    const runId = this.createRunId(request.sessionId)
    const agentMessage = this.appendMessage({
      agentId: request.agentId,
      sessionId: request.sessionId,
      role: 'agent',
      content: '',
    })
    this.activeRunIds.set(request.sessionId, runId)
    this.updateSessionState(session.sessionId, 'running')
    await this.updateSessionIndexEntry(session.sessionId, {
      lastMessagePreview: this.createMessagePreview(content),
      status: 'running',
      updatedAt: this.now(),
    })
    this.emit({
      type: 'turn-started',
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      occurredAt: this.now(),
    })

    try {
      const profileStatusBeforeRun = await this.ensureDefaultAgentHome()
      const prompt = await this.buildPromptWithProfileContext(
        content,
        request.agentId,
      )
      let accumulatedReply = ''
      const agentReply = await handle.prompt(prompt, {
        onEvent: (event) => {
          if (event.type === 'text-delta') {
            accumulatedReply += event.delta
            this.appendMessageDelta(agentMessage.messageId, event.delta)
            this.emit({
              type: 'message-delta',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              messageId: agentMessage.messageId,
              delta: event.delta,
              occurredAt: this.now(),
            })
            return
          }

          this.emit({
            type: 'activity-updated',
            agentId: request.agentId,
            sessionId: request.sessionId,
            runId,
            activity: mapPiSdkStreamEventToActivity(event),
            occurredAt: this.now(),
          })
        },
      })

      if (this.activeRunIds.get(request.sessionId) !== runId) {
        this.removeMessageIfEmpty(agentMessage.messageId)
        this.updateSessionState(session.sessionId, 'cancelled')
        await this.updateSessionIndexEntry(session.sessionId, {
          status: 'cancelled',
          updatedAt: this.now(),
        })
        return
      }

      if (!accumulatedReply && agentReply?.trim()) {
        accumulatedReply = agentReply.trim()
        this.appendMessageDelta(agentMessage.messageId, accumulatedReply)
        this.emit({
          type: 'message-delta',
          agentId: request.agentId,
          sessionId: request.sessionId,
          runId,
          messageId: agentMessage.messageId,
          delta: accumulatedReply,
          occurredAt: this.now(),
        })
      }

      const completedMessage = this.completeMessage(agentMessage.messageId)
      this.emit({
        type: 'message-completed',
        agentId: request.agentId,
        sessionId: request.sessionId,
        runId,
        message: completedMessage,
        occurredAt: this.now(),
      })
      this.emit({
        type: 'message-appended',
        agentId: request.agentId,
        message: completedMessage,
        occurredAt: this.now(),
      })
      const profileStatusAfterMainReply = await this.emitProfileUpdateEvents(
        profileStatusBeforeRun,
        {
          agentId: request.agentId,
          sessionId: request.sessionId,
        },
      )

      if (profileStatusBeforeRun.initialized) {
        await this.runProfileMaintenanceTurn({
          agentId: request.agentId,
          sessionId: request.sessionId,
          handle,
          userContent: content,
          agentContent: completedMessage.content,
          profileStatus: profileStatusAfterMainReply,
        })
      } else {
        await this.performBootstrapCompletionGating()
      }

      this.updateSessionState(session.sessionId, 'completed')
      await this.updateSessionIndexEntry(session.sessionId, {
        lastMessagePreview: this.createMessagePreview(completedMessage.content),
        status: 'completed',
        updatedAt: this.now(),
      })
    } catch (error) {
      if (isAbortError(error) || !this.activeRunIds.has(request.sessionId)) {
        this.removeMessageIfEmpty(agentMessage.messageId)
        this.updateSessionState(session.sessionId, 'cancelled')
        await this.updateSessionIndexEntry(session.sessionId, {
          status: 'cancelled',
          updatedAt: this.now(),
        })
        this.emit({
          type: 'turn-cancelled',
          agentId: request.agentId,
          sessionId: request.sessionId,
          runId,
          occurredAt: this.now(),
        })
        return
      }

      const runtimeError = {
        code: 'unknown' as const,
        message: sanitizeErrorMessage(error),
        recoverable: true,
      }
      this.removeMessageIfEmpty(agentMessage.messageId)
      this.updateSessionState(session.sessionId, 'failed')
      await this.updateSessionIndexEntry(session.sessionId, {
        lastMessagePreview: this.createMessagePreview(runtimeError.message),
        status: 'failed',
        updatedAt: this.now(),
      })
      this.emit({
        type: 'turn-failed',
        agentId: request.agentId,
        sessionId: request.sessionId,
        runId,
        error: runtimeError,
        occurredAt: this.now(),
      })
      this.emit({
        type: 'runtime-error',
        agentId: request.agentId,
        error: runtimeError,
        occurredAt: this.now(),
      })
      throw error
    } finally {
      if (this.activeRunIds.get(request.sessionId) === runId) {
        this.activeRunIds.delete(request.sessionId)
      }
    }
  }

  /**
   * 取消指定会话正在运行的响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<void> {
    await this.ensureSessionLoaded(request.sessionId)
    this.assertKnownSession(request.sessionId, request.agentId)
    const runId = this.activeRunIds.get(request.sessionId)

    if (runId) {
      this.activeRunIds.delete(request.sessionId)
    }

    await this.sessionHandles.get(request.sessionId)?.abort()
    this.updateSessionState(request.sessionId, 'cancelled')
    await this.updateSessionIndexEntry(request.sessionId, {
      status: 'cancelled',
      updatedAt: this.now(),
    })

    if (runId) {
      this.emit({
        type: 'turn-cancelled',
        agentId: request.agentId,
        sessionId: request.sessionId,
        runId,
        occurredAt: this.now(),
      })
    }
  }

  /**
   * 订阅标准 Agent 事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription {
    this.listeners.add(listener)

    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  /**
   * 读取并初始化默认 Agent Home 的运行时快照。
   *
   * @returns 包含默认 Agent、profile 状态和配置状态的快照。
   * @throws 当文件系统访问失败时，Promise 会 reject。
   */
  private async readRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    const homeStatus = await this.ensureDefaultAgentHome()
    const [readResult, resources] = await Promise.all([
      this.readPersistedConfiguration(),
      this.gateway.listProvidersAndModels(),
    ])

    const runtimeConfig = readResult.config
      ? this.extractAgentRuntimeConfig(
          readResult.config,
          TANGYUAN_DEFAULT_AGENT_ID,
        )
      : null
    const hasBackup = await this.hasBackupFile()

    // 构建按 providerId 索引的凭据配置状态，Renderer 只能读取脱敏值
    const configuredProviders: Record<string, ProviderAuthSnapshot> = {}
    if (readResult.config) {
      for (const [providerId, creds] of Object.entries(
        readResult.config.providers,
      )) {
        configuredProviders[providerId] = {
          configured: true,
          maskedValue: PiSdkDriver.maskApiKey(creds.apiKey),
        }
      }
    }

    return createRuntimeSnapshot({
      activeAgent: {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        homePath: this.agentHomePath,
        profile: createAgentProfileStatus(homeStatus),
      },
      agents: await this.buildAgentSummaries(readResult.config),
      providers: resources.providers,
      models: resources.models,
      settings: {
        selectedProviderId: runtimeConfig?.providerId ?? null,
        selectedModelId: runtimeConfig?.modelId ?? null,
      },
      configuredProviders,
      auth: {
        apiKey: {
          configured: Boolean(runtimeConfig?.apiKey),
          maskedValue: runtimeConfig?.apiKey
            ? PiSdkDriver.maskApiKey(runtimeConfig.apiKey)
            : null,
        },
      },
      configRecovery: {
        state: readResult.recoveryState,
        hasBackup,
      },
    })
  }

  /**
   * 生成适合界面展示的 API Key 脱敏值。
   *
   * @param apiKey - 原始 API Key。
   * @returns 不暴露完整密钥的字符串。
   * @throws 此方法不会主动抛出错误。
   */
  static maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim()

    if (trimmed.length <= 8) {
      return '•'.repeat(trimmed.length)
    }

    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
  }

  /**
   * 从内部配置构建所有 Agent 摘要列表。
   *
   * @param config - 解密后的内部运行时配置；为 null 时只返回默认 tangyuan。
   * @returns Agent 摘要列表，tangyuan 始终排在第一位。
   * @throws 此方法不会主动抛出错误。
   */
  private async buildAgentSummaries(
    config: InternalRuntimeConfig | null,
  ): Promise<AgentSummary[]> {
    const tangyuanHomeExists = await this.pathExists(
      join(this.resolveAgentHomePath(TANGYUAN_DEFAULT_AGENT_ID), 'soul.md'),
    )

    const tangyuanSummary: AgentSummary = {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.displayName ?? '汤圆',
      status: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.status ?? 'active',
      defaultProviderId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultProviderId ?? null,
      defaultModelId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultModelId ?? null,
      homePath: this.agentHomePath,
      archivedAt: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.archivedAt ?? null,
      directoryStatus: tangyuanHomeExists ? 'healthy' : 'damaged',
    }

    if (!config) {
      return [tangyuanSummary]
    }

    const otherAgents = await Promise.all(
      Object.entries(config.agents)
        .filter(([agentId]) => agentId !== TANGYUAN_DEFAULT_AGENT_ID)
        .map(async ([agentId, agentConfig]) => {
          const homePath = this.resolveAgentHomePath(agentId)
          const soulExists = await this.pathExists(join(homePath, 'soul.md'))

          return {
            agentId,
            displayName: agentConfig.displayName,
            status: agentConfig.status,
            defaultProviderId: agentConfig.defaultProviderId,
            defaultModelId: agentConfig.defaultModelId,
            homePath,
            archivedAt: agentConfig.archivedAt,
            directoryStatus: soulExists
              ? ('healthy' as const)
              : ('damaged' as const),
          }
        }),
    )

    return [tangyuanSummary, ...otherAgents]
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当配置读取失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    const readResult = await this.readPersistedConfiguration()
    return await this.buildAgentSummaries(readResult.config)
  }

  /**
   * 原子创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当配置读取、目录创建、文件写入或加密失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    const agentId = crypto.randomUUID()
    const now = this.now()
    const homePath = this.resolveAgentHomePath(agentId)
    const workspacePath = this.resolveAgentWorkspacePath(agentId)

    // 1. 读取当前配置并继承 tangyuan 的 Provider/Model
    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config ?? this.createDefaultInternalConfig()
    const tangyuanConfig = this.extractAgentRuntimeConfig(
      config,
      TANGYUAN_DEFAULT_AGENT_ID,
    )

    // 2. 原子创建目录和初始文件
    await mkdir(homePath, { recursive: true })

    try {
      await Promise.all([
        mkdir(join(homePath, 'soul.history'), { recursive: true }),
        mkdir(join(homePath, 'memory'), { recursive: true }),
        mkdir(join(homePath, 'skills'), { recursive: true }),
        mkdir(workspacePath, { recursive: true }),
      ])

      const soulContent = [
        `# ${displayName}`,
        '',
        `创建时间：${now}`,
        '',
        '## 身份',
        `${displayName}是用户创建的 Agent。`,
        '',
        '## 职责',
        '待用户在对话中定义。',
        '',
        '## 规则',
        '遵循用户指令，在执行危险操作前先确认。',
        '使用中文回复，简洁清晰。',
        '',
      ].join('\n')
      await writeFile(join(homePath, 'soul.md'), soulContent, 'utf8')

      // 3. 更新配置
      config.agents[agentId] = {
        displayName,
        defaultProviderId: tangyuanConfig?.providerId ?? null,
        defaultModelId: tangyuanConfig?.modelId ?? null,
        status: 'active',
        archivedAt: null,
      }
      await this.writePersistedConfiguration(config)

      const summary: AgentSummary = {
        agentId,
        displayName,
        status: 'active',
        defaultProviderId: tangyuanConfig?.providerId ?? null,
        defaultModelId: tangyuanConfig?.modelId ?? null,
        homePath,
        archivedAt: null,
        directoryStatus: 'healthy',
      }

      this.emit({
        type: 'agent-created',
        agentId,
        agent: summary,
        occurredAt: now,
      })

      return summary
    } catch (error) {
      // 失败回滚：清理已创建的目录
      await import('node:fs/promises').then(({ rm }) =>
        rm(homePath, { recursive: true, force: true }),
      )
      throw error
    }
  }

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param agentId - Agent 标识。
   * @param patch - 要更新的配置字段。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async updateAgentConfig(
    agentId: AgentId,
    patch: Partial<Pick<AgentConfig, 'defaultProviderId' | 'defaultModelId'>>,
  ): Promise<AgentSummary> {
    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在或已归档。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]

    if (currentAgent.status !== 'active') {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 已归档，无法修改配置。`,
        recoverable: true,
      })
    }

    const updatedAgent = {
      ...currentAgent,
      ...(patch.defaultProviderId !== undefined
        ? { defaultProviderId: patch.defaultProviderId }
        : {}),
      ...(patch.defaultModelId !== undefined
        ? { defaultModelId: patch.defaultModelId }
        : {}),
    }
    config.agents[agentId] = updatedAgent
    await this.writePersistedConfiguration(config)

    const homePath = this.resolveAgentHomePath(agentId)
    const soulExists = await this.pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-config-updated',
      agentId,
      agent: summary,
      occurredAt: this.now(),
    })

    return summary
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆、不存在或配置保存失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: AgentId): Promise<AgentSummary> {
    if (agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: '默认 Agent「汤圆」不可归档。',
        recoverable: true,
      })
    }

    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]
    const now = this.now()

    const updatedAgent: AgentConfig = {
      ...currentAgent,
      status: 'archived',
      archivedAt: now,
    }
    config.agents[agentId] = updatedAgent
    await this.writePersistedConfiguration(config)

    const homePath = this.resolveAgentHomePath(agentId)
    const soulExists = await this.pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-archived',
      agentId,
      agent: summary,
      occurredAt: now,
    })

    return summary
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: AgentId): Promise<AgentSummary> {
    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]
    const now = this.now()

    const updatedAgent: AgentConfig = {
      ...currentAgent,
      status: 'active',
      archivedAt: null,
    }
    config.agents[agentId] = updatedAgent
    await this.writePersistedConfiguration(config)

    const homePath = this.resolveAgentHomePath(agentId)
    const soulExists = await this.pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-recovered',
      agentId,
      agent: summary,
      occurredAt: now,
    })

    return summary
  }

  /**
   * 执行目录对账：对照配置检查 Agent 目录存在性，扫描发现未归属目录。
   *
   * @returns 对账报告，包含更新后的 Agent 列表和未归属目录。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: import('@tangyuan/contracts').UnclaimedDirectory[]
  }> {
    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config

    const agents = await this.buildAgentSummaries(config)

    // 扫描 agents 目录，发现磁盘上有但配置中没有的目录
    const agentsDir = dirname(
      this.resolveAgentHomePath(TANGYUAN_DEFAULT_AGENT_ID),
    )
    const unclaimedDirectories: import('@tangyuan/contracts').UnclaimedDirectory[] =
      []

    try {
      const entries = await readdir(agentsDir, { withFileTypes: true })
      const configAgentIds = new Set(
        config?.agents ? Object.keys(config.agents) : [],
      )

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const agentId = entry.name

        // 跳过 tangyuan（始终在配置中）
        if (agentId === TANGYUAN_DEFAULT_AGENT_ID) continue
        // 跳过已有配置条的目录
        if (configAgentIds.has(agentId)) continue

        const homePath = this.resolveAgentHomePath(agentId)
        const hasSoul = await this.pathExists(join(homePath, 'soul.md'))

        unclaimedDirectories.push({
          agentId,
          homePath,
          hasSoul,
        })
      }
    } catch {
      // 目录不存在，没有未归属项
    }

    return { agents, unclaimedDirectories }
  }

  /**
   * 认领一个未归属的 Agent 目录，为其创建配置条目。
   *
   * @param agentId - 目录名称（作为 agentId）。
   * @param displayName - Agent 展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当目录不存在或配置保存失败时，Promise 会 reject。
   */
  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    const homePath = this.resolveAgentHomePath(agentId)
    const soulExists = await this.pathExists(join(homePath, 'soul.md'))

    if (!soulExists) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `目录 ${agentId} 不存在或缺少 soul.md，无法认领。`,
        recoverable: true,
      })
    }

    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config ?? this.createDefaultInternalConfig()

    // 继承 tangyuan 的 Provider/Model
    const tangyuanConfig = this.extractAgentRuntimeConfig(
      config,
      TANGYUAN_DEFAULT_AGENT_ID,
    )

    config.agents[agentId] = {
      displayName,
      defaultProviderId: tangyuanConfig?.providerId ?? null,
      defaultModelId: tangyuanConfig?.modelId ?? null,
      status: 'active',
      archivedAt: null,
    }
    await this.writePersistedConfiguration(config)

    const summary: AgentSummary = {
      agentId,
      displayName,
      status: 'active',
      defaultProviderId: tangyuanConfig?.providerId ?? null,
      defaultModelId: tangyuanConfig?.modelId ?? null,
      homePath,
      archivedAt: null,
      directoryStatus: 'healthy',
    }

    return summary
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    const homePath = this.resolveAgentHomePath(TANGYUAN_DEFAULT_AGENT_ID)
    const now = this.now()

    // 确保目录结构存在
    await mkdir(homePath, { recursive: true })
    await Promise.all([
      mkdir(join(homePath, 'soul.history'), { recursive: true }),
      mkdir(join(homePath, 'user.history'), { recursive: true }),
      mkdir(join(homePath, 'memory'), { recursive: true }),
      mkdir(join(homePath, 'skills'), { recursive: true }),
      mkdir(join(homePath, 'workspace'), { recursive: true }),
    ])

    // 写出模板 soul.md
    const soulContent = [
      '# 汤圆',
      '',
      `重建时间：${now}`,
      '',
      '## 身份',
      '汤圆是默认 Agent，负责凭据管理和创建其他 Agent。',
      '',
      '## 职责',
      '- 帮助用户配置模型服务凭据',
      '- 通过对话创建和管理其他 Agent',
      '- 维护共享用户资料',
      '',
      '## 规则',
      '遵循用户指令，在执行危险操作前先确认。',
      '使用中文回复，简洁清晰。',
      '',
    ].join('\n')
    await writeFile(join(homePath, 'soul.md'), soulContent, 'utf8')

    const readResult = await this.readPersistedConfiguration()
    const config = readResult.config

    const summary: AgentSummary = {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.displayName ?? '汤圆',
      status: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.status ?? 'active',
      defaultProviderId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultProviderId ?? null,
      defaultModelId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultModelId ?? null,
      homePath,
      archivedAt: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.archivedAt ?? null,
      directoryStatus: 'healthy',
    }

    return summary
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: AgentId): Promise<SoulContent> {
    const soulPath = this.resolveSoulPath(agentId)

    // 确保 agent home 目录和 soul 文件存在
    await this.ensureAgentHome(agentId)

    const content = await this.safeReadFile(soulPath)
    const updatedAt = (await this.getMtimeIso(soulPath)) ?? this.now()

    return { agentId, content, updatedAt }
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    const userPath = this.resolveUserProfilePath()

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await this.pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    // 确保共享 profile 目录和文件存在
    await mkdir(this.resolveSharedProfilePath(), { recursive: true })
    await mkdir(this.resolveUserHistoryPath(), { recursive: true })

    if (!(await this.pathExists(userPath))) {
      await writeFile(userPath, '', 'utf8')
    }

    const content = await this.safeReadFile(userPath)
    const updatedAt = (await this.getMtimeIso(userPath)) ?? this.now()

    return { content, updatedAt }
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * 使用 Pi Agent DefaultResourceLoader 加载两层目录，
   * Agent 专属目录排在共享目录前以实现同名覆盖。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表，专属覆盖共享后的最终结果。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: AgentId): Promise<SkillSummary[]> {
    const agentSkillsPath = this.resolveAgentSkillsPath(agentId)
    const sharedSkillsPath = this.resolveSharedSkillsPath()

    // 确保目录存在
    await mkdir(agentSkillsPath, { recursive: true })
    await mkdir(sharedSkillsPath, { recursive: true })

    const { DefaultResourceLoader } =
      await import('@earendil-works/pi-coding-agent')

    const loader = new DefaultResourceLoader({
      cwd: this.resolveAgentWorkspacePath(agentId),
      agentDir: this.resolveAgentHomePath(agentId),
      noSkills: true,
      additionalSkillPaths: [agentSkillsPath, sharedSkillsPath],
    })

    await loader.reload()

    const { skills, diagnostics } = loader.getSkills()

    return this.mapSkillsToSummaries(skills, diagnostics)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    const sharedSkillsPath = this.resolveSharedSkillsPath()

    await mkdir(sharedSkillsPath, { recursive: true })

    const { DefaultResourceLoader } =
      await import('@earendil-works/pi-coding-agent')

    const loader = new DefaultResourceLoader({
      cwd: this.resolveAgentWorkspacePath(TANGYUAN_DEFAULT_AGENT_ID),
      agentDir: this.resolveAgentHomePath(),
      noSkills: true,
      additionalSkillPaths: [sharedSkillsPath],
    })

    await loader.reload()

    const { skills, diagnostics } = loader.getSkills()

    return this.mapSkillsToSummaries(skills, diagnostics)
  }

  /**
   * 将 Pi SDK Skill 和诊断信息映射为汤圆的 SkillSummary 列表。
   *
   * @param skills - Pi SDK 解析出的 Skill 列表（已按 first-wins 排序）。
   * @param diagnostics - Pi SDK 的加载诊断信息（包含冲突）。
   * @returns 带有来源和冲突标注的 SkillSummary 列表。
   * @throws 此方法不会主动抛出错误。
   */
  private mapSkillsToSummaries(
    skills: Array<{
      name: string
      description: string
      filePath: string
      baseDir: string
      sourceInfo?: { path: string; source: string }
      disableModelInvocation?: boolean
    }>,
    diagnostics: Array<{
      type: string
      message: string
      path?: string
      collision?: {
        resourceType: string
        name: string
        winnerPath: string
        loserPath: string
      }
    }>,
  ): SkillSummary[] {
    const agentSkillsPath = this.resolveAgentSkillsPath(
      TANGYUAN_DEFAULT_AGENT_ID,
    )
    const sharedSkillsPath = this.resolveSharedSkillsPath()

    // 从 diagnostics 中提取冲突信息（按 loserPath 索引）
    const collisionsByLoserPath = new Map<
      string,
      { overriddenPath: string; overriddenSource: 'shared' | 'agent' }
    >()
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.type === 'collision' &&
        diagnostic.collision?.resourceType === 'skill'
      ) {
        const loserSource = diagnostic.collision.loserPath.startsWith(
          agentSkillsPath.replace(TANGYUAN_DEFAULT_AGENT_ID, ''),
        )
          ? 'agent'
          : diagnostic.collision.loserPath.startsWith(sharedSkillsPath)
            ? 'shared'
            : 'agent'
        collisionsByLoserPath.set(diagnostic.collision.loserPath, {
          overriddenPath: diagnostic.collision.winnerPath,
          overriddenSource: loserSource,
        })
      }
    }

    return skills.map((skill) => {
      const source: 'shared' | 'agent' = skill.filePath.startsWith(
        agentSkillsPath.replace(TANGYUAN_DEFAULT_AGENT_ID, ''),
      )
        ? 'agent'
        : skill.filePath.startsWith(sharedSkillsPath)
          ? 'shared'
          : 'agent'

      const conflict = collisionsByLoserPath.get(skill.filePath)

      const summary: SkillSummary = {
        name: skill.name,
        description: skill.description ?? '',
        source,
        path: skill.filePath,
        hasScripts: false, // Pi SDK Skill 类型不直接暴露此信息，MVP 默认 false
      }

      if (conflict) {
        summary.conflict = {
          overriddenPath: conflict.overriddenPath,
          overriddenSource: conflict.overriddenSource,
        }
      }

      return summary
    })
  }

  /**
   * 重新加载指定 Agent 所有活跃 session 的 ResourceLoader。
   *
   * 用于 Agent 专属 Skill 变更后刷新该 Agent 的会话。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAgentSessions(agentId: string): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [sessionId, handle] of this.sessionHandles) {
      const indexEntry = this.sessionIndex.get(sessionId)
      if (indexEntry?.agentId === agentId && handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 重新加载全部活跃 session 的 ResourceLoader。
   *
   * 用于共享 Skill 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAllSessions(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const handle of this.sessionHandles.values()) {
      if (handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 安装或更新 Skill（含 SKILL.md 校验和原子写入）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当校验失败或文件操作失败时，Promise 会 reject。
   */
  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    const sourceDir = params.skillDirPath
    if (!sourceDir) {
      throw new Error('安装 Skill 需要提供 skillDirPath。')
    }

    // 校验源目录
    await this.validateSkillDirectory(sourceDir, params.skillName)

    const targetDir = this.resolveSkillTargetDir(
      params.source,
      params.targetAgentId,
    )

    // 确保目标目录存在
    await mkdir(targetDir, { recursive: true })

    const skillTargetDir = join(targetDir, params.skillName)

    // 使用安全临时目录进行原子替换
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')

    const tempRoot = join(tmpdir(), 'tangyuan-skill-')
    const tempDir = await mkdtemp(tempRoot)
    const tempSkillDir = join(tempDir, params.skillName)

    try {
      // 复制源内容到临时目录
      await this.copyDirectoryContents(sourceDir, tempSkillDir)

      // 原子 rename 到目标位置
      // 如果已存在旧版本，先移除
      try {
        await rename(
          skillTargetDir,
          join(
            targetDir,
            `.tangyuan-trash`,
            `${params.skillName}-${this.now().replace(/:/g, '-')}`,
          ),
        )
      } catch {
        // 目录不存在则忽略
      }

      // 确保 trash 目录存在
      await mkdir(join(targetDir, '.tangyuan-trash'), { recursive: true })

      await rename(tempSkillDir, skillTargetDir)
    } catch (error) {
      // 清理临时目录
      try {
        await import('node:fs/promises').then((fs) =>
          fs.rm(tempDir, { recursive: true, force: true }),
        )
      } catch {
        // 清理失败忽略
      }
      throw error
    }

    // 更新安装记录
    await this.recordSkillInstall(params)

    // 返回更新后的列表
    if (params.source === 'shared') {
      return this.listSharedSkills()
    }
    return this.listAgentSkills(params.targetAgentId ?? params.agentId)
  }

  /**
   * 删除 Skill（含备份到 trash）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    const targetDir = this.resolveSkillTargetDir(
      params.source,
      params.targetAgentId,
    )
    const skillDir = join(targetDir, params.skillName)

    // 检查目录是否存在
    try {
      await stat(skillDir)
    } catch {
      throw new Error(`Skill "${params.skillName}" 不存在于 ${targetDir}`)
    }

    // 移动到 trash 目录（保留可恢复信息）
    const trashDir = join(targetDir, '.tangyuan-trash')
    await mkdir(trashDir, { recursive: true })

    const trashName = `${params.skillName}-${this.now().replace(/:/g, '-')}`
    const trashPath = join(trashDir, trashName)

    await rename(skillDir, trashPath)

    // 更新安装记录
    await this.markSkillDeleted(params)

    // 返回更新后的列表
    if (params.source === 'shared') {
      return this.listSharedSkills()
    }
    return this.listAgentSkills(params.targetAgentId ?? params.agentId)
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    const allRecords: SkillInstallRecord[] = []

    // 读取共享 Skill 记录
    allRecords.push(...(await this.readInstallRecords('shared')))

    // 读取所有 Agent 的专属 Skill 记录
    const agentsDir = join(dirname(this.resolveAgentHomePath()))
    try {
      const agentDirs = await readdir(agentsDir)
      for (const agentId of agentDirs) {
        const agentRecords = await this.readInstallRecords('agent', agentId)
        allRecords.push(...agentRecords)
      }
    } catch {
      // agents 目录不存在时忽略
    }

    return allRecords
  }

  /**
   * 解析 Skill 安装的目标目录。
   *
   * @param source - 共享或专属。
   * @param agentId - 专属时的 Agent 标识。
   * @returns 目标目录绝对路径。
   */
  private resolveSkillTargetDir(
    source: 'shared' | 'agent',
    agentId?: string,
  ): string {
    if (source === 'shared') {
      return this.resolveSharedSkillsPath()
    }

    if (!agentId) {
      throw new Error('专属 Skill 操作需要提供 agentId。')
    }

    return this.resolveAgentSkillsPath(agentId)
  }

  /**
   * 校验 Skill 源目录是否包含合法的 SKILL.md。
   *
   * @param dirPath - 源目录路径。
   * @param expectedName - 期望的 Skill 名称。
   * @returns 无返回值。
   * @throws 当 SKILL.md 缺失或缺少 description 时抛出错误。
   */
  private async validateSkillDirectory(
    dirPath: string,
    expectedName: string,
  ): Promise<void> {
    const skillMdPath = join(dirPath, 'SKILL.md')

    try {
      await access(skillMdPath, fsConstants.R_OK)
    } catch {
      throw new Error(`Skill 目录缺少 SKILL.md 文件：${skillMdPath}`)
    }

    const content = await readFile(skillMdPath, 'utf8')

    // 校验 description 字段存在（v3 frontmatter 格式）
    const descriptionMatch = content.match(/^description:\s*(.+)$/m)
    if (!descriptionMatch || !descriptionMatch[1]?.trim()) {
      throw new Error(
        `Skill "${expectedName}" 的 SKILL.md 缺少 description 字段，拒绝安装。`,
      )
    }
  }

  /**
   * 递归复制目录内容。
   *
   * @param sourceDir - 源目录。
   * @param destDir - 目标目录。
   * @returns 无返回值。
   * @throws 当复制失败时，Promise 会 reject。
   */
  private async copyDirectoryContents(
    sourceDir: string,
    destDir: string,
  ): Promise<void> {
    await mkdir(destDir, { recursive: true })

    const entries = await readdir(sourceDir, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = join(sourceDir, entry.name)
      const destPath = join(destDir, entry.name)

      if (entry.isDirectory()) {
        await this.copyDirectoryContents(srcPath, destPath)
      } else {
        await copyFile(srcPath, destPath)
      }
    }
  }

  /**
   * 读取指定来源的 Skill 安装记录。
   *
   * @param source - 共享或专属。
   * @param agentId - 专属时的 Agent 标识。
   * @returns 安装记录列表。
   */
  private async readInstallRecords(
    source: 'shared' | 'agent',
    agentId?: string,
  ): Promise<SkillInstallRecord[]> {
    const recordsPath = this.resolveInstallRecordsPath(source, agentId)

    try {
      const content = await readFile(recordsPath, 'utf8')
      const data = JSON.parse(content)

      if (data && Array.isArray(data.skills)) {
        return data.skills as SkillInstallRecord[]
      }

      return []
    } catch {
      return []
    }
  }

  /**
   * 写入 Skill 安装记录（追加或更新）。
   *
   * @param params - Skill 操作参数。
   * @returns 无返回值。
   * @throws 当写入失败时，Promise 会 reject。
   */
  private async recordSkillInstall(
    params: SkillOperationParams,
  ): Promise<void> {
    const recordsPath = this.resolveInstallRecordsPath(
      params.source,
      params.targetAgentId,
    )
    const existing = await this.readInstallRecords(
      params.source,
      params.targetAgentId,
    )

    const now = this.now()
    const existingIndex = existing.findIndex(
      (record) => record.skillName === params.skillName,
    )

    const record: SkillInstallRecord = {
      skillName: params.skillName,
      source: params.source,
      ...(params.targetAgentId !== undefined
        ? { targetAgentId: params.targetAgentId }
        : {}),
      installedAt:
        existingIndex >= 0
          ? (existing[existingIndex] as SkillInstallRecord).installedAt
          : now,
      updatedAt: now,
      status: 'active',
    }

    if (existingIndex >= 0) {
      existing[existingIndex] = record
    } else {
      existing.push(record)
    }

    await mkdir(dirname(recordsPath), { recursive: true })
    await writeFile(
      recordsPath,
      JSON.stringify({ skills: existing }, null, 2),
      'utf8',
    )
  }

  /**
   * 标记 Skill 为已删除。
   *
   * @param params - Skill 操作参数。
   * @returns 无返回值。
   * @throws 当写入失败时，Promise 会 reject。
   */
  private async markSkillDeleted(params: SkillOperationParams): Promise<void> {
    const recordsPath = this.resolveInstallRecordsPath(
      params.source,
      params.targetAgentId,
    )
    const existing = await this.readInstallRecords(
      params.source,
      params.targetAgentId,
    )

    const existingIndex = existing.findIndex(
      (record) => record.skillName === params.skillName,
    )

    if (existingIndex >= 0) {
      const current = existing[existingIndex] as SkillInstallRecord
      existing[existingIndex] = {
        skillName: current.skillName,
        source: current.source,
        ...(current.targetAgentId !== undefined
          ? { targetAgentId: current.targetAgentId }
          : {}),
        installedAt: current.installedAt,
        updatedAt: this.now(),
        status: 'deleted',
      }
    } else {
      existing.push({
        skillName: params.skillName,
        source: params.source,
        ...(params.targetAgentId !== undefined
          ? { targetAgentId: params.targetAgentId }
          : {}),
        installedAt: this.now(),
        updatedAt: this.now(),
        status: 'deleted',
      } as SkillInstallRecord)
    }

    await mkdir(dirname(recordsPath), { recursive: true })
    await writeFile(
      recordsPath,
      JSON.stringify({ skills: existing }, null, 2),
      'utf8',
    )
  }

  /**
   * 解析 Skill 安装记录文件路径。
   *
   * @param source - 共享或专属。
   * @param agentId - 专属时的 Agent 标识。
   * @returns 记录文件绝对路径。
   */
  private resolveInstallRecordsPath(
    source: 'shared' | 'agent',
    agentId?: string,
  ): string {
    if (source === 'shared') {
      return join(this.resolveSharedSkillsPath(), '.tangyuan-records.json')
    }

    if (!agentId) {
      throw new Error('Agent 专属 Skill 记录需要提供 agentId。')
    }

    return join(this.resolveAgentSkillsPath(agentId), '.tangyuan-records.json')
  }

  /**
   * 更新指定 Agent 的 soul（含权限校验和备份验证）。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @param requestedByAgentId - 发起更新请求的 Agent 标识。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async updateSoul(
    agentId: AgentId,
    content: string,
    requestedByAgentId: AgentId,
  ): Promise<ProfileMaintenanceResult> {
    // 权限校验：Agent 只能更新自己的 soul
    // 汤圆可以在创建时写入其他 Agent 的初始 soul（由 createAgent 调用）
    if (
      agentId !== requestedByAgentId &&
      requestedByAgentId !== TANGYUAN_DEFAULT_AGENT_ID
    ) {
      return {
        target: 'soul',
        success: false,
        reason: `Agent "${requestedByAgentId}" 无权修改 Agent "${agentId}" 的 soul。只有 Agent 自身或汤圆可以修改。`,
      }
    }

    const soulPath = this.resolveSoulPath(agentId)
    const historyPath = this.resolveSoulHistoryPath(agentId)

    // 确保目录存在
    await this.ensureAgentHome(agentId)

    // 读取更新前内容
    const previousContent = (await this.pathExists(soulPath))
      ? await this.safeReadFile(soulPath)
      : ''
    const previousHistoryFiles = await this.readDirectoryFileSet(historyPath)

    // 如果内容没变，跳过
    if (previousContent === content) {
      return { target: 'soul', success: true }
    }

    // 检查是否已备份：非空内容需要至少一个备份文件
    const hasBackup = previousContent === '' || previousHistoryFiles.size > 0

    if (!hasBackup) {
      return {
        target: 'soul',
        success: false,
        reason: `更新 soul 失败：缺少更新前备份，请先将旧内容备份到 soul.history/ 目录。`,
      }
    }

    // 敏感信息过滤
    const readResult = await this.readPersistedConfiguration()
    const runtimeConfig = readResult.config
      ? this.extractAgentRuntimeConfig(readResult.config, agentId)
      : null
    const redactedContent = this.redactSensitiveProfileContent(
      content,
      runtimeConfig?.apiKey ?? null,
    )

    // 写入
    await writeFile(soulPath, redactedContent, 'utf8')

    // 广播事件
    const updatedAt = (await this.getMtimeIso(soulPath)) ?? this.now()
    this.emitProfileUpdated('soul', updatedAt)

    return { target: 'soul', success: true }
  }

  /**
   * 更新共享 user profile（含备份验证和敏感信息过滤）。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileMaintenanceResult> {
    const userPath = this.resolveUserProfilePath()
    const historyPath = this.resolveUserHistoryPath()

    // 确保目录存在
    await mkdir(this.resolveSharedProfilePath(), { recursive: true })
    await mkdir(historyPath, { recursive: true })

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await this.pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    // 读取更新前内容
    const previousContent = (await this.pathExists(userPath))
      ? await this.safeReadFile(userPath)
      : ''
    const previousHistoryFiles = await this.readDirectoryFileSet(historyPath)

    // 如果内容没变，跳过
    if (previousContent === content) {
      return { target: 'user', success: true }
    }

    // 检查是否已备份：非空内容需要至少一个备份文件
    const hasBackup = previousContent === '' || previousHistoryFiles.size > 0

    if (!hasBackup) {
      return {
        target: 'user',
        success: false,
        reason: `更新 user profile 失败：缺少更新前备份，请先将旧内容备份到 user.history/ 目录。`,
      }
    }

    // 敏感信息过滤
    const readResult = await this.readPersistedConfiguration()
    const runtimeConfig = readResult.config
      ? this.extractAgentRuntimeConfig(
          readResult.config,
          TANGYUAN_DEFAULT_AGENT_ID,
        )
      : null
    const redactedContent = this.redactSensitiveProfileContent(
      content,
      runtimeConfig?.apiKey ?? null,
    )

    // 写入
    await writeFile(userPath, redactedContent, 'utf8')

    // 广播事件
    const updatedAt = (await this.getMtimeIso(userPath)) ?? this.now()
    this.emitProfileUpdated('user', updatedAt)

    return { target: 'user', success: true }
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setModel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换模型。',
        recoverable: true,
      })
    }

    // 读取目标 Provider 的 API Key 用于跨 Provider 切换
    const indexEntry = this.getKnownSessionIndexEntry(request.sessionId)
    const configuration = await this.readRequiredRuntimeConfiguration(
      indexEntry.agentId,
    )
    const targetApiKey =
      request.providerId !== configuration.providerId
        ? await this.readProviderApiKey(request.providerId)
        : undefined

    await handle.setModel(request.providerId, request.modelId, targetApiKey)
    await this.updateSessionIndexEntry(request.sessionId, {
      provider: request.providerId,
      model: request.modelId,
    })

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setThinkingLevel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换 Thinking Level。',
        recoverable: true,
      })
    }

    await handle.setThinkingLevel(request.level)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 校验并清理用户输入的运行时配置。
   *
   * @param configuration - 用户输入的配置。
   * @returns 去除首尾空白后的 RuntimeConfiguration。
   * @throws 当 Provider、Model 或 API Key 为空时抛出 AgentRuntimeError。
   */
  private normalizeRuntimeConfiguration(
    configuration: RuntimeConfiguration,
  ): RuntimeConfiguration {
    const normalizedConfiguration = {
      providerId: configuration.providerId.trim(),
      modelId: configuration.modelId.trim(),
      apiKey: configuration.apiKey.trim(),
    }

    if (
      !normalizedConfiguration.providerId ||
      !normalizedConfiguration.modelId ||
      !normalizedConfiguration.apiKey
    ) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message:
          '请填写 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    return normalizedConfiguration
  }

  /**
   * 从磁盘读取配置 JSON，检测版本、执行迁移、解密 API Key。
   *
   * @returns 解密后的内部配置与恢复状态。
   * @throws 当文件系统读取失败时，Promise 会 reject。
   */
  private async readPersistedConfiguration(): Promise<ConfigReadResult> {
    const configPath = this.resolveConfigPath()

    try {
      const rawConfig = await readFile(configPath, 'utf8')
      const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>

      // 检测是否为 v1 格式（无 schemaVersion）
      if (typeof parsedConfig.schemaVersion !== 'number') {
        return this.migrateAndReadConfig(
          parsedConfig as unknown as PersistedConfigurationV1,
        )
      }

      // v2 格式：校验 schema
      const parseResult = persistedConfigurationV2Schema.safeParse(parsedConfig)
      if (!parseResult.success) {
        return {
          config: null,
          recoveryState: 'corrupted',
          hasBackup: await this.hasBackupFile(),
        }
      }

      // 解密
      let config: InternalRuntimeConfig
      try {
        config = await this.decryptConfigFromDisk(parseResult.data)
      } catch {
        return {
          config: null,
          recoveryState: 'corrupted',
          hasBackup: await this.hasBackupFile(),
        }
      }

      return {
        config,
        recoveryState: 'ok',
        hasBackup: await this.hasBackupFile(),
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return {
          config: this.createDefaultInternalConfig(),
          recoveryState: 'ok',
          hasBackup: false,
        }
      }

      return {
        config: null,
        recoveryState: 'corrupted',
        hasBackup: await this.hasBackupFile(),
      }
    }
  }

  /**
   * 迁移 v1 配置到 v2 并写回磁盘。
   *
   * @param v1 - 解析后的 v1 磁盘配置。
   * @returns 迁移后的内部配置。
   * @throws 当迁移后写入失败时，Promise 会 reject。
   */
  private async migrateAndReadConfig(
    v1: PersistedConfigurationV1,
  ): Promise<ConfigReadResult> {
    try {
      const internalConfig = migrateConfigV1ToV2(v1, this.now())
      await this.writePersistedConfiguration(internalConfig)
      return {
        config: internalConfig,
        recoveryState: 'ok',
        hasBackup: false,
      }
    } catch {
      return {
        config: null,
        recoveryState: 'migration-failed',
        hasBackup: await this.hasBackupFile(),
      }
    }
  }

  /**
   * 读取已保存且可用于真实会话的运行时配置。
   *
   * @returns 解密后的 Provider、模型和 API Key。
   * @throws 当配置不存在或完整性问题时抛出 AgentRuntimeError。
   */
  private async readRequiredRuntimeConfiguration(
    agentId: string = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<RuntimeConfiguration> {
    const readResult = await this.readPersistedConfiguration()

    if (readResult.recoveryState !== 'ok') {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '配置文件已损坏，请先恢复或重置配置。',
        recoverable: true,
      })
    }

    if (!readResult.config) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message:
          '创建会话前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    const runtimeConfig = this.extractAgentRuntimeConfig(
      readResult.config,
      agentId,
    )

    if (!runtimeConfig) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: `Agent「${agentId}」尚未配置 Provider 和 Model，请先在控制台中为该 Agent 设置默认模型。`,
        recoverable: true,
      })
    }

    return runtimeConfig
  }

  /**
   * 写入加密后的 v2 配置 JSON，包含备份和原子替换。
   *
   * @param config - 解密后的内部运行时配置。
   * @returns 无返回值。
   * @throws 当加密、备份或写入失败时，Promise 会 reject。
   */
  private async writePersistedConfiguration(
    config: InternalRuntimeConfig,
  ): Promise<void> {
    const configPath = this.resolveConfigPath()
    const backupPath = this.resolveConfigBackupPath()
    const tmpPath = `${configPath}.tmp`

    await mkdir(dirname(configPath), { recursive: true })

    // 加密
    const persisted = await this.encryptConfigForDisk(config)
    const serialized = `${JSON.stringify(persisted, null, 2)}\n`

    // 备份当前配置
    try {
      await import('node:fs/promises').then(({ copyFile }) =>
        copyFile(configPath, backupPath),
      )
    } catch {
      // 当前配置文件不存在则不备份
    }

    // 原子写入
    await writeFile(tmpPath, serialized, 'utf8')
    await rename(tmpPath, configPath)
  }

  /**
   * 解析配置 JSON 的绝对路径。
   *
   * @returns Electron userData 下的 config.json 路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveConfigPath(): string {
    return join(this.userDataPath, 'config.json')
  }

  /**
   * 解析配置备份 JSON 的绝对路径。
   *
   * @returns Electron userData 下的 config.backup.json 路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveConfigBackupPath(): string {
    return join(this.userDataPath, 'config.backup.json')
  }

  /**
   * 检查配置备份文件是否存在。
   *
   * @returns 备份文件存在返回 true。
   * @throws 此方法不会主动抛出错误。
   */
  private async hasBackupFile(): Promise<boolean> {
    try {
      await access(this.resolveConfigBackupPath(), fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * 创建默认的内部运行时配置（无 provider 凭据）。
   *
   * @returns 包含默认 tangyuan Agent 的空配置。
   * @throws 此方法不会主动抛出错误。
   */
  private createDefaultInternalConfig(): InternalRuntimeConfig {
    return {
      schemaVersion: 2,
      providers: {},
      agents: {
        [TANGYUAN_DEFAULT_AGENT_ID]: {
          displayName: '汤圆',
          defaultProviderId: null,
          defaultModelId: null,
          status: 'active',
          archivedAt: null,
        },
      },
    }
  }

  /**
   * 将用户输入的 RuntimeConfiguration 合并到现有内部配置中。
   *
   * @param existing - 现有的内部配置；为 null 则创建默认配置。
   * @param runtimeConfig - 用户输入的新配置。
   * @returns 合并后的内部运行时配置。
   * @throws 此方法不会主动抛出错误。
   */
  private buildInternalConfigForSave(
    existing: InternalRuntimeConfig | null,
    runtimeConfig: RuntimeConfiguration,
  ): InternalRuntimeConfig {
    const config = existing ?? this.createDefaultInternalConfig()
    const now = this.now()

    config.providers[runtimeConfig.providerId] = {
      apiKey: runtimeConfig.apiKey,
      updatedAt: now,
    }

    const agent = config.agents[TANGYUAN_DEFAULT_AGENT_ID]
    if (agent) {
      agent.defaultProviderId = runtimeConfig.providerId
      agent.defaultModelId = runtimeConfig.modelId
    }

    config.schemaVersion = 2
    return config
  }

  /**
   * 从内部配置中提取指定 Agent 当前可用的 RuntimeConfiguration。
   *
   * @param config - 解密后的内部运行时配置。
   * @param agentId - 需要查询的 Agent 标识。
   * @returns 可传给 Pi SDK 的运行时配置；Agent 未配置完整时返回 null。
   * @throws 此方法不会主动抛出错误。
   */
  private extractAgentRuntimeConfig(
    config: InternalRuntimeConfig,
    agentId: string,
  ): RuntimeConfiguration | null {
    const agent = config.agents[agentId]
    if (!agent?.defaultProviderId || !agent?.defaultModelId) return null
    const provider = config.providers[agent.defaultProviderId]
    if (!provider) return null
    return {
      providerId: agent.defaultProviderId,
      modelId: agent.defaultModelId,
      apiKey: provider.apiKey,
    }
  }

  /**
   * 从持久化配置中读取指定 Provider 的 API Key。
   *
   * @param providerId - Provider 标识。
   * @returns 明文 API Key；Provider 未配置凭据时返回 undefined。
   * @throws 当配置文件读取或解密失败时，Promise 会 reject。
   */
  private async readProviderApiKey(
    providerId: string,
  ): Promise<string | undefined> {
    const readResult = await this.readPersistedConfiguration()
    const provider = readResult.config?.providers[providerId]
    return provider?.apiKey
  }

  /**
   * 将解密后的内部配置加密为磁盘格式。
   *
   * @param config - 解密后的内部运行时配置。
   * @returns v2 磁盘配置格式。
   * @throws 当加密不可用时抛出 AgentRuntimeError。
   */
  private async encryptConfigForDisk(
    config: InternalRuntimeConfig,
  ): Promise<PersistedConfigurationV2> {
    const adapter = this.requireEncryptionAdapter()
    const providers: Record<string, ProviderCredentials> = {}
    for (const [providerId, creds] of Object.entries(config.providers)) {
      providers[providerId] = {
        encryptedApiKey: await adapter.encrypt(creds.apiKey),
        updatedAt: creds.updatedAt,
      }
    }
    return {
      schemaVersion: 2,
      providers,
      agents: config.agents,
    }
  }

  /**
   * 将 v2 磁盘格式配置解密为内部运行时配置。
   *
   * @param persisted - 从磁盘读取的 v2 配置。
   * @returns 解密后的内部运行时配置。
   * @throws 当解密失败或加密不可用时抛出 AgentRuntimeError。
   */
  private async decryptConfigFromDisk(
    persisted: PersistedConfigurationV2,
  ): Promise<InternalRuntimeConfig> {
    const adapter = this.requireEncryptionAdapter()
    const providers: Record<string, InternalProviderCredentials> = {}
    for (const [providerId, creds] of Object.entries(persisted.providers)) {
      try {
        providers[providerId] = {
          apiKey: await adapter.decrypt(creds.encryptedApiKey),
          updatedAt: creds.updatedAt,
        }
      } catch {
        throw new AgentRuntimeError({
          code: 'configuration-missing',
          message: '无法解密配置凭据，操作系统加密服务可能已变更。',
          recoverable: true,
        })
      }
    }
    return {
      schemaVersion: persisted.schemaVersion,
      providers,
      agents: persisted.agents,
    }
  }

  /**
   * 检查加密适配器是否可用，不可用时抛出错误。
   *
   * @returns 可用的加密适配器。
   * @throws 当加密适配器未注入或不可用时抛出 AgentRuntimeError。
   */
  private requireEncryptionAdapter(): ConfigEncryptionAdapter {
    if (!this.encryptionAdapter || !this.encryptionAdapter.isAvailable()) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '加密服务不可用，无法保存或读取配置。',
        recoverable: false,
      })
    }
    return this.encryptionAdapter
  }

  /**
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    const backupPath = this.resolveConfigBackupPath()
    const configPath = this.resolveConfigPath()

    try {
      await access(backupPath, fsConstants.F_OK)
    } catch {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '没有可用的配置备份。',
        recoverable: true,
      })
    }

    // 校验备份文件格式
    const rawBackup = await readFile(backupPath, 'utf8')
    let parsedBackup: unknown
    try {
      parsedBackup = JSON.parse(rawBackup)
    } catch {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '备份文件已损坏，无法恢复。',
        recoverable: true,
      })
    }

    const parseResult = persistedConfigurationV2Schema.safeParse(parsedBackup)
    if (!parseResult.success) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '备份文件格式不兼容，无法恢复。',
        recoverable: true,
      })
    }

    // 校验能解密
    await this.decryptConfigFromDisk(parseResult.data)

    // 写回备份内容
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(`${configPath}.tmp`, rawBackup, 'utf8')
    await rename(`${configPath}.tmp`, configPath)

    return this.readRuntimeSnapshot()
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 无返回值。
   * @throws 当文件删除失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<void> {
    const configPath = this.resolveConfigPath()
    const backupPath = this.resolveConfigBackupPath()

    await Promise.all([
      import('node:fs/promises').then(({ rm }) =>
        rm(configPath, { force: true }),
      ),
      import('node:fs/promises').then(({ rm }) =>
        rm(backupPath, { force: true }),
      ),
      import('node:fs/promises').then(({ rm }) =>
        rm(`${configPath}.tmp`, { force: true }),
      ),
    ])
  }

  /**
   * 读取本地会话索引；索引不存在或损坏时尝试从 Pi SDK 原生 session 重建。
   *
   * 孤儿清理（Pi session 文件已不存在但索引中仍有记录）在重建时自动完成 ——
   * 重建只会包含 Pi SDK 返回的现有 session。
   *
   * @returns 当前可展示的会话索引条目。
   * @throws 当索引 JSON 损坏且 SDK 列表读取也失败时，Promise 会 reject。
   */
  private async loadSessionIndex(): Promise<PersistedSessionIndexEntry[]> {
    const indexPath = this.resolveSessionIndexPath()

    try {
      const rawIndex = await readFile(indexPath, 'utf8')
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) =>
            this.normalizeSessionIndexEntry(entry),
          )
        : []
      this.replaceSessionIndex(entries)

      return entries
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return this.rebuildSessionIndexFromSdk()
      }

      // 索引 JSON 损坏时也触发重建
      return this.rebuildSessionIndexFromSdk()
    }
  }

  /**
   * 在本地索引缺失或损坏时，扫描所有 Agent 的 Pi SDK 原生 session 重建全局索引。
   *
   * Pi session 是会话的唯一真相来源；title、时间戳等字段派生自 Pi session 数据。
   * 重建时会尝试读取旧索引，为仍然存在的 session 保留 Tangyuan 扩展数据
   * （lastMessagePreview、status）；旧索引中存在但 Pi session 已删除的条目会被清理。
   *
   * @returns 从 SDK 恢复出的索引条目。
   * @throws 当运行时配置或 SDK session 列表读取失败时，Promise 会 reject。
   */
  private async rebuildSessionIndexFromSdk(): Promise<
    PersistedSessionIndexEntry[]
  > {
    const readResult = await this.readPersistedConfiguration()

    if (!readResult.config) {
      this.replaceSessionIndex([])
      await this.writeSessionIndex()
      return []
    }

    // 读取旧索引以保留扩展数据
    const oldEntries = await this.tryReadOldIndex()
    const allEntries: PersistedSessionIndexEntry[] = []
    const agents = Object.entries(readResult.config.agents).filter(
      ([, agentConfig]) => agentConfig.status === 'active',
    )

    for (const [agentId] of agents) {
      const runtimeConfig = this.extractAgentRuntimeConfig(
        readResult.config,
        agentId,
      )
      const cwd =
        agentId === TANGYUAN_DEFAULT_AGENT_ID
          ? this.resolveAgentHomePath()
          : this.resolveAgentWorkspacePath(agentId)

      try {
        const sdkSessions = await this.gateway.listSessions({
          cwd,
          sessionDir: this.resolveSdkSessionDir(),
        })

        for (const session of sdkSessions) {
          const oldEntry = oldEntries.get(session.sessionId)

          allEntries.push({
            sessionId: session.sessionId,
            sdkSessionFile: session.sdkSessionFile,
            title: session.title?.trim() || session.sessionId,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            provider: runtimeConfig?.providerId ?? '',
            model: runtimeConfig?.modelId ?? '',
            agentId,
            // 保留旧扩展数据，不存在则使用默认值
            lastMessagePreview: oldEntry?.lastMessagePreview ?? '',
            status: oldEntry?.status ?? 'idle',
          })
        }
      } catch {
        // 单个 Agent 的 session 列表读取失败时跳过该 Agent
      }
    }

    this.replaceSessionIndex(allEntries)
    await this.writeSessionIndex()

    return allEntries
  }

  /**
   * 尝试读取旧版本地会话索引，用于重建时保留扩展数据。
   *
   * @returns 以 sessionId 为键的旧索引条目映射。
   * @throws 此方法不会主动抛出错误。
   */
  private async tryReadOldIndex(): Promise<
    Map<string, PersistedSessionIndexEntry>
  > {
    try {
      const indexPath = this.resolveSessionIndexPath()
      const rawIndex = await readFile(indexPath, 'utf8')
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) =>
            this.normalizeSessionIndexEntry(entry),
          )
        : []

      return new Map(entries.map((entry) => [entry.sessionId, entry]))
    } catch {
      return new Map()
    }
  }

  /**
   * 用已读取的索引条目刷新内存中的会话摘要缓存。
   *
   * @param entries - 从本地索引或 SDK 恢复出的索引条目。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private replaceSessionIndex(entries: PersistedSessionIndexEntry[]): void {
    this.sessionIndex.clear()
    this.sessions.clear()

    for (const entry of entries) {
      this.sessionIndex.set(entry.sessionId, entry)
      this.sessions.set(
        entry.sessionId,
        this.createSessionSummaryFromIndexEntry(entry),
      )
    }
  }

  /**
   * 把索引条目转换成 Renderer 使用的会话摘要。
   *
   * @param entry - 本地持久化索引条目。
   * @returns 对应的 AgentSessionSummary。
   * @throws 此方法不会主动抛出错误。
   */
  private createSessionSummaryFromIndexEntry(
    entry: PersistedSessionIndexEntry,
  ): AgentSessionSummary {
    return {
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      title: entry.title,
      state: entry.status,
      updatedAt: entry.updatedAt,
    }
  }

  /**
   * 将会话索引以临时文件加 rename 的方式写入 userData。
   *
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  private async writeSessionIndex(): Promise<void> {
    const indexPath = this.resolveSessionIndexPath()
    const entries = [...this.sessionIndex.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    const payload: PersistedSessionIndex = {
      sessions: entries,
    }

    await mkdir(dirname(indexPath), { recursive: true })
    const tempIndexPath = `${indexPath}.${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`
    await writeFile(
      tempIndexPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    )
    await rename(tempIndexPath, indexPath)
  }

  /**
   * 更新单个会话索引条目并同步会话摘要缓存。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param patch - 要覆盖到索引条目上的字段。
   * @returns 更新后的索引条目。
   * @throws 当会话索引不存在时抛出 AgentRuntimeError。
   */
  private async updateSessionIndexEntry(
    sessionId: string,
    patch: Partial<PersistedSessionIndexEntry>,
  ): Promise<PersistedSessionIndexEntry> {
    const currentEntry = this.getKnownSessionIndexEntry(sessionId)
    const nextEntry = {
      ...currentEntry,
      ...patch,
    }
    this.sessionIndex.set(sessionId, nextEntry)
    this.sessions.set(
      sessionId,
      this.createSessionSummaryFromIndexEntry(nextEntry),
    )
    await this.writeSessionIndex()

    return nextEntry
  }

  /**
   * 确保指定会话已从索引加载到内存。
   *
   * @param sessionId - 需要加载的会话标识。
   * @returns 无返回值。
   * @throws 当索引读取失败时，Promise 会 reject。
   */
  private async ensureSessionLoaded(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      return
    }

    await this.loadSessionIndex()
  }

  /**
   * 确保指定会话已有 Pi SDK session handle，历史会话会通过 openSession 打开。
   *
   * @param sessionId - 需要打开的会话标识。
   * @returns 可运行 prompt 的 Pi SDK session handle。
   * @throws 当会话不存在、配置缺失或 SDK 打开失败时，Promise 会 reject。
   */
  private async ensureSessionHandle(
    sessionId: string,
  ): Promise<PiSdkSessionHandle> {
    const existingHandle = this.sessionHandles.get(sessionId)

    if (existingHandle) {
      return existingHandle
    }

    const indexEntry = this.getKnownSessionIndexEntry(sessionId)
    const configuration = await this.readRequiredRuntimeConfiguration(
      indexEntry.agentId,
    )
    const cwd =
      indexEntry.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.resolveAgentHomePath()
        : this.resolveAgentWorkspacePath(indexEntry.agentId)
    const openRequest = {
      ...configuration,
      sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
      cwd,
      agentSkillsPath: this.resolveAgentSkillsPath(indexEntry.agentId),
      sharedSkillsPath: this.resolveSharedSkillsPath(),
    }
    const handle = await this.gateway.openSession(
      this.toolApprovalGateway
        ? { ...openRequest, toolApprovalGateway: this.toolApprovalGateway }
        : openRequest,
    )
    this.sessionHandles.set(sessionId, handle)

    return handle
  }

  /**
   * 读取已加载的单个索引条目。
   *
   * @param sessionId - 会话标识。
   * @returns 对应索引条目。
   * @throws 当索引条目不存在时抛出 AgentRuntimeError。
   */
  private getKnownSessionIndexEntry(
    sessionId: string,
  ): PersistedSessionIndexEntry {
    const indexEntry = this.sessionIndex.get(sessionId)

    if (!indexEntry) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId} 的本地索引。`,
        recoverable: true,
      })
    }

    return indexEntry
  }

  /**
   * 解析本地会话索引文件路径。
   *
   * @returns Electron userData 下的 sessions/index.json 路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSessionIndexPath(): string {
    return join(this.userDataPath, 'sessions', 'index.json')
  }

  /**
   * 解析 Pi SDK 原生 session 文件目录。
   *
   * @returns Electron userData 下保存 SDK session 的目录路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSdkSessionDir(): string {
    return join(this.userDataPath, 'sessions', 'pi-sdk')
  }

  /**
   * 解析单个 Pi SDK 原生 session 文件路径。
   *
   * @param sessionId - 会话标识。
   * @returns 对应 session 的 JSONL 文件路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSdkSessionFile(sessionId: string): string {
    return join(this.resolveSdkSessionDir(), `${sessionId}.jsonl`)
  }

  /**
   * 将未知 JSON 值校验成会话索引条目。
   *
   * @param value - 从 index.json 解析出的未知条目。
   * @returns 字段合法时返回单元素数组，否则返回空数组。
   * @throws 此方法不会主动抛出错误。
   */
  private normalizeSessionIndexEntry(
    value: unknown,
  ): PersistedSessionIndexEntry[] {
    const entry = value as Partial<PersistedSessionIndexEntry>

    if (
      typeof entry.sessionId !== 'string' ||
      typeof entry.sdkSessionFile !== 'string' ||
      typeof entry.title !== 'string' ||
      typeof entry.createdAt !== 'string' ||
      typeof entry.updatedAt !== 'string' ||
      typeof entry.provider !== 'string' ||
      typeof entry.model !== 'string' ||
      typeof entry.agentId !== 'string' ||
      typeof entry.lastMessagePreview !== 'string' ||
      !this.isAgentRunState(entry.status)
    ) {
      return []
    }

    return [
      {
        sessionId: entry.sessionId,
        sdkSessionFile: entry.sdkSessionFile,
        title: entry.title,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        provider: entry.provider,
        model: entry.model,
        agentId: entry.agentId,
        lastMessagePreview: entry.lastMessagePreview,
        status: entry.status,
      },
    ]
  }

  /**
   * 判断未知值是否是可展示的 Agent 运行状态。
   *
   * @param value - 待判断的未知值。
   * @returns 是 AgentRunState 时返回 true。
   * @throws 此方法不会主动抛出错误。
   */
  private isAgentRunState(value: unknown): value is AgentRunState {
    return (
      value === 'idle' ||
      value === 'running' ||
      value === 'completed' ||
      value === 'cancelled' ||
      value === 'failed'
    )
  }

  /**
   * 基于已有索引生成下一个简单递增会话标识。
   *
   * @param entries - 当前已存在的索引条目。
   * @returns 形如 session-N 的新会话标识。
   * @throws 此方法不会主动抛出错误。
   */
  private createNextSessionId(): string {
    return crypto.randomUUID()
  }

  /**
   * 生成会话列表里展示的最后消息预览。
   *
   * @param content - 完整消息内容。
   * @returns 压缩空白并截断后的预览文本。
   * @throws 此方法不会主动抛出错误。
   */
  private createMessagePreview(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, 120)
  }

  /**
   * 判断文件系统错误是否表示路径不存在。
   *
   * @param error - 捕获到的未知错误。
   * @returns 是 ENOENT 时返回 true。
   * @throws 此方法不会主动抛出错误。
   */
  private isNotFoundError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
  }

  /**
   * 确保指定 Agent Home 目录结构存在。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当目录创建失败时，Promise 会 reject。
   */
  private async ensureAgentHome(agentId: AgentId): Promise<void> {
    const homePath = this.resolveAgentHomePath(agentId)
    const soulHistoryPath = this.resolveSoulHistoryPath(agentId)

    await mkdir(homePath, { recursive: true })
    await mkdir(soulHistoryPath, { recursive: true })
    await mkdir(join(homePath, 'memory'), { recursive: true })
    await mkdir(join(homePath, 'skills'), { recursive: true })
    await mkdir(join(homePath, 'workspace'), { recursive: true })

    // 确保 soul.md 存在
    const soulPath = this.resolveSoulPath(agentId)

    if (!(await this.pathExists(soulPath))) {
      const displayName =
        agentId === TANGYUAN_DEFAULT_AGENT_ID ? '汤圆' : agentId
      const soulContent = [
        `# ${displayName}`,
        '',
        `创建时间：${this.now()}`,
        '',
        '## 身份',
        agentId === TANGYUAN_DEFAULT_AGENT_ID
          ? '汤圆是默认 Agent，负责凭据管理和创建其他 Agent。'
          : `${displayName} 是用户创建的 Agent。`,
        '',
        '## 规则',
        '遵循用户指令，在执行危险操作前先确认。',
        '',
      ].join('\n')
      await writeFile(soulPath, soulContent, 'utf8')
    }
  }

  /**
   * 从旧 tangyuan Agent 目录迁移 user.md 到共享 profile 路径。
   *
   * @returns 无返回值。
   * @throws 当文件读取、复制或写入失败时，Promise 会 reject。
   */
  private async migrateLegacyUserProfile(): Promise<void> {
    const legacyUserPath = join(
      this.resolveAgentHomePath(TANGYUAN_DEFAULT_AGENT_ID),
      'user.md',
    )
    const legacyHistoryPath = join(
      this.resolveAgentHomePath(TANGYUAN_DEFAULT_AGENT_ID),
      'user.history',
    )
    const targetPath = this.resolveUserProfilePath()
    const targetHistoryPath = this.resolveUserHistoryPath()

    if (!(await this.pathExists(legacyUserPath))) {
      return
    }

    // 迁移 user.md
    await mkdir(this.resolveSharedProfilePath(), { recursive: true })
    await copyFile(legacyUserPath, targetPath)

    // 迁移 user.history/ 目录下的文件
    if (await this.pathExists(legacyHistoryPath)) {
      await mkdir(targetHistoryPath, { recursive: true })
      const historyFiles = await this.readDirectoryFileSet(legacyHistoryPath)

      for (const fileName of historyFiles) {
        await copyFile(
          join(legacyHistoryPath, fileName),
          join(targetHistoryPath, fileName),
        )
      }
    }
  }

  /**
   * 确保默认 Agent Home 及 bootstrap 相关文件存在。
   *
   * @returns 默认 Agent Home 的文件状态。
   * @throws 当文件系统创建、读取或写入失败时，Promise 会 reject。
   */
  private async ensureDefaultAgentHome(): Promise<AgentHomeStatus> {
    const absoluteHomePath = this.resolveAgentHomePath()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.resolveUserProfilePath()
    const soulHistoryPath = join(absoluteHomePath, 'soul.history')
    const userHistoryPath = join(absoluteHomePath, 'user.history')
    const memoryPath = join(absoluteHomePath, 'memory')
    const skillsPath = join(absoluteHomePath, 'skills')

    await mkdir(absoluteHomePath, { recursive: true })
    await Promise.all([
      mkdir(soulHistoryPath, { recursive: true }),
      mkdir(userHistoryPath, { recursive: true }),
      mkdir(memoryPath, { recursive: true }),
      mkdir(skillsPath, { recursive: true }),
    ])

    // 确保共享 profile 和 skills 目录存在
    await mkdir(this.resolveSharedProfilePath(), { recursive: true })
    await mkdir(this.resolveUserHistoryPath(), { recursive: true })
    await mkdir(this.resolveSharedSkillsPath(), { recursive: true })

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await this.pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [bootstrapFileExists, soulFileExists, userFileExists] =
      await Promise.all([
        this.pathExists(bootstrapPath),
        this.pathExists(soulPath),
        this.pathExists(userPath),
      ])

    if (!bootstrapFileExists && !soulFileExists && !userFileExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    return {
      initialized: soulFileExists && userFileExists,
      bootstrapRequired:
        !soulFileExists && (await this.pathExists(bootstrapPath)),
      bootstrapFileExists: await this.pathExists(bootstrapPath),
      soulFileExists: await this.pathExists(soulPath),
      userFileExists: await this.pathExists(userPath),
      soulUpdatedAt: await this.getMtimeIso(soulPath),
      userUpdatedAt: await this.getMtimeIso(userPath),
    }
  }

  /**
   * 对比单次运行前后的 profile 文件状态，并在文件生成或更新后广播事件。
   *
   * @param previousStatus - 运行开始前的 Agent Home 文件状态。
   * @param transcriptTarget - 需要向 transcript 追加系统消息时的会话归属。
   * @returns 更新后的 Agent Home 文件状态。
   * @throws 当 Agent Home 状态读取失败时，Promise 会 reject。
   */
  private async emitProfileUpdateEvents(
    previousStatus: AgentHomeStatus,
    transcriptTarget?: {
      agentId: AgentId
      sessionId: string
    },
  ): Promise<AgentHomeStatus> {
    const nextStatus = await this.ensureDefaultAgentHome()

    if (
      nextStatus.soulUpdatedAt &&
      nextStatus.soulUpdatedAt !== previousStatus.soulUpdatedAt
    ) {
      this.emitProfileUpdated(
        'soul',
        nextStatus.soulUpdatedAt,
        transcriptTarget,
      )
    }

    if (
      nextStatus.userUpdatedAt &&
      nextStatus.userUpdatedAt !== previousStatus.userUpdatedAt
    ) {
      this.emitProfileUpdated(
        'user',
        nextStatus.userUpdatedAt,
        transcriptTarget,
      )
    }

    return nextStatus
  }

  /**
   * 在主回复完成后启动一次后台 profile 维护回合。
   *
   * @param input - 当前会话、SDK 运行器、主回合文本和 profile 状态。
   * @returns 无返回值。
   * @throws 当维护失败系统消息无法追加时，Promise 会 reject；维护流程自身错误会转换为系统消息。
   */
  private async runProfileMaintenanceTurn(input: {
    agentId: AgentId
    sessionId: string
    handle: PiSdkSessionHandle
    userContent: string
    agentContent: string
    profileStatus: AgentHomeStatus
  }): Promise<void> {
    if (
      !input.profileStatus.soulFileExists ||
      !input.profileStatus.userFileExists
    ) {
      return
    }

    try {
      const profileSnapshot = await this.readProfileMaintenanceSnapshot(
        input.agentId,
      )
      const maintenancePrompt = this.buildProfileMaintenancePrompt({
        userContent: input.userContent,
        agentContent: input.agentContent,
        soulContent: profileSnapshot.soul.content,
        profileUserContent: profileSnapshot.user.content,
      })

      await input.handle.prompt(maintenancePrompt)

      const readResult = await this.readPersistedConfiguration()
      const runtimeConfig = readResult.config
        ? this.extractAgentRuntimeConfig(readResult.config, input.agentId)
        : null
      await this.applyProfileMaintenanceResults({
        agentId: input.agentId,
        sessionId: input.sessionId,
        previousSnapshot: profileSnapshot,
        apiKey: runtimeConfig?.apiKey ?? null,
      })
    } catch (error) {
      this.appendAndEmitSystemMessage({
        agentId: input.agentId,
        sessionId: input.sessionId,
        content: `Profile 维护失败：${sanitizeErrorMessage(error)}`,
      })
    }
  }

  /**
   * 在 bootstrap 模式回合结束后施行文件门控。
   *
   * - 若 soul.md 与 user.md 同时存在：删除 bootstrap.md（Agent 可能遗漏）。
   * - 若 bootstrap.md 已被 Agent 删除但 profile 仍未就绪：重新创建 bootstrap.md。
   * - 其它情况不做任何操作，bootstrap 流程继续。
   *
   * @returns 无返回值。
   * @throws 当 bootstrap.md 重建写入失败时，Promise 会 reject。
   */
  private async performBootstrapCompletionGating(): Promise<void> {
    const absoluteHomePath = this.resolveAgentHomePath()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')

    const [bootstrapExists, soulExists, userExists] = await Promise.all([
      this.pathExists(bootstrapPath),
      this.pathExists(soulPath),
      this.pathExists(userPath),
    ])

    // Gate 1: bootstrap 完成 — 确保 bootstrap.md 已被删除
    if (soulExists && userExists) {
      if (bootstrapExists) {
        await import('node:fs/promises').then(({ rm }) =>
          rm(bootstrapPath, { force: true }),
        )
      }
      return
    }

    // Gate 2: 恢复 — bootstrap.md 被误删但 profile 未完成
    if (!bootstrapExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    // Gate 3: bootstrap 仍在进行中 — 不做任何操作
  }

  /**
   * 读取维护回合开始前的 profile 文件内容和历史目录状态。
   *
   * @returns soul.md、user.md 及其历史目录的快照。
   * @throws 当 profile 文件或历史目录无法读取时，Promise 会 reject。
   */
  private async readProfileMaintenanceSnapshot(
    agentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<ProfileMaintenanceSnapshot> {
    return {
      soul: await this.readProfileMaintenanceFileSnapshot({
        target: 'soul',
        path: this.resolveSoulPath(agentId),
        historyPath: this.resolveSoulHistoryPath(agentId),
      }),
      user: await this.readProfileMaintenanceFileSnapshot({
        target: 'user',
        path: this.resolveUserProfilePath(),
        historyPath: this.resolveUserHistoryPath(),
      }),
    }
  }

  /**
   * 读取单个 profile 文件及其历史目录状态。
   *
   * @param input - 需要读取的 profile 目标、文件路径和历史目录路径。
   * @returns 可用于维护结果校验的文件快照。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  private async readProfileMaintenanceFileSnapshot(input: {
    target: ProfileMaintenanceTarget
    path: string
    historyPath: string
  }): Promise<ProfileMaintenanceFileSnapshot> {
    return {
      target: input.target,
      path: input.path,
      historyPath: input.historyPath,
      content: await readFile(input.path, 'utf8'),
      historyFiles: await this.readDirectoryFileSet(input.historyPath),
    }
  }

  /**
   * 应用维护回合结束后的 profile 文件校验、脱敏和事件广播。
   *
   * @param input - 会话归属、维护前快照和可用于精确脱敏的 API Key。
   * @returns 无返回值。
   * @throws 当文件读取、恢复或脱敏写入失败时，Promise 会 reject。
   */
  private async applyProfileMaintenanceResults(input: {
    agentId: AgentId
    sessionId: string
    previousSnapshot: ProfileMaintenanceSnapshot
    apiKey: string | null
  }): Promise<void> {
    // soul: LLM 写入 agent home 目录下的 soul.md
    await this.applyProfileMaintenanceFileResult({
      agentId: input.agentId,
      sessionId: input.sessionId,
      previousFile: input.previousSnapshot.soul,
      apiKey: input.apiKey,
    })

    // user: LLM 可能写入 agent home 或共享 profile 路径
    // 先检查 agent home 下的 user.md（旧位置），再同步到共享路径
    const agentHomeUserPath = join(
      this.resolveAgentHomePath(input.agentId),
      'user.md',
    )
    const agentHomeUserHistoryPath = join(
      this.resolveAgentHomePath(input.agentId),
      'user.history',
    )

    if (await this.pathExists(agentHomeUserPath)) {
      const agentHomeUserContent = await this.safeReadFile(agentHomeUserPath)

      if (agentHomeUserContent !== input.previousSnapshot.user.content) {
        // LLM 修改了 agent home 下的 user.md，同步到共享路径
        const sharedUserPath = this.resolveUserProfilePath()

        // 确保共享路径存在
        await mkdir(this.resolveSharedProfilePath(), { recursive: true })
        await mkdir(this.resolveUserHistoryPath(), { recursive: true })

        // 应用相同的校验逻辑到 agent home 的 user.md
        await this.applyProfileMaintenanceFileResult({
          agentId: input.agentId,
          sessionId: input.sessionId,
          previousFile: {
            ...input.previousSnapshot.user,
            path: agentHomeUserPath,
            historyPath: agentHomeUserHistoryPath,
          },
          apiKey: input.apiKey,
        })

        // 同步到共享路径
        const updatedContent = await this.safeReadFile(agentHomeUserPath)
        if (updatedContent !== input.previousSnapshot.user.content) {
          await writeFile(sharedUserPath, updatedContent, 'utf8')
        }
      }
    }

    // 同时校验共享路径下的 user.md
    await this.applyProfileMaintenanceFileResult({
      agentId: input.agentId,
      sessionId: input.sessionId,
      previousFile: input.previousSnapshot.user,
      apiKey: input.apiKey,
    })
  }

  /**
   * 校验单个 profile 文件是否带备份更新，并在通过后广播更新消息。
   *
   * @param input - 会话归属、维护前文件快照和可用于精确脱敏的 API Key。
   * @returns 无返回值。
   * @throws 当文件读取、恢复或脱敏写入失败时，Promise 会 reject。
   */
  private async applyProfileMaintenanceFileResult(input: {
    agentId: AgentId
    sessionId: string
    previousFile: ProfileMaintenanceFileSnapshot
    apiKey: string | null
  }): Promise<void> {
    const nextContent = await readFile(input.previousFile.path, 'utf8')

    if (nextContent === input.previousFile.content) {
      return
    }

    const hasBackup = await this.hasNewHistoryFile(input.previousFile)

    if (!hasBackup) {
      await writeFile(
        input.previousFile.path,
        input.previousFile.content,
        'utf8',
      )
      this.appendAndEmitSystemMessage({
        agentId: input.agentId,
        sessionId: input.sessionId,
        content: `更新${this.formatProfileTargetLabel(input.previousFile.target)}失败：缺少更新前备份，已保留旧版本。`,
      })
      return
    }

    const redactedContent = this.redactSensitiveProfileContent(
      nextContent,
      input.apiKey,
    )

    if (redactedContent !== nextContent) {
      await writeFile(input.previousFile.path, redactedContent, 'utf8')
    }

    this.emitProfileUpdated(
      input.previousFile.target,
      (await this.getMtimeIso(input.previousFile.path)) ?? this.now(),
      {
        agentId: input.agentId,
        sessionId: input.sessionId,
      },
    )
  }

  /**
   * 构造后台 profile 维护回合使用的 prompt。
   *
   * @param input - 本轮主回合的用户消息、Agent 回复以及当前 profile 内容。
   * @returns 只用于后台维护的完整 prompt。
   * @throws 此方法不会主动抛出错误。
   */
  private buildProfileMaintenancePrompt(input: {
    userContent: string
    agentContent: string
    soulContent: string
    profileUserContent: string
  }): string {
    return [
      '# 后台 profile 维护回合',
      '',
      '这是主回复完成后的后台 profile 维护回合，不要回复用户，不要继续主回复，也不要输出会混入 transcript 的总结。',
      '只在本轮对话明确改变长期偏好、边界、称呼、工作规则或 Agent 行为规则时更新 profile；内容无实质变化时不要写文件。',
      '',
      '更新规则：',
      '1. 单轮最多更新一次 soul.md，最多更新一次 user.md。',
      '2. 更新前必须使用 read 读取旧文件。',
      '3. 更新前必须使用 write 把旧内容备份到 soul.history/ 或 user.history/。',
      '4. 更新必须使用 edit 或 write 完成。',
      '5. 不得把 API Key、token、password、密码、密钥或令牌写入 soul.md / user.md。',
      '',
      '## 当前 soul.md',
      input.soulContent.trim(),
      '',
      '## 当前 user.md',
      input.profileUserContent.trim(),
      '',
      '## 刚完成的用户消息',
      input.userContent,
      '',
      '## 刚完成的 Agent 主回复',
      input.agentContent,
    ].join('\n')
  }

  /**
   * 判断维护回合是否写入了新的历史备份文件。
   *
   * @param previousFile - 维护回合开始前的 profile 文件快照。
   * @returns 有新增历史文件时返回 true，否则返回 false。
   * @throws 当历史目录无法读取时，Promise 会 reject。
   */
  private async hasNewHistoryFile(
    previousFile: ProfileMaintenanceFileSnapshot,
  ): Promise<boolean> {
    const nextHistoryFiles = await this.readDirectoryFileSet(
      previousFile.historyPath,
    )

    for (const fileName of nextHistoryFiles) {
      if (!previousFile.historyFiles.has(fileName)) {
        return true
      }
    }

    return false
  }

  /**
   * 读取目录下的文件名集合，目录不存在时返回空集合。
   *
   * @param path - 需要读取的目录路径。
   * @returns 目录下的文件名集合。
   * @throws 当目录读取失败且不是 ENOENT 时，Promise 会 reject。
   */
  private async readDirectoryFileSet(path: string): Promise<Set<string>> {
    try {
      return new Set(await readdir(path))
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return new Set()
      }

      throw error
    }
  }

  /**
   * 安全读取文件内容，文件不存在时返回空字符串。
   *
   * @param path - 需要读取的文件路径。
   * @returns 文件内容；文件不存在时返回空字符串。
   * @throws 当文件读取失败且不是 ENOENT 时，Promise 会 reject。
   */
  private async safeReadFile(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return ''
      }

      throw error
    }
  }

  /**
   * 从 profile 内容中移除敏感凭据。
   *
   * @param content - Agent 写入的 profile 原始内容。
   * @param apiKey - 已保存配置里的 API Key，用于精确替换。
   * @returns 已脱敏的 profile 内容。
   * @throws 此方法不会主动抛出错误。
   */
  private redactSensitiveProfileContent(
    content: string,
    apiKey: string | null,
  ): string {
    const exactRedactedContent = apiKey
      ? content.split(apiKey).join('[已隐藏敏感凭据]')
      : content

    return exactRedactedContent
      .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/g, '[已隐藏敏感凭据]')
      .replace(
        /((?:api\s*key|token|password|secret|密钥|令牌|密码)\s*[:：=]\s*)([^\s，。；;]+)/gi,
        '$1[已隐藏敏感凭据]',
      )
  }

  /**
   * 广播 profile 更新时间，并可选追加用户可见的系统消息。
   *
   * @param target - 被更新的 profile 目标。
   * @param updatedAt - 文件系统记录的更新时间。
   * @param transcriptTarget - 需要追加 transcript 系统消息时的会话归属。
   * @returns 无返回值。
   * @throws 当系统消息追加失败时，Promise 会 reject。
   */
  private emitProfileUpdated(
    target: ProfileMaintenanceTarget,
    updatedAt: string,
    transcriptTarget?: {
      agentId: AgentId
      sessionId: string
    },
  ): void {
    this.emit({
      type: 'profile-updated',
      agentId: transcriptTarget?.agentId ?? TANGYUAN_DEFAULT_AGENT_ID,
      target,
      updatedAt,
      occurredAt: this.now(),
    })

    if (transcriptTarget) {
      this.appendAndEmitSystemMessage({
        ...transcriptTarget,
        content: target === 'soul' ? '已更新 Agent 规则' : '已更新用户画像',
      })
    }
  }

  /**
   * 追加并广播一条系统消息。
   *
   * @param input - 系统消息的会话归属和内容。
   * @returns 已追加的系统消息。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private appendAndEmitSystemMessage(input: {
    agentId: AgentId
    sessionId: string
    content: string
  }): AgentMessage {
    const message = this.appendMessage({
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: 'system',
      content: input.content,
    })
    this.emit({
      type: 'message-appended',
      agentId: input.agentId,
      message,
      occurredAt: this.now(),
    })

    return message
  }

  /**
   * 把 profile 目标转换为用户可读的中文标签。
   *
   * @param target - profile 文件目标。
   * @returns 用于系统消息的中文标签。
   * @throws 此方法不会主动抛出错误。
   */
  private formatProfileTargetLabel(target: ProfileMaintenanceTarget): string {
    return target === 'soul' ? 'Agent 规则' : '用户画像'
  }

  /**
   * 读取默认 Agent profile 文件并注入到用户 prompt。
   *
   * @param userContent - 用户在 Renderer 中输入的原始消息。
   * @returns 包含 soul.md/user.md 或 bootstrap.md 上下文的 prompt。
   * @throws 当 profile 文件读取失败时，Promise 会 reject。
   */
  private async buildPromptWithProfileContext(
    userContent: string,
    agentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<string> {
    const absoluteHomePath = this.resolveAgentHomePath(agentId)
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.resolveUserProfilePath()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')

    // 确保共享 user profile 存在
    if (!(await this.pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [soulFileExists, userFileExists] = await Promise.all([
      this.pathExists(soulPath),
      this.pathExists(userPath),
    ])

    if (soulFileExists && userFileExists) {
      const [soulContent, profileUserContent] = await Promise.all([
        readFile(soulPath, 'utf8'),
        readFile(userPath, 'utf8'),
      ])

      return [
        `# ${PROFILE_CONTEXT_HEADER}`,
        '',
        '## soul.md',
        soulContent.trim(),
        '',
        '## user.md',
        profileUserContent.trim(),
        '',
        '# 用户消息',
        userContent,
      ].join('\n')
    }

    const bootstrapContent = (await this.pathExists(bootstrapPath))
      ? await readFile(bootstrapPath, 'utf8')
      : this.createBootstrapTemplate()

    return [
      `# ${PROFILE_CONTEXT_HEADER}`,
      '',
      '当前 profile 尚未初始化。请根据 bootstrap.md 的问题推进首次初始化；信息不足时继续追问，不要要求用户点击完成按钮。',
      '当你判断固定问题已经回答充分时，必须使用 Pi SDK 可用文件工具完成初始化。',
      '',
      '初始化完成规则：',
      '1. 使用 write 或 edit 写入 soul.md。',
      '2. 使用 write 或 edit 写入 user.md。',
      '3. 完成后删除 bootstrap.md。',
      '4. 不得把 API Key、密钥、令牌或其它敏感凭据写入 soul.md 或 user.md。',
      '',
      'soul.md 至少必须覆盖：身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。',
      'user.md 至少必须覆盖：称呼、语言与语气偏好、常见工作类型、决策偏好、需要先确认的事项、禁止触碰的信息和边界、长期偏好。',
      '',
      '## bootstrap.md',
      bootstrapContent.trim(),
      '',
      '# 用户消息',
      userContent,
    ].join('\n')
  }

  /**
   * 把用户家目录下的 Agent Home 转成绝对路径。
   *
   * @param agentId - 需要解析路径的 Agent 标识；省略时返回默认 tangyuan 路径。
   * @returns 指定 Agent Home 的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveAgentHomePath(
    agentId: string = TANGYUAN_DEFAULT_AGENT_ID,
  ): string {
    const resolvedDefault = this.agentHomePath.startsWith('~')
      ? join(this.fsRoot, this.agentHomePath.slice(2))
      : this.agentHomePath

    if (agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      return resolvedDefault
    }

    return join(dirname(resolvedDefault), agentId)
  }

  /**
   * 解析指定 Agent 的 workspace 绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns workspace 目录的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveAgentWorkspacePath(agentId: string): string {
    return join(this.resolveAgentHomePath(agentId), 'workspace')
  }

  /**
   * 解析共享 Skills 目录的绝对路径。
   *
   * @returns ~/.tangyuan/skills/ 绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSharedSkillsPath(): string {
    // 共享 skills: ~/.tangyuan/skills/
    // agentHomePath: ~/.tangyuan/agents/tangyuan
    const tangyuanDir = dirname(this.resolveAgentHomePath()) // ~/.tangyuan/agents
    return join(dirname(tangyuanDir), 'skills') // ~/.tangyuan/skills
  }

  /**
   * 解析指定 Agent 专属 Skills 目录的绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns ~/.tangyuan/agents/<agentId>/skills/ 绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveAgentSkillsPath(agentId: string): string {
    return join(this.resolveAgentHomePath(agentId), 'skills')
  }

  /**
   * 解析共享 profile 目录的绝对路径。
   *
   * @returns ~/.tangyuan/profile/ 绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSharedProfilePath(): string {
    // 共享 profile: ~/.tangyuan/profile/
    // agentHomePath: ~/.tangyuan/agents/tangyuan
    const tangyuanDir = dirname(this.resolveAgentHomePath()) // ~/.tangyuan/agents
    return join(dirname(tangyuanDir), 'profile') // ~/.tangyuan/profile
  }

  /**
   * 解析共享 user profile 文件的绝对路径。
   *
   * @returns ~/.tangyuan/profile/user.md 绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveUserProfilePath(): string {
    return join(this.resolveSharedProfilePath(), 'user.md')
  }

  /**
   * 解析共享 user profile 历史目录的绝对路径。
   *
   * @returns ~/.tangyuan/profile/user.history/ 绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveUserHistoryPath(): string {
    return join(this.resolveSharedProfilePath(), 'user.history')
  }

  /**
   * 解析指定 Agent 的 soul 文件绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns agent home 下 soul.md 的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSoulPath(agentId: AgentId): string {
    return join(this.resolveAgentHomePath(agentId), 'soul.md')
  }

  /**
   * 解析指定 Agent 的 soul 历史目录绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns agent home 下 soul.history/ 的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSoulHistoryPath(agentId: AgentId): string {
    return join(this.resolveAgentHomePath(agentId), 'soul.history')
  }

  /**
   * 判断给定路径是否存在。
   *
   * @param path - 需要检查的文件或目录路径。
   * @returns 路径存在则返回 true，不存在则返回 false。
   * @throws 当底层文件系统返回除“找不到”以外的错误时，Promise 会 reject。
   */
  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.F_OK)
      return true
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false
      }

      throw error
    }
  }

  /**
   * 读取文件最后修改时间。
   *
   * @param path - 需要读取更新时间的文件路径。
   * @returns 以 ISO 字符串表示的修改时间；文件不存在时返回 null。
   * @throws 当底层文件系统读取失败时，Promise 会 reject。
   */
  private async getMtimeIso(path: string): Promise<string | null> {
    try {
      const fileStat = await stat(path)
      return fileStat.mtime.toISOString()
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null
      }

      throw error
    }
  }

  /**
   * 生成固定的 bootstrap 问题模板。
   *
   * @returns 可写入 bootstrap.md 的 Markdown 内容。
   * @throws 此方法不会主动抛出错误。
   */
  private createBootstrapTemplate(): string {
    return [
      '# Bootstrap',
      '',
      '1. 用户希望汤圆怎么称呼自己。',
      '2. 用户希望汤圆默认使用什么语言、语气和沟通密度。',
      '3. 用户主要希望汤圆帮助完成哪些工作。',
      '4. 哪些操作必须先征求用户确认。',
      '5. 哪些目录、文件、信息永远不能触碰或泄露。',
      '6. 用户希望汤圆如何记录长期偏好和项目经验。',
      '7. 汤圆在失败、不确定或缺少上下文时应该如何处理。',
      '8. 哪些规则必须写入 soul.md 并长期遵守。',
      '',
    ].join('\n')
  }

  /**
   * 确认会话已存在。
   *
   * @param sessionId - 需要确认的会话标识。
   * @param agentId - 会话必须归属的 Agent 标识。
   * @returns 对应的会话摘要。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private assertKnownSession(
    sessionId: string,
    agentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): AgentSessionSummary {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }

    if (session.agentId !== agentId) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `会话 ${sessionId} 不属于 Agent ${agentId}。`,
        recoverable: true,
      })
    }

    return session
  }

  /**
   * 向本地 transcript 追加一条标准消息。
   *
   * @param input - 消息归属、角色和文本内容。
   * @returns 已写入本地 transcript 的标准消息。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private appendMessage(input: {
    agentId: AgentId
    sessionId: string
    role: AgentMessage['role']
    content: string
  }): AgentMessage {
    this.assertKnownSession(input.sessionId, input.agentId)

    const messages = this.messages.get(input.sessionId) ?? []
    const message: AgentMessage = {
      messageId: `${input.sessionId}-message-${messages.length + 1}`,
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: this.now(),
    }
    this.messages.set(input.sessionId, [...messages, message])

    return message
  }

  /**
   * 为指定会话创建单次运行标识。
   *
   * @param sessionId - 需要开始运行的会话标识。
   * @returns 当前会话下递增且稳定的运行标识。
   * @throws 此方法不会主动抛出错误。
   */
  private createRunId(sessionId: string): string {
    const nextSequence = (this.runSequenceBySession.get(sessionId) ?? 0) + 1
    this.runSequenceBySession.set(sessionId, nextSequence)

    return `${sessionId}-run-${nextSequence}`
  }

  /**
   * 把 Agent 文本增量拼接到指定消息。
   *
   * @param messageId - 需要更新的消息标识。
   * @param delta - 本次新增的文本片段。
   * @returns 更新后的 Agent 消息。
   * @throws 当消息不存在时抛出 AgentRuntimeError。
   */
  private appendMessageDelta(messageId: string, delta: string): AgentMessage {
    for (const [sessionId, messages] of this.messages) {
      const messageIndex = messages.findIndex(
        (message) => message.messageId === messageId,
      )

      if (messageIndex === -1) {
        continue
      }

      const currentMessage = messages[messageIndex]

      if (!currentMessage) {
        break
      }

      const nextMessage = {
        ...currentMessage,
        content: `${currentMessage.content}${delta}`,
      }
      const nextMessages = [...messages]
      nextMessages[messageIndex] = nextMessage
      this.messages.set(sessionId, nextMessages)

      return nextMessage
    }

    throw new AgentRuntimeError({
      code: 'session-not-found',
      message: `找不到消息 ${messageId}。`,
      recoverable: true,
    })
  }

  /**
   * 读取已经完成流式拼接的 Agent 消息。
   *
   * @param messageId - 需要读取的消息标识。
   * @returns 完成后的 Agent 消息。
   * @throws 当消息不存在时抛出 AgentRuntimeError。
   */
  private completeMessage(messageId: string): AgentMessage {
    for (const messages of this.messages.values()) {
      const message = messages.find(
        (candidate) => candidate.messageId === messageId,
      )

      if (message) {
        return message
      }
    }

    throw new AgentRuntimeError({
      code: 'session-not-found',
      message: `找不到消息 ${messageId}。`,
      recoverable: true,
    })
  }

  /**
   * 当指定消息仍为空时从 transcript 中移除。
   *
   * @param messageId - 需要按需移除的消息标识。
   * @returns 如果移除了空消息则返回 true，否则返回 false。
   * @throws 此方法不会主动抛出错误。
   */
  private removeMessageIfEmpty(messageId: string): boolean {
    for (const [sessionId, messages] of this.messages) {
      const message = messages.find(
        (candidate) => candidate.messageId === messageId,
      )

      if (!message || message.content) {
        continue
      }

      this.messages.set(
        sessionId,
        messages.filter((candidate) => candidate.messageId !== messageId),
      )

      return true
    }

    return false
  }

  /**
   * 更新会话运行状态并广播状态事件。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param state - 新的运行状态。
   * @returns 更新后的会话摘要。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private updateSessionState(
    sessionId: string,
    state: AgentRunState,
  ): AgentSessionSummary {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }

    const nextSession = {
      ...session,
      state,
      updatedAt: this.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.emit({
      type: 'run-state-changed',
      agentId: nextSession.agentId,
      sessionId,
      state,
      occurredAt: this.now(),
    })

    return nextSession
  }

  /**
   * 向当前订阅者广播标准事件。
   *
   * @param event - 需要广播的标准 Agent 事件。
   * @returns 无返回值。
   * @throws 订阅者回调抛出的错误会透传给调用方。
   */
  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

/**
 * 生产环境使用的 Pi SDK 网关。
 */
class RealPiSdkGateway implements PiSdkGateway {
  /**
   * 读取 Pi SDK ModelRegistry 中的 Provider 和 Model。
   *
   * @returns Provider 和模型描述列表。
   * @throws 当 SDK 模块加载或模型注册表读取失败时，Promise 会 reject。
   */
  async listProvidersAndModels(): Promise<PiSdkRuntimeResources> {
    const { AuthStorage, ModelRegistry } =
      await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const rawModels = modelRegistry.getAll()
    const modelIndex = new Map<string, (typeof rawModels)[number]>()
    for (const model of rawModels) {
      const key = `${model.provider}:${model.id}`
      if (!modelIndex.has(key)) {
        modelIndex.set(key, model)
      }
    }
    const models = [...modelIndex.values()]
    const providerIds = [
      ...new Set(models.map((model) => model.provider)),
    ].sort()

    return {
      providers: providerIds.map((providerId) => ({
        providerId,
        displayName: modelRegistry.getProviderDisplayName(providerId),
      })),
      models: models.map((model) => ({
        providerId: model.provider,
        modelId: model.id,
        displayName: model.name ?? model.id,
      })),
    }
  }

  /**
   * 使用 Pi SDK 临时 session 验证运行时配置。
   *
   * @param request - Provider、Model、API Key、固定 prompt 和取消信号。
   * @returns 无返回值。
   * @throws 当 SDK 调用失败、模型不存在或取消信号触发时，Promise 会 reject。
   */
  async verifyConfiguration(request: PiSdkVerificationRequest): Promise<void> {
    const { AuthStorage, ModelRegistry, SessionManager, createAgentSession } =
      await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(request.providerId, request.apiKey)

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.find(request.providerId, request.modelId)

    if (!model) {
      throw new Error(`找不到模型 ${request.providerId}/${request.modelId}`)
    }

    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      model,
      sessionManager: SessionManager.inMemory(),
      noTools: 'all',
    })

    const abortSession = (): void => {
      void session.abort()
    }

    request.signal.addEventListener('abort', abortSession, { once: true })

    try {
      if (request.signal.aborted) {
        await session.abort()
        throw new DOMException('Aborted', 'AbortError')
      }

      await session.prompt(request.prompt)
    } finally {
      request.signal.removeEventListener('abort', abortSession)
      session.dispose()
    }
  }

  /**
   * 创建真实 Pi SDK 会话运行器。
   *
   * @param request - 已验证配置、会话标识和 Agent Home 工作目录。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或会话创建失败时，Promise 会 reject。
   */
  async createSession(
    request: PiSdkCreateSessionRequest,
  ): Promise<PiSdkSessionHandle> {
    return this.createSessionHandleFromRequest(request, 'create')
  }

  /**
   * 打开已有 Pi SDK 会话运行器。
   *
   * @param request - 已验证配置、会话标识、SDK session 文件和 Agent Home 工作目录。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或会话打开失败时，Promise 会 reject。
   */
  async openSession(
    request: PiSdkOpenSessionRequest,
  ): Promise<PiSdkSessionHandle> {
    return this.createSessionHandleFromRequest(request, 'open')
  }

  /**
   * 从 Pi SDK 原生 session 目录列出可恢复的会话。
   *
   * @param request - Agent Home 工作目录和 SDK session 目录。
   * @returns SDK session 摘要列表。
   * @throws 当 SDK session 目录读取失败时，Promise 会 reject。
   */
  async listSessions(
    request: PiSdkListSessionsRequest,
  ): Promise<PiSdkStoredSession[]> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessions = await SessionManager.list(request.cwd, request.sessionDir)

    return sessions.map((session) => ({
      sessionId: session.id,
      sdkSessionFile: session.path,
      title: (session.name ?? session.firstMessage) || session.id,
      createdAt: session.created.toISOString(),
      updatedAt: session.modified.toISOString(),
    }))
  }

  /**
   * 从 Pi SDK 原生 session 文件读取 transcript 消息。
   *
   * @param request - 会话标识和 SDK session 文件。
   * @returns 转换后的汤圆标准消息列表。
   * @throws 当 SDK session 文件无法打开或读取时，Promise 会 reject。
   */
  async readMessages(
    request: PiSdkReadMessagesRequest,
  ): Promise<AgentMessage[]> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessionManager = SessionManager.open(
      request.sdkSessionFile,
      dirname(request.sdkSessionFile),
    )

    return sessionManager
      .getEntries()
      .flatMap((entry: unknown) =>
        mapPiSdkSessionEntryToAgentMessage(entry, request.sessionId),
      )
  }

  /**
   * 根据请求创建或打开 Pi SDK session，并包装成 Driver 使用的 handle。
   *
   * @param request - 已验证配置、会话标识、SDK session 文件和 Agent Home 工作目录。
   * @param mode - create 表示新建带固定 id 的 session，open 表示打开已有文件。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或 session 打开失败时，Promise 会 reject。
   */
  private async createSessionHandleFromRequest(
    request: PiSdkCreateSessionRequest | PiSdkOpenSessionRequest,
    mode: 'create' | 'open',
  ): Promise<PiSdkSessionHandle> {
    const {
      AuthStorage,
      ModelRegistry,
      SessionManager,
      createAgentSession,
      DefaultResourceLoader,
    } = await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(request.providerId, request.apiKey)

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.find(request.providerId, request.modelId)

    if (!model) {
      throw new Error(`找不到模型 ${request.providerId}/${request.modelId}`)
    }

    const sessionManager =
      mode === 'create'
        ? SessionManager.create(request.cwd, dirname(request.sdkSessionFile), {
            id: request.sessionId,
          })
        : SessionManager.open(
            request.sdkSessionFile,
            dirname(request.sdkSessionFile),
            request.cwd,
          )

    // 为当前 Agent session 创建受控 ResourceLoader：
    // - 关闭 Pi 默认 Skill 自动发现（noSkills: true）
    // - 只加载 Agent 专属和共享两层 Skill 目录
    // - Agent 专属目录排第一以实现同名覆盖（Pi first-wins）
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.cwd,
      agentDir: dirname(request.agentSkillsPath), // Agent home 目录
      noSkills: true,
      additionalSkillPaths: [request.agentSkillsPath, request.sharedSkillsPath],
    })
    await resourceLoader.reload()

    const customTools: Array<Record<string, unknown>> = []

    if ('onCreateAgent' in request && request.onCreateAgent) {
      const onCreateAgent = request.onCreateAgent
      customTools.push({
        name: 'create_agent',
        label: '创建 Agent',
        description:
          '创建一个新的 Agent。新 Agent 将继承当前 Provider 和 Model，拥有独立的工作空间和身份文件。调用前必须确认已从用户处收集到 displayName。信息不足时应继续询问用户。',
        promptSnippet: 'create_agent(displayName: string) → 创建新 Agent',
        promptGuidelines: [
          '创建 Agent 前应确认 displayName 已从用户处收集',
          '信息不足时应继续询问用户后再调用此工具',
          '创建完成后告知用户新 Agent 的 ID 和名称',
        ],
        parameters: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1 },
          },
          required: ['displayName'],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: { displayName: string }) {
          const result = await onCreateAgent(params.displayName)
          return {
            content: [
              {
                type: 'text',
                text: `已创建 Agent「${result.displayName}」（ID: ${result.agentId}）。用户可以在 Agent 列表中切换到新 Agent 开始对话。`,
              },
            ],
          }
        },
      })
    }

    // 注册带审批和路径保护的自定义工具
    const approvalGateway = request.toolApprovalGateway
    if (approvalGateway) {
      const approvalRunContext = {
        agentId: request.sessionId ? '' : '',
        sessionId: request.sessionId,
        cwd: request.cwd,
      }

      // 自定义 bash 工具（带审批）
      customTools.push({
        name: 'bash',
        label: '运行命令（需审批）',
        description:
          '在当前工作目录中执行 bash 命令。每次执行前需要用户审批。命令将以当前 macOS 用户权限运行。',
        promptSnippet: 'bash(command: string) → 执行 bash 命令',
        promptGuidelines: [
          '执行前会请求用户审批，仅本次有效',
          '命令将以当前 macOS 用户权限执行',
          '如果用户拒绝，命令不会执行',
        ],
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', minLength: 1 },
          },
          required: ['command'],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: { command: string }) {
          const riskDescription = describeBashRisk(params.command)
          const result = await approvalGateway.requestBashApproval({
            agentId: approvalRunContext.agentId || 'tangyuan',
            sessionId: approvalRunContext.sessionId,
            runId: '',
            command: params.command,
            cwd: approvalRunContext.cwd,
            riskDescription,
          })

          if (!result.approved) {
            return {
              content: [
                {
                  type: 'text',
                  text: '用户拒绝了此命令的执行。',
                },
              ],
            }
          }

          // 批准后执行命令
          try {
            const { exec } = await import('node:child_process')
            const { promisify } = await import('node:util')
            const execAsync = promisify(exec)
            const { stdout, stderr } = await execAsync(params.command, {
              cwd: approvalRunContext.cwd,
              timeout: 120_000,
            })
            return {
              content: [
                {
                  type: 'text',
                  text: stdout + (stderr ? `\nstderr:\n${stderr}` : ''),
                },
              ],
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : '命令执行失败'
            return {
              content: [
                {
                  type: 'text',
                  text: `命令执行失败：${message}`,
                },
              ],
            }
          }
        },
      })
    }

    // 使用 excludedToolNames 排除内置工具（当存在审批网关时由自定义工具接管）
    const excludedToolNames: string[] = []
    if (approvalGateway) {
      excludedToolNames.push('bash')
    }

    const { session } = await createAgentSession({
      cwd: request.cwd,
      authStorage,
      modelRegistry,
      model,
      sessionManager,
      resourceLoader,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom tools use simplified execute signatures
      customTools: customTools.length > 0 ? (customTools as any) : undefined,
      ...(excludedToolNames.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mapping to Pi SDK's excludeTools option
          { excludedToolNames: excludedToolNames as any }
        : {}),
    })

    return {
      sdkSessionFile: sessionManager.getSessionFile() ?? request.sdkSessionFile,
      prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
        const unsubscribe = session.subscribe((event: unknown) => {
          for (const streamEvent of normalizePiSdkSessionEvent(event)) {
            options?.onEvent?.(streamEvent)
          }
        })

        try {
          await session.prompt(prompt)
          return session.getLastAssistantText() ?? null
        } finally {
          unsubscribe()
        }
      },
      abort: async () => {
        await session.abort()
      },
      dispose: () => {
        session.dispose()
      },
      setModel: async (
        providerId: string,
        modelId: string,
        apiKey?: string,
      ) => {
        if (apiKey) {
          authStorage.setRuntimeApiKey(providerId, apiKey)
        }

        const newModel = modelRegistry.find(providerId, modelId)

        if (!newModel) {
          throw new Error(`找不到模型 ${providerId}/${modelId}`)
        }

        await session.setModel(newModel)
      },
      setThinkingLevel: async (level: string) => {
        // ThinkingLevel 类型来自 @earendil-works/pi-agent-core:
        // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
        session.setThinkingLevel(
          level as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
        )
      },
      getModelInfo: async () => {
        const currentModel = session.model
        const thinkingLevel = session.thinkingLevel
        const supportsThinking = session.supportsThinking()
        const supportedThinkingLevels = supportsThinking
          ? session.getAvailableThinkingLevels()
          : []

        return {
          providerId: currentModel?.provider ?? '',
          modelId: currentModel?.id ?? '',
          displayName: currentModel?.name ?? currentModel?.id ?? '',
          thinkingLevel: supportsThinking ? thinkingLevel : null,
          supportedThinkingLevels,
          supportsThinking,
        }
      },
      reload: async () => {
        await resourceLoader.reload()
        // session.reload() 重建系统提示词，使 Skill 变更立即生效
        if (
          typeof (session as { reload?: () => Promise<void> }).reload ===
          'function'
        ) {
          await (session as { reload: () => Promise<void> }).reload()
        }
      },
    }
  }
}

/**
 * 将 Pi SDK session entry 转成汤圆标准消息。
 *
 * @param entry - Pi SDK SessionManager 返回的未知 entry。
 * @param sessionId - 当前汤圆会话标识。
 * @returns 可展示消息；不是 message entry 时返回空数组。
 * @throws 此方法不会主动抛出错误。
 */
function mapPiSdkSessionEntryToAgentMessage(
  entry: unknown,
  sessionId: string,
): AgentMessage[] {
  const candidate = entry as {
    type?: unknown
    id?: unknown
    timestamp?: unknown
    message?: {
      role?: unknown
      content?: unknown
    }
  }

  if (candidate.type !== 'message' || !candidate.message) {
    return []
  }

  const role = mapPiSdkMessageRole(candidate.message.role)
  const content = stringifyPiSdkMessageContent(candidate.message.content)

  if (!content) {
    return []
  }

  return [
    {
      messageId:
        typeof candidate.id === 'string'
          ? candidate.id
          : `${sessionId}-sdk-message-${content.length}`,
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId,
      role,
      content,
      createdAt:
        typeof candidate.timestamp === 'string'
          ? candidate.timestamp
          : new Date(0).toISOString(),
    },
  ]
}

/**
 * 将 Pi SDK 消息角色映射成汤圆标准角色。
 *
 * @param role - SDK 消息里的未知角色值。
 * @returns 汤圆 transcript 使用的消息角色。
 * @throws 此方法不会主动抛出错误。
 */
function mapPiSdkMessageRole(role: unknown): AgentMessage['role'] {
  if (role === 'user') {
    return 'user'
  }

  if (role === 'assistant') {
    return 'agent'
  }

  return 'system'
}

/**
 * 将 Pi SDK 消息内容压成 Renderer 可展示的纯文本。
 *
 * @param content - SDK 消息里的未知 content 值。
 * @returns 可展示的纯文本内容。
 * @throws 此方法不会主动抛出错误。
 */
function stringifyPiSdkMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * 判断错误是否来自 AbortController 取消。
 *
 * @param error - 捕获到的未知错误。
 * @returns 如果是取消错误则返回 true。
 * @throws 此方法不会主动抛出错误。
 */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

/**
 * 把错误消息转换成不含 API Key 的用户可读文案。
 *
 * @param error - 捕获到的未知错误。
 * @param apiKey - 需要从消息中移除的原始 API Key；非配置错误可省略。
 * @returns 脱敏后的错误消息。
 * @throws 此方法不会主动抛出错误。
 */
function sanitizeErrorMessage(error: unknown, apiKey?: string): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '请检查 Provider、Model 和 API Key 后重试。'
  const redactedMessage = apiKey
    ? rawMessage.split(apiKey).join('[API Key 已隐藏]')
    : rawMessage

  return redactedMessage || '请检查 Provider、Model 和 API Key 后重试。'
}

/**
 * 把 Pi SDK 流式事件转换成 Renderer 可展示的简略活动。
 *
 * @param event - Pi SDK 网关产出的最小流式事件。
 * @returns 不包含原始参数和 JSON 的活动摘要。
 * @throws 此方法不会主动抛出错误。
 */
function mapPiSdkStreamEventToActivity(event: PiSdkStreamEvent) {
  if (event.type === 'text-delta') {
    return {
      kind: 'thinking' as const,
      state: 'running' as const,
      label: '思考中',
    }
  }

  if (event.type === 'thinking-started') {
    return {
      kind: 'thinking' as const,
      state: 'running' as const,
      label: '思考中',
    }
  }

  if (event.type === 'tool-started') {
    return {
      kind: 'tool' as const,
      state: 'running' as const,
      label: createToolActivityLabel(event.toolName, 'running'),
    }
  }

  if (event.type === 'tool-completed') {
    return {
      kind: 'tool' as const,
      state: 'completed' as const,
      label: createToolActivityLabel(event.toolName, 'completed'),
    }
  }

  return {
    kind: 'tool' as const,
    state: 'failed' as const,
    label: createToolActivityLabel(event.toolName, 'failed'),
  }
}

/**
 * 根据工具名生成不含参数的中文活动文案。
 *
 * @param toolName - Pi SDK 报告的工具名。
 * @param state - 工具执行状态。
 * @returns 可展示给用户的简略工具状态。
 * @throws 此方法不会主动抛出错误。
 */
function createToolActivityLabel(
  toolName: string,
  state: 'running' | 'completed' | 'failed',
): string {
  if (state === 'failed') {
    return '工具失败'
  }

  if (state === 'completed') {
    return '工具完成'
  }

  const labels: Record<string, string> = {
    read: '正在读取文件',
    write: '正在写入文件',
    edit: '正在编辑文件',
    bash: '正在运行命令',
    search: '正在搜索',
  }

  return labels[toolName] ?? '正在使用工具'
}

/**
 * 把真实 Pi SDK session 事件宽松解析成 v1 所需的最小流式事件。
 *
 * @param event - SDK subscribe 回调收到的未知事件对象。
 * @returns 一个或多个可映射到汤圆事件的最小流式事件。
 * @throws 此方法不会主动抛出错误。
 */
function normalizePiSdkSessionEvent(event: unknown): PiSdkStreamEvent[] {
  if (!isRecord(event)) {
    return []
  }

  if (
    event.type === 'message_update' &&
    isRecord(event.assistantMessageEvent)
  ) {
    const assistantEvent = event.assistantMessageEvent

    if (
      assistantEvent.type === 'text_delta' &&
      typeof assistantEvent.delta === 'string'
    ) {
      return [{ type: 'text-delta', delta: assistantEvent.delta }]
    }

    if (
      assistantEvent.type === 'thinking_start' ||
      assistantEvent.type === 'thinking_delta'
    ) {
      return [{ type: 'thinking-started' }]
    }
  }

  if (
    event.type === 'tool_execution_start' &&
    typeof event.toolName === 'string'
  ) {
    const toolInput = isRecord(event.toolInput)
      ? event.toolInput
      : isRecord(event.input)
        ? event.input
        : undefined
    return [
      {
        type: 'tool-started' as const,
        toolName: event.toolName,
        ...(toolInput !== undefined ? { toolInput } : {}),
      },
    ]
  }

  if (
    event.type === 'tool_execution_end' &&
    typeof event.toolName === 'string'
  ) {
    return [
      {
        type: event.isError ? 'tool-failed' : 'tool-completed',
        toolName: event.toolName,
      },
    ]
  }

  return []
}

/**
 * 判断未知值是否是可读取字段的普通对象。
 *
 * @param value - 需要判断的未知值。
 * @returns 如果值是非 null 对象则返回 true。
 * @throws 此方法不会主动抛出错误。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 分析 bash 命令的风险等级并生成中文风险说明。
 *
 * @param command - 待执行的 bash 命令。
 * @returns 面向用户的中文风险说明。
 * @throws 此方法不会主动抛出错误。
 */
function describeBashRisk(command: string): string {
  const highRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\s+-rf\b/, label: '递归强制删除' },
    { pattern: /\bsudo\b/, label: '提权操作' },
    { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bdd\s+if=/, label: '磁盘直接写入' },
    { pattern: /\bmkfs\b/, label: '格式化文件系统' },
    { pattern: />\s*\/dev\//, label: '设备文件写入' },
    { pattern: /\bchmod\s+777/, label: '危险权限修改' },
    { pattern: /\bpasswd\b/, label: '密码修改' },
  ]

  const mediumRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\b/, label: '删除文件' },
    { pattern: /\bmv\b/, label: '移动/重命名文件' },
    { pattern: /\bchmod\b/, label: '修改权限' },
    { pattern: /\bchown\b/, label: '修改所有者' },
    { pattern: /\bkill\b/, label: '终止进程' },
    { pattern: /\bpkill\b/, label: '终止进程' },
    { pattern: /\bnpm\s+(install|uninstall)\b.*-g/, label: '全局包管理' },
    { pattern: /\bpip\s+install\b/, label: 'Python 包安装' },
    { pattern: /\bgit\s+push\b.*--force/, label: '强制推送' },
  ]

  const highHits = highRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  const mediumHits = mediumRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  if (highHits.length > 0) {
    return `高风险命令：${highHits.join('、')}。命令将以当前 macOS 用户权限执行，可能造成不可逆的系统影响。`
  }

  if (mediumHits.length > 0) {
    return `中风险命令：${mediumHits.join('、')}。命令将以当前 macOS 用户权限执行，请确认操作意图。`
  }

  return `命令将以当前 macOS 用户权限执行。`
}
