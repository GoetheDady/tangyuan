import type {
  TurnStartEvent as PiSdkTurnStartEvent,
  TurnEndEvent as PiSdkTurnEndEvent,
} from '@earendil-works/pi-coding-agent'
import type { PersistedAttemptEntry } from './session-index-types'
import type {
  AgentConfig,
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentId,
  AgentSessionSummary,
  AgentSummary,
  CancelConfigurationVerificationRequest,
  CancelRunRequest,
  ConfigEncryptionAdapter,
  CreateSessionRequest,
  GetSessionMessagesRequest,
  ForkSource,
  GetSessionModelInfoRequest,
  ListSessionsRequest,
  ModelDescriptor,
  ProfileUpdateResult,
  ProviderDescriptor,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SendMessageRequest,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
  TranscriptSnapshot,
} from '@tangyuan/contracts'

export type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
} from '@tangyuan/contracts'

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
  agentId: string
  sessionId: string
  sdkSessionFile: string
  cwd: string
  /** Agent 专属 Skills 目录路径（用于 DefaultResourceLoader）。 */
  agentSkillsPath: string
  /** 共享 Skills 目录路径（用于 DefaultResourceLoader）。 */
  sharedSkillsPath: string
  /** 仅在 tangyuan session 中提供，用于 create_agent 工具回调。 */
  onCreateAgent?: (displayName: string) => Promise<AgentSummary>
  /** 绑定到当前 Agent 和当前会话观察版本的灵魂更新回调。 */
  onUpdateSoul: (content: string) => Promise<ProfileUpdateResult>
  /** 绑定到当前会话观察版本的共享用户画像更新回调。 */
  onUpdateUserProfile: (content: string) => Promise<ProfileUpdateResult>
  /** 工具审批与路径校验网关（用于 bash 审批和文件路径保护）。 */
  toolApprovalGateway?: ToolApprovalGateway
}

/**
 * 描述打开已有 Pi SDK 会话时需要的参数。
 */
export interface PiSdkOpenSessionRequest extends RuntimeConfiguration {
  agentId: string
  sessionId: string
  sdkSessionFile: string
  cwd: string
  /** Agent 专属 Skills 目录路径（用于 DefaultResourceLoader）。 */
  agentSkillsPath: string
  /** 共享 Skills 目录路径（用于 DefaultResourceLoader）。 */
  sharedSkillsPath: string
  /** 绑定到当前 Agent 和当前会话观察版本的灵魂更新回调。 */
  onUpdateSoul: (content: string) => Promise<ProfileUpdateResult>
  /** 绑定到当前会话观察版本的共享用户画像更新回调。 */
  onUpdateUserProfile: (content: string) => Promise<ProfileUpdateResult>
  /** 工具审批与路径校验网关（用于 bash 审批和文件路径保护）。 */
  toolApprovalGateway?: ToolApprovalGateway
}

/**
 * 描述从 Pi SDK 原生持久化中列出会话时需要的参数。
 */
export interface PiSdkListSessionsRequest {
  /** 全局 Pi session 目录；扫描其中所有会话，不按工作目录过滤。 */
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
 * 描述从 Pi SDK 原生 session 提取独立分叉会话时需要的参数。
 */
export interface PiSdkCreateBranchedSessionRequest {
  sdkSessionFile: string
  entryId: string
}

/**
 * 描述 Pi SDK 创建出的独立分叉会话文件和会话标识。
 */
export interface PiSdkBranchedSession {
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
  /** session header 中记录的工作目录；旧会话可能为空串。 */
  cwd: string
  createdAt: string
  updatedAt: string
  forkedFrom?: ForkSource
  /** Pi session 中记录的会话级 Provider；未记录时省略。 */
  provider?: string
  /** Pi session 中记录的会话级 Model；未记录时省略。 */
  model?: string
  /** Pi session 中记录的会话级 Thinking Level；未记录时省略。 */
  thinkingLevel?: string
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
   * 从 Pi SDK 原生持久化中读取全局会话列表。
   *
   * @param request - 全局 Pi session 目录。
   * @returns SDK 侧能恢复出的会话摘要列表（含 session header 工作目录）。
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

  /**
   * 从 Pi SDK 原生 session 文件提取独立分叉会话。
   *
   * @param request - 来源 session 文件和分叉源用户消息标识。
   * @returns 新 JSONL 文件及其 Pi session ID。
   * @throws 当来源消息不是用户消息、session 文件不存在或分叉失败时，Promise 会 reject。
   */
  createBranchedSession(
    request: PiSdkCreateBranchedSessionRequest,
  ): Promise<PiSdkBranchedSession>
}

/**
 * 会话索引条目、执行尝试与索引文件结构（定义见 session-index-types.ts）。
 */
export type {
  PersistedAttemptEntry,
  PersistedSessionIndexEntry,
  PersistedSessionIndex,
} from './session-index-types'

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
   * 批量更新会话的归档状态。
   *
   * @param sessionIds - 要更新的会话标识。
   * @param archivedAt - 归档时间；传入 null 表示恢复。
   * @returns 更新后的会话摘要。
   */
  setSessionsArchived?(
    sessionIds: readonly string[],
    archivedAt: string | null,
  ): Promise<AgentSessionSummary[]>

  /**
   * 永久删除一组会话的 Pi session 文件和索引条目。
   *
   * @param sessionIds - 要删除的会话标识。
   * @returns 无返回值。
   * @throws 当文件删除或索引写入失败时，Promise 会 reject。
   */
  deleteSessions?(sessionIds: readonly string[]): Promise<void>

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
   * 在指定会话的某个用户消息节点分叉出新的分支。
   *
   * @param request - Agent 标识、会话标识和分叉起始节点。
   * @returns 新分支的会话摘要。
   * @throws 当会话不存在或分叉操作失败时，Promise 会 reject。
   */
  forkSession?(
    request: import('@tangyuan/contracts').ForkSessionRequest,
  ): Promise<import('@tangyuan/contracts').AgentSessionSummary>

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
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateSoul?(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<import('@tangyuan/contracts').ProfileUpdateResult>

  /**
   * 更新共享 user profile（含备份验证和敏感信息过滤）。
   *
   * @param content - 新 user profile 内容。
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateUserProfile?(
    content: string,
    expectedVersion: string,
  ): Promise<import('@tangyuan/contracts').ProfileUpdateResult>

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
export type DriverEvent =
  | AgentEvent
  | {
      type: 'message-appended'
      agentId: string
      message: InternalMessage
      inReplyTo?: string
      occurredAt: string
    }
  | {
      type: 'message-delta'
      agentId: string
      sessionId: string
      runId: string
      messageId: string
      delta: string
      deltaKind?: 'text' | 'thinking'
      occurredAt: string
    }
  | {
      type: 'message-completed'
      agentId: string
      sessionId: string
      runId: string
      message: InternalMessage
      occurredAt: string
    }
  | {
      type: 'activity-updated'
      agentId: string
      sessionId: string
      runId: string
      activity: {
        kind: 'thinking' | 'tool'
        state: 'running' | 'completed' | 'failed'
        label: string
        toolCallId?: string
        toolName?: string
      }
      occurredAt: string
    }
  | {
      // 对应 SDK 原生 `turn_start`，界定一个真实回合的开始。
      // 携带 SDK 权威 `turnIndex`（agent_start 归零，每个 turn_end 后递增）。
      // 仅 Runtime 内部使用，不跨 IPC 暴露给 Renderer。
      type: 'turn-started'
      agentId: string
      sessionId: string
      runId: string
      turnIndex: PiSdkTurnStartEvent['turnIndex']
      occurredAt: string
    }
  | {
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
