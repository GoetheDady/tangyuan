/* eslint-disable max-lines -- TODO: 按职责拆分为 session-driver / gateway / transcript 等模块 */
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  TurnStartEvent as PiSdkTurnStartEvent,
  TurnEndEvent as PiSdkTurnEndEvent,
} from '@earendil-works/pi-coding-agent'
import {
  createTangyuanRuntimeForTesting,
  type TangyuanRuntime,
} from './TangyuanRuntime'
import { RealPiSdkGateway } from './gateway'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
import { AgentRegistry } from './agent-registry'
import { SkillStore } from './skill-store'
import { AgentRuntimeError } from './errors'
import {
  isAbortError,
  mapPiSdkStreamEventToActivity,
  sanitizeErrorMessage,
  normalizeRuntimeConfiguration,
  buildInternalConfigForSave,
  extractAgentRuntimeConfig,
  pathExists,
  safeReadFile,
  readDirectoryFileSet,
  fileHasContent,
  getMtimeIso,
  isNotFoundError,
} from './utils'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createRuntimeSnapshot,
  type AgentConfig,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type ConfigEncryptionAdapter,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderAuthSnapshot,
  type ProfileMaintenanceResult,
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
  type TranscriptSnapshot,
  type UserProfileContent,
} from '@tangyuan/contracts'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
  applyTranscriptDelta,
  createAgentProfileStatus,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
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
      requestClarification: (params) => {
        if (!gatewayInstance) {
          return Promise.resolve({ answer: '' })
        }
        return gatewayInstance.requestClarification(params)
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

  /**
   * 请求用户回答一个问题澄清。
   *
   * @param params - 澄清所需上下文（Agent、session、run、问题、选项、是否允许自定义答案）。
   * @returns 用户回答后 resolve `{ answer: string }`，取消后 answer 为空字符串。
   * @throws 此方法不会主动抛出错误。
   */
  requestClarification(params: {
    agentId: string
    sessionId: string
    runId: string
    question: string
    options: string[]
    allowCustomAnswer: boolean
  }): Promise<{ answer: string }>
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
      type: 'thinking-delta'
      delta: string
    }
  | {
      type: 'tool-started'
      toolName: string
      toolCallId?: string
      toolInput?: unknown
    }
  | {
      type: 'tool-completed'
      toolName: string
      toolCallId?: string
    }
  | {
      type: 'tool-failed'
      toolName: string
      toolCallId?: string
    }
  | {
      // SDK 原生 `turn_start`：标志一个真实回合开始。核心 subscribe 事件
      // 不携 turnIndex，turnIndex 由 Runtime 在 prompt 循环内维护。
      type: 'turn-started'
    }
  | {
      // SDK 原生 `turn_end`：携带本回合完整的 assistant message 与 toolResults。
      type: 'turn-ended'
      message: Extract<PiSdkTurnEndEvent['message'], { role: 'assistant' }>
      toolResults: PiSdkTurnEndEvent['toolResults']
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
   * @param prompt - 用户输入原文（身份上下文由系统提示词承载，不再拼入）。
   * @param options - 可选流式事件回调。
   * @returns Agent 最后一条文本回复；没有文本回复时返回 null。
   * @throws 当 SDK 调用失败时，Promise 会 reject。
   */
  prompt(prompt: string, options?: PiSdkPromptOptions): Promise<string | null>

  /**
   * 设置追加到系统提示词末尾的身份上下文片段。
   *
   * @remarks 仅记录片段；需要随后调用 {@link reload} 才会生效。
   *   传入空串或省略即清除已注入的身份上下文。
   * @param context - 身份上下文片段（soul/user 或 bootstrap）。
   * @returns 无返回值。
   */
  setSystemPromptContext?(context: string): void

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
   * 从 Pi SDK 原生 session 文件读取结构化会话快照。
   *
   * 只生成结构化会话事实（TranscriptEntry）；不再把 tool result、
   * compaction 或未知 SDK 条目压成容易误用的普通字符串消息。
   *
   * @param request - 会话标识和 SDK session 文件。
   * @returns 结构化会话快照。
   * @throws 当 SDK session 文件无法读取或解析时，Promise 会 reject。
   */
  readMessages(request: PiSdkReadMessagesRequest): Promise<TranscriptSnapshot>
}

/**
 * 描述汤圆写入 userData/sessions/index.json 的单个会话索引条目。
 */
/**
 * 描述持久化到 session 索引的单条执行尝试。
 *
 * 在会话重建时用于还原每个 AgentReplyEntry 的 attempt 状态。
 */
export interface PersistedAttemptEntry {
  attemptId: string
  runId: string
  /** 该尝试对应的 Agent 消息标识。 */
  messageId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  startedAt: string
  completedAt: string | null
  error?: import('@tangyuan/contracts').AgentRuntimeErrorPayload
  /** 关联的用户消息标识；重试场景的 inReplyTo。 */
  inReplyTo?: string
}

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
 * 创建 AgentRuntimeError 时使用的输入与错误类（定义见 errors.ts）。
 */
export type { AgentRuntimeErrorInput } from './errors'
export { AgentRuntimeError } from './errors'

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
   * 读取指定会话的结构化 transcript 快照。
   *
   * @param request - 会话定位信息。
   * @returns 结构化会话快照。
   * @throws 当会话不存在或读取失败时，Promise 会 reject。
   */
  getTranscript(request: GetSessionMessagesRequest): Promise<TranscriptSnapshot>

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
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * 不会追加重复的 UserMessage，而是创建新的 InternalMessage 和
   * ExecutionAttempt，通过 AgentEvent 推送运行进度。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  retryMessage?(
    request: import('@tangyuan/contracts').RetryRunRequest,
  ): Promise<void>

  /**
   * 读取指定会话的持久化执行尝试记录，用于会话重建。
   *
   * @param sessionId - 会话标识。
   * @returns 持久化的执行尝试记录列表。
   * @throws 此方法不会主动抛出错误。
   */
  getSessionAttempts?(sessionId: string): PersistedAttemptEntry[]

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
 * Driver 内部使用的消息类型，替代已删除的公开 InternalMessage 契约。
 * 仅在 PiSdkDriver 内部使用，不暴露给 Runtime 或 Renderer。
 */
export interface InternalMessage {
  messageId: string
  agentId: string
  sessionId: string
  role: 'user' | 'agent' | 'system' | 'compaction'
  content: string
  createdAt: string
}

/**
 * Driver 内部使用的扩展事件类型，包含 translate-delta 生成所需
 * 但不在公开 AgentEvent 中的过渡事件。
 */
export type DriverEvent = AgentEvent | {
  type: 'message-appended'
  agentId: string
  message: InternalMessage
  inReplyTo?: string
  occurredAt: string
} | {
  type: 'message-delta'
  agentId: string
  sessionId: string
  runId: string
  messageId: string
  delta: string
  deltaKind?: 'text' | 'thinking'
  occurredAt: string
} | {
  type: 'message-completed'
  agentId: string
  sessionId: string
  runId: string
  message: InternalMessage
  occurredAt: string
} | {
  type: 'activity-updated'
  agentId: string
  sessionId: string
  runId: string
  activity: { kind: 'thinking' | 'tool'; state: 'running' | 'completed' | 'failed'; label: string; toolCallId?: string; toolName?: string }
  occurredAt: string
} | {
  // 对应 SDK 原生 `turn_start`，界定一个真实回合的开始。
  // 携带 SDK 权威 `turnIndex`（agent_start 归零，每个 turn_end 后递增）。
  // 仅 Runtime 内部使用，不跨 IPC 暴露给 Renderer。
  type: 'turn-started'
  agentId: string
  sessionId: string
  runId: string
  turnIndex: PiSdkTurnStartEvent['turnIndex']
  occurredAt: string
} | {
  // 对应 SDK 原生 `turn_end`，携带本回合完整的 assistant message
  // 与 toolResults，与历史 session 文件中持久化的 AssistantMessage 同构。
  // 仅 Runtime 内部使用，不跨 IPC 暴露给 Renderer。
  type: 'turn-ended'
  agentId: string
  sessionId: string
  runId: string
  turnIndex: PiSdkTurnEndEvent['turnIndex']
  message: Extract<PiSdkTurnEndEvent['message'], { role: 'assistant' }>
  toolResults: PiSdkTurnEndEvent['toolResults']
  occurredAt: string
}

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver implements AgentSessionDriver, RuntimeResourceDriver {
  private readonly now: () => string
  private readonly agentHomePath: string
  private readonly fsRoot: string
  private readonly userDataPath: string
  private readonly layout: DirectoryLayout
  private readonly configStore: ConfigStore
  private readonly agentRegistry: AgentRegistry
  private readonly skillStore: SkillStore
  private readonly gateway: PiSdkGateway
  private readonly encryptionAdapter: ConfigEncryptionAdapter | null
  private readonly listeners = new Set<AgentEventListener>()
  private readonly sessions = new Map<string, AgentSessionSummary>()
  private readonly sessionIndex = new Map<string, PersistedSessionIndexEntry>()
  private readonly messages = new Map<string, InternalMessage[]>()
  private readonly transcriptCache = new Map<string, TranscriptSnapshot>()
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
    this.layout = new DirectoryLayout({
      agentHomePath: this.agentHomePath,
      fsRoot: this.fsRoot,
      userDataPath: this.userDataPath,
    })
    this.gateway = options.gateway ?? new RealPiSdkGateway()
    this.encryptionAdapter = options.encryptionAdapter ?? null
    this.configStore = new ConfigStore({
      layout: this.layout,
      encryptionAdapter: this.encryptionAdapter,
      now: this.now,
    })
    this.agentRegistry = new AgentRegistry({
      layout: this.layout,
      configStore: this.configStore,
      now: this.now,
      emit: (event) => this.emit(event),
      agentHomePath: this.agentHomePath,
    })
    this.skillStore = new SkillStore({
      layout: this.layout,
      now: this.now,
    })
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
      normalizeRuntimeConfiguration(configuration)
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

    const readResult = await this.configStore.read()
    const internalConfig = buildInternalConfigForSave(
      readResult.config,
      normalizedConfiguration,
      this.now(),
    )
    await this.configStore.write(internalConfig)
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
    const readResult = await this.configStore.read()

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
      this.configStore.readRequired(request.agentId),
      this.loadSessionIndex(),
    ])
    const sessionId = this.createNextSessionId()
    const now = this.now()
    const sdkSessionFile = this.layout.sdkSessionFile(sessionId)
    const cwd =
      request.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.layout.agentHome()
        : this.layout.workspace(request.agentId)
    await mkdir(dirname(sdkSessionFile), { recursive: true })
    const baseRequest = {
      ...configuration,
      sessionId,
      sdkSessionFile,
      cwd,
      agentSkillsPath: this.layout.agentSkills(request.agentId),
      sharedSkillsPath: this.layout.sharedSkills(),
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
    // 身份上下文走系统提示词：建会话时注入并 reload 使其生效。
    if (handle.setSystemPromptContext) {
      handle.setSystemPromptContext(
        await this.buildProfileSystemPromptContext(request.agentId),
      )
      await handle.reload?.()
    }
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
   * 读取指定会话的结构化 transcript 快照。
   *
   * @param request - 会话定位信息。
   * @returns 结构化会话快照。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot> {
    await this.ensureSessionLoaded(request.sessionId)
    this.assertKnownSession(request.sessionId, request.agentId)

    const cached = this.transcriptCache.get(request.sessionId)
    if (cached && cached.entries.length > 0) {
      return cached
    }

    await this.ensureSessionHandle(request.sessionId)
    const indexEntry = this.getKnownSessionIndexEntry(request.sessionId)
    const snapshot = await this.gateway.readMessages({
      sessionId: request.sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
    })

    // 填充持久化的 attempt 数据
    const attempts = this.getSessionAttempts(request.sessionId)
    const enriched = this.enrichTranscriptWithAttempts(snapshot, attempts)
    this.transcriptCache.set(request.sessionId, enriched)

    return enriched
  }

  /**
   * 读取指定会话的持久化执行尝试记录。
   */
  getSessionAttempts(sessionId: string): PersistedAttemptEntry[] {
    const entry = this.sessionIndex.get(sessionId)
    return entry?.attempts ?? []
  }

  /**
   * 将持久化 attempt 记录填充到 transcript 快照中。
   */
  private enrichTranscriptWithAttempts(
    snapshot: TranscriptSnapshot,
    attempts: PersistedAttemptEntry[],
  ): TranscriptSnapshot {
    if (attempts.length === 0) return snapshot

    const attemptByMessageId = new Map(attempts.map((a) => [a.messageId, a]))
    const enrichedEntries = snapshot.entries.map((entry) => {
      if (entry.kind !== 'agent-reply') return entry
      const persisted = attemptByMessageId.get(entry.messageId)
      if (!persisted) return entry
      return {
        ...entry,
        attempt: {
          attemptId: persisted.attemptId,
          runId: persisted.runId,
          status: persisted.status,
          startedAt: persisted.startedAt,
          completedAt: persisted.completedAt,
          ...(persisted.error ? { error: persisted.error } : {}),
        },
        turns: entry.turns.map((turn) => ({
          ...turn,
          runId: persisted.runId,
        })),
        ...(persisted.inReplyTo ? { inReplyTo: persisted.inReplyTo } : {}),
      }
    })

    return { ...snapshot, entries: enrichedEntries }
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
      type: 'attempt-started',
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      occurredAt: this.now(),
    })
    // 持久化执行尝试记录（运行中状态）
    await this.upsertAttemptInIndex(request.sessionId, {
      attemptId: runId,
      runId,
      messageId: agentMessage.messageId,
      status: 'running',
      startedAt: this.now(),
      completedAt: null,
    })

    try {
      const profileStatusBeforeRun = await this.ensureDefaultAgentHome()
      let accumulatedReply = ''
      let turnIndex = 0
      // 惰性宣告：收到第一个真实内容事件时才 emit agent message-appended，
      // 使运行期 delta 能挂到条目上；若未产生任何内容（如立即取消）则不建空条目。
      let agentEntryAnnounced = false
      const announceAgentEntry = (): void => {
        if (agentEntryAnnounced) return
        agentEntryAnnounced = true
        this.emit({
          type: 'message-appended',
          agentId: request.agentId,
          message: agentMessage,
          occurredAt: this.now(),
        })
      }
      const agentReply = await handle.prompt(content, {
        onEvent: (event) => {
          if (event.type === 'thinking-started') {
            announceAgentEntry()
            this.emit({
              type: 'activity-updated',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              activity: mapPiSdkStreamEventToActivity(event),
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'thinking-delta') {
            announceAgentEntry()
            this.emit({
              type: 'message-delta',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              messageId: agentMessage.messageId,
              delta: event.delta,
              deltaKind: 'thinking',
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'text-delta') {
            announceAgentEntry()
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

          if (event.type === 'turn-started') {
            this.emit({
              type: 'turn-started',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              turnIndex,
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'turn-ended') {
            this.emit({
              type: 'turn-ended',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              turnIndex,
              message: event.message,
              toolResults: event.toolResults,
              occurredAt: this.now(),
            })
            turnIndex++
            return
          }

          // tool-started / tool-completed / tool-failed
          announceAgentEntry()
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
        await this.upsertAttemptInIndex(request.sessionId, {
          attemptId: runId,
          runId,
          messageId: agentMessage.messageId,
          status: 'cancelled',
          startedAt: this.now(),
          completedAt: this.now(),
        })
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

      // profile 变化点：本回合可能写入 soul/user 或完成 bootstrap，
      // 若状态发生变化则刷新系统提示词上下文。
      const profileStatusAfterRun = await this.ensureDefaultAgentHome()
      if (
        profileStatusAfterRun.initialized !==
          profileStatusBeforeRun.initialized ||
        profileStatusAfterRun.soulUpdatedAt !==
          profileStatusBeforeRun.soulUpdatedAt ||
        profileStatusAfterRun.userUpdatedAt !==
          profileStatusBeforeRun.userUpdatedAt
      ) {
        await this.refreshAgentProfileContext(request.agentId)
      }

      await this.upsertAttemptInIndex(request.sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'completed',
        startedAt: this.now(),
        completedAt: this.now(),
      })
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
      await this.upsertAttemptInIndex(request.sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'failed',
        startedAt: this.now(),
        completedAt: this.now(),
        error: runtimeError,
      })
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
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  async retryMessage(
    request: import('@tangyuan/contracts').RetryRunRequest,
  ): Promise<void> {
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

    // 从缓存中查找原始用户消息内容
    const messages = this.messages.get(request.sessionId) ?? []
    const userMessage = messages.find(
      (m) => m.messageId === request.userMessageId && m.role === 'user',
    )

    if (!userMessage) {
      // 尝试从 Pi SDK 加载
      const indexEntry = this.getKnownSessionIndexEntry(request.sessionId)
      const loadedMessages = await this.gateway.readMessages({
        sessionId: request.sessionId,
        sdkSessionFile: indexEntry.sdkSessionFile,
      })
      // 缓存 transcript 快照
      this.transcriptCache.set(request.sessionId, loadedMessages)
      const loadedUserMessage = loadedMessages.entries.find(
        (e) => e.kind === 'user-message' && e.messageId === request.userMessageId,
      )
      if (!loadedUserMessage || loadedUserMessage.kind !== 'user-message') {
        throw new AgentRuntimeError({
          code: 'session-not-found',
          message: '找不到要重试的原始用户消息。',
          recoverable: true,
        })
      }
      return this.executeRetry(
        request,
        loadedUserMessage.content,
        session,
        handle,
      )
    }

    return this.executeRetry(request, userMessage.content, session, handle)
  }

  /**
   * 执行重试核心逻辑：创建新 InternalMessage 和 ExecutionAttempt，
   * 发送与原始用户请求相同的 prompt。
   *
   * @param request - 重试请求。
   * @param content - 原始用户消息内容。
   * @param session - 已确认的会话摘要。
   * @param handle - Pi SDK 会话运行器。
   * @returns 无返回值。
   * @throws 当 SDK 调用失败时，Promise 会 reject。
   */
  private async executeRetry(
    request: import('@tangyuan/contracts').RetryRunRequest,
    content: string,
    session: AgentSessionSummary,
    handle: PiSdkSessionHandle | undefined,
  ): Promise<void> {
    if (!handle) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId} 的 Pi SDK 运行器。`,
        recoverable: true,
      })
    }

    if (!content.trim()) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '原始用户消息为空，无法重试。',
        recoverable: true,
      })
    }

    const runId = this.createRunId(request.sessionId)
    const now = this.now()

    // 创建新的 InternalMessage（不创建 UserMessage）
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
      updatedAt: now,
    })

    this.emit({
      type: 'attempt-started',
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      occurredAt: now,
    })

    try {
      const profileStatusBeforeRun = await this.ensureDefaultAgentHome()
      let accumulatedReply = ''
      let turnIndex = 0
      // 与主流程一致的惰性宣告：首个真实内容事件到达时才 emit agent message-appended。
      let agentEntryAnnounced = false
      const announceAgentEntry = (): void => {
        if (agentEntryAnnounced) return
        agentEntryAnnounced = true
        this.emit({
          type: 'message-appended',
          agentId: request.agentId,
          message: agentMessage,
          occurredAt: this.now(),
        })
      }

      const agentReply = await handle.prompt(content, {
        onEvent: (event) => {
          if (event.type === 'thinking-started') {
            announceAgentEntry()
            this.emit({
              type: 'activity-updated',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              activity: mapPiSdkStreamEventToActivity(event),
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'thinking-delta') {
            announceAgentEntry()
            this.emit({
              type: 'message-delta',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              messageId: agentMessage.messageId,
              delta: event.delta,
              deltaKind: 'thinking',
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'text-delta') {
            announceAgentEntry()
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

          if (event.type === 'turn-started') {
            this.emit({
              type: 'turn-started',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              turnIndex,
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'turn-ended') {
            this.emit({
              type: 'turn-ended',
              agentId: request.agentId,
              sessionId: request.sessionId,
              runId,
              turnIndex,
              message: event.message,
              toolResults: event.toolResults,
              occurredAt: this.now(),
            })
            turnIndex++
            return
          }

          announceAgentEntry()
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
        inReplyTo: request.userMessageId,
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

      // profile 变化点：本回合可能写入 soul/user 或完成 bootstrap，
      // 若状态发生变化则刷新系统提示词上下文。
      const profileStatusAfterRun = await this.ensureDefaultAgentHome()
      if (
        profileStatusAfterRun.initialized !==
          profileStatusBeforeRun.initialized ||
        profileStatusAfterRun.soulUpdatedAt !==
          profileStatusBeforeRun.soulUpdatedAt ||
        profileStatusAfterRun.userUpdatedAt !==
          profileStatusBeforeRun.userUpdatedAt
      ) {
        await this.refreshAgentProfileContext(request.agentId)
      }

      await this.upsertAttemptInIndex(request.sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'completed',
        startedAt: this.now(),
        completedAt: this.now(),
        inReplyTo: request.userMessageId,
      })
      this.updateSessionState(session.sessionId, 'completed')
      await this.updateSessionIndexEntry(session.sessionId, {
        lastMessagePreview: this.createMessagePreview(completedMessage.content),
        status: 'completed',
        updatedAt: this.now(),
      })
    } catch (error) {
      if (isAbortError(error) || !this.activeRunIds.has(request.sessionId)) {
        this.removeMessageIfEmpty(agentMessage.messageId)
        await this.upsertAttemptInIndex(request.sessionId, {
          attemptId: runId,
          runId,
          messageId: agentMessage.messageId,
          status: 'cancelled',
          startedAt: this.now(),
          completedAt: this.now(),
          inReplyTo: request.userMessageId,
        })
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
      await this.upsertAttemptInIndex(request.sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'failed',
        startedAt: this.now(),
        completedAt: this.now(),
        error: runtimeError,
        inReplyTo: request.userMessageId,
      })
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
      this.configStore.read(),
      this.gateway.listProvidersAndModels(),
    ])

    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(
          readResult.config,
          TANGYUAN_DEFAULT_AGENT_ID,
        )
      : null
    const hasBackup = await this.configStore.hasBackup()

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
      agents: await this.agentRegistry.buildAgentSummaries(readResult.config),
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
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当配置读取失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    return this.agentRegistry.listAgents()
  }

  /**
   * 原子创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当配置读取、目录创建、文件写入或加密失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentRegistry.createAgent(displayName)
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
    return this.agentRegistry.updateAgentConfig(agentId, patch)
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆、不存在或配置保存失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.archiveAgent(agentId)
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.recoverAgent(agentId)
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
    return this.agentRegistry.reconcileAgentDirectories()
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
    return this.agentRegistry.claimAgentDirectory(agentId, displayName)
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    return this.agentRegistry.rebuildTangyuanHome()
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: AgentId): Promise<SoulContent> {
    const soulPath = this.layout.soul(agentId)

    // 确保 agent home 目录和 soul 文件存在
    await this.ensureAgentHome(agentId)

    const content = await safeReadFile(soulPath)
    const updatedAt = (await getMtimeIso(soulPath)) ?? this.now()

    return { agentId, content, updatedAt }
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    const userPath = this.layout.userProfile()

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    // 确保共享 profile 目录和文件存在
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(this.layout.userHistory(), { recursive: true })

    if (!(await pathExists(userPath))) {
      await writeFile(userPath, '', 'utf8')
    }

    const content = await safeReadFile(userPath)
    const updatedAt = (await getMtimeIso(userPath)) ?? this.now()

    return { content, updatedAt }
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表，专属覆盖共享后的最终结果。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: AgentId): Promise<SkillSummary[]> {
    return this.skillStore.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillStore.listSharedSkills()
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
    return this.skillStore.installSkill(params)
  }

  /**
   * 删除 Skill（含备份到 trash）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillStore.deleteSkill(params)
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillStore.getSkillInstallRecords()
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

    const soulPath = this.layout.soul(agentId)
    const historyPath = this.layout.soulHistory(agentId)

    // 确保目录存在
    await this.ensureAgentHome(agentId)

    // 读取更新前内容
    const previousContent = (await pathExists(soulPath))
      ? await safeReadFile(soulPath)
      : ''
    const previousHistoryFiles = await readDirectoryFileSet(historyPath)

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
    const readResult = await this.configStore.read()
    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(readResult.config, agentId)
      : null
    const redactedContent = this.redactSensitiveProfileContent(
      content,
      runtimeConfig?.apiKey ?? null,
    )

    // 写入
    await writeFile(soulPath, redactedContent, 'utf8')

    // 广播事件
    const updatedAt = (await getMtimeIso(soulPath)) ?? this.now()
    this.emitProfileUpdated('soul', updatedAt)

    // profile 变化点：设置中修改 soul 后刷新该 Agent 会话的系统提示词。
    await this.refreshAgentProfileContext(agentId)

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
    const userPath = this.layout.userProfile()
    const historyPath = this.layout.userHistory()

    // 确保目录存在
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(historyPath, { recursive: true })

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    // 读取更新前内容
    const previousContent = (await pathExists(userPath))
      ? await safeReadFile(userPath)
      : ''
    const previousHistoryFiles = await readDirectoryFileSet(historyPath)

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
    const readResult = await this.configStore.read()
    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(
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
    const updatedAt = (await getMtimeIso(userPath)) ?? this.now()
    this.emitProfileUpdated('user', updatedAt)

    // profile 变化点：共享 user.md 影响所有 Agent，刷新全部活跃会话。
    await this.refreshAllProfileContext()

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
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const targetApiKey =
      request.providerId !== configuration.providerId
        ? await this.configStore.readProviderApiKey(request.providerId)
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
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    await this.configStore.restore()
    return this.readRuntimeSnapshot()
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 无返回值。
   * @throws 当文件删除失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<void> {
    await this.configStore.reset()
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
    const indexPath = this.layout.sessionIndex()

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
      if (isNotFoundError(error)) {
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
    const readResult = await this.configStore.read()

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
      const runtimeConfig = extractAgentRuntimeConfig(
        readResult.config,
        agentId,
      )
      const cwd =
        agentId === TANGYUAN_DEFAULT_AGENT_ID
          ? this.layout.agentHome()
          : this.layout.workspace(agentId)

      try {
        const sdkSessions = await this.gateway.listSessions({
          cwd,
          sessionDir: this.layout.sdkSessionDir(),
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
      const indexPath = this.layout.sessionIndex()
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
    const indexPath = this.layout.sessionIndex()
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
   * 在会话索引中新增或更新一条执行尝试记录。
   *
   * 用于会话重建时还原每个 AgentReplyEntry 的 attempt 状态。
   *
   * @param sessionId - 所属会话标识。
   * @param attempt - 要持久化的执行尝试记录。
   * @returns 无返回值。
   * @throws 当会话索引不存在或写入失败时，Promise 会 reject。
   */
  private async upsertAttemptInIndex(
    sessionId: string,
    attempt: PersistedAttemptEntry,
  ): Promise<void> {
    const currentEntry = this.getKnownSessionIndexEntry(sessionId)
    const existingAttempts = currentEntry.attempts ?? []
    const existingIndex = existingAttempts.findIndex(
      (a) => a.attemptId === attempt.attemptId,
    )

    const nextAttempts =
      existingIndex >= 0
        ? [
            ...existingAttempts.slice(0, existingIndex),
            attempt,
            ...existingAttempts.slice(existingIndex + 1),
          ]
        : [...existingAttempts, attempt]

    // Keep only the last 20 attempts to prevent unbounded growth
    const trimmedAttempts = nextAttempts.slice(-20)

    await this.updateSessionIndexEntry(sessionId, {
      attempts: trimmedAttempts,
    })
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
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const cwd =
      indexEntry.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.layout.agentHome()
        : this.layout.workspace(indexEntry.agentId)
    const openRequest = {
      ...configuration,
      sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
      cwd,
      agentSkillsPath: this.layout.agentSkills(indexEntry.agentId),
      sharedSkillsPath: this.layout.sharedSkills(),
    }
    const handle = await this.gateway.openSession(
      this.toolApprovalGateway
        ? { ...openRequest, toolApprovalGateway: this.toolApprovalGateway }
        : openRequest,
    )
    this.sessionHandles.set(sessionId, handle)
    // 身份上下文走系统提示词：重启后打开历史会话时注入并 reload 使其生效。
    if (handle.setSystemPromptContext) {
      handle.setSystemPromptContext(
        await this.buildProfileSystemPromptContext(indexEntry.agentId),
      )
      await handle.reload?.()
    }

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
   * 确保指定 Agent Home 目录结构存在。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当目录创建失败时，Promise 会 reject。
   */
  private async ensureAgentHome(agentId: AgentId): Promise<void> {
    const homePath = this.layout.agentHome(agentId)
    const soulHistoryPath = this.layout.soulHistory(agentId)

    await mkdir(homePath, { recursive: true })
    await mkdir(soulHistoryPath, { recursive: true })
    await mkdir(join(homePath, 'memory'), { recursive: true })
    await mkdir(join(homePath, 'skills'), { recursive: true })
    await mkdir(join(homePath, 'workspace'), { recursive: true })

    // 确保 soul.md 存在
    const soulPath = this.layout.soul(agentId)

    if (!(await pathExists(soulPath))) {
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
      this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID),
      'user.md',
    )
    const legacyHistoryPath = join(
      this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID),
      'user.history',
    )
    const targetPath = this.layout.userProfile()
    const targetHistoryPath = this.layout.userHistory()

    if (!(await pathExists(legacyUserPath))) {
      return
    }

    // 迁移 user.md
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await copyFile(legacyUserPath, targetPath)

    // 迁移 user.history/ 目录下的文件
    if (await pathExists(legacyHistoryPath)) {
      await mkdir(targetHistoryPath, { recursive: true })
      const historyFiles = await readDirectoryFileSet(legacyHistoryPath)

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
    const absoluteHomePath = this.layout.agentHome()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.layout.userProfile()
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
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(this.layout.userHistory(), { recursive: true })
    await mkdir(this.layout.sharedSkills(), { recursive: true })

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [bootstrapFileExists, soulFileExists, userFileExists] =
      await Promise.all([
        pathExists(bootstrapPath),
        pathExists(soulPath),
        pathExists(userPath),
      ])

    if (!bootstrapFileExists && !soulFileExists && !userFileExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    // 初始化完成的唯一真相：soul.md 与 user.md 均存在且内容非空。
    // 空文件不算完成，仍处于初始化阻断态。
    const [soulHasContent, userHasContent] = await Promise.all([
      soulFileExists ? fileHasContent(soulPath) : Promise.resolve(false),
      userFileExists ? fileHasContent(userPath) : Promise.resolve(false),
    ])
    const profileReady = soulHasContent && userHasContent

    return {
      initialized: profileReady,
      bootstrapRequired:
        !profileReady && (await pathExists(bootstrapPath)),
      bootstrapFileExists: await pathExists(bootstrapPath),
      soulFileExists: await pathExists(soulPath),
      userFileExists: await pathExists(userPath),
      soulUpdatedAt: await getMtimeIso(soulPath),
      userUpdatedAt: await getMtimeIso(userPath),
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

      const readResult = await this.configStore.read()
      const runtimeConfig = readResult.config
        ? extractAgentRuntimeConfig(readResult.config, input.agentId)
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
    const absoluteHomePath = this.layout.agentHome()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')

    const [bootstrapExists, soulExists, userExists] = await Promise.all([
      pathExists(bootstrapPath),
      pathExists(soulPath),
      pathExists(userPath),
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
        path: this.layout.soul(agentId),
        historyPath: this.layout.soulHistory(agentId),
      }),
      user: await this.readProfileMaintenanceFileSnapshot({
        target: 'user',
        path: this.layout.userProfile(),
        historyPath: this.layout.userHistory(),
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
      historyFiles: await readDirectoryFileSet(input.historyPath),
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
      this.layout.agentHome(input.agentId),
      'user.md',
    )
    const agentHomeUserHistoryPath = join(
      this.layout.agentHome(input.agentId),
      'user.history',
    )

    if (await pathExists(agentHomeUserPath)) {
      const agentHomeUserContent = await safeReadFile(agentHomeUserPath)

      if (agentHomeUserContent !== input.previousSnapshot.user.content) {
        // LLM 修改了 agent home 下的 user.md，同步到共享路径
        const sharedUserPath = this.layout.userProfile()

        // 确保共享路径存在
        await mkdir(this.layout.sharedProfile(), { recursive: true })
        await mkdir(this.layout.userHistory(), { recursive: true })

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
        const updatedContent = await safeReadFile(agentHomeUserPath)
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
      (await getMtimeIso(input.previousFile.path)) ?? this.now(),
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
    const nextHistoryFiles = await readDirectoryFileSet(
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
  }): InternalMessage {
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
   * 构造需追加到系统提示词末尾的身份上下文片段。
   *
   * soul.md 与 user.md 同时存在且内容非空时注入 profile；否则注入
   * bootstrap 初始化指令与 bootstrap.md 全文。与对话消息彻底分离，
   * 不再拼入用户消息，避免污染 SDK transcript。
   *
   * @param agentId - Agent 标识；默认为 tangyuan。
   * @returns 可追加到系统提示词的 profile / bootstrap 上下文字符串。
   * @throws 当 profile 文件读取失败时，Promise 会 reject。
   */
  private async buildProfileSystemPromptContext(
    agentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<string> {
    const absoluteHomePath = this.layout.agentHome(agentId)
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.layout.userProfile()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')

    // 确保共享 user profile 存在
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [soulContent, profileUserContent] = await Promise.all([
      (await pathExists(soulPath))
        ? readFile(soulPath, 'utf8')
        : Promise.resolve(''),
      (await pathExists(userPath))
        ? readFile(userPath, 'utf8')
        : Promise.resolve(''),
    ])

    // 初始化完成的唯一真相：soul.md 与 user.md 均存在且内容非空。
    // 空文件不算完成，仍需走 bootstrap 流程。
    if (soulContent.trim() !== '' && profileUserContent.trim() !== '') {
      return [
        `# ${PROFILE_CONTEXT_HEADER}`,
        '',
        '## soul.md',
        soulContent.trim(),
        '',
        '## user.md',
        profileUserContent.trim(),
      ].join('\n')
    }

    const bootstrapContent = (await pathExists(bootstrapPath))
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
    ].join('\n')
  }

  /**
   * 重算身份上下文并刷新到指定 Agent 的所有活跃会话。
   *
   * 先异步算好片段，再对每个 handle 同步 set + reload，绕开
   * appendSystemPromptOverride 同步签名无法读文件的约束。仅在 profile
   * 变化点（建会话、打开会话、回合结束、设置中修改 profile）调用。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值；无匹配 handle 时静默返回。
   * @throws 当 profile 读取或 reload 失败时，Promise 会 reject。
   */
  private async refreshAgentProfileContext(agentId: AgentId): Promise<void> {
    const context = await this.buildProfileSystemPromptContext(agentId)
    const promises: Promise<void>[] = []

    for (const [sessionId, handle] of this.sessionHandles) {
      if (
        this.sessionIndex.get(sessionId)?.agentId !== agentId ||
        !handle.setSystemPromptContext
      ) {
        continue
      }
      handle.setSystemPromptContext(context)
      if (handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 刷新全部活跃会话的身份上下文。
   *
   * 用于共享 user.md 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当 profile 读取或 reload 失败时，Promise 会 reject。
   */
  private async refreshAllProfileContext(): Promise<void> {
    const agentIds = new Set<AgentId>()
    for (const sessionId of this.sessionHandles.keys()) {
      const agentId = this.sessionIndex.get(sessionId)?.agentId
      if (agentId) {
        agentIds.add(agentId)
      }
    }

    await Promise.all(
      [...agentIds].map((agentId) => this.refreshAgentProfileContext(agentId)),
    )
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
    role: InternalMessage['role']
    content: string
  }): InternalMessage {
    this.assertKnownSession(input.sessionId, input.agentId)

    const messages = this.messages.get(input.sessionId) ?? []
    const message: InternalMessage = {
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
  private appendMessageDelta(messageId: string, delta: string): InternalMessage {
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
  private completeMessage(messageId: string): InternalMessage {
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
  private emit(event: DriverEvent): void {
    for (const listener of this.listeners) {
      // DriverEvent is a superset of AgentEvent; listeners only process
      // the subset of events that belong to the public AgentEvent union.
      ;(listener as AgentEventListener)(event as AgentEvent)
    }
  }
}

/**
 * 生产环境使用的 Pi SDK 网关。
 */

export * from './gateway'
export * from './utils'
export * from './run-turn-assembly'
