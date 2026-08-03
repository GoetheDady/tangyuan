import type { TurnEndEvent as PiSdkTurnEndEvent } from '@earendil-works/pi-coding-agent'
import type {
  AgentSummary,
  ConfigEncryptionAdapter,
  ForkSource,
  ModelDescriptor,
  ProfileUpdateResult,
  ProviderDescriptor,
  RuntimeConfiguration,
  SessionModelInfo,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'

export type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
} from '@yuanxiao/contracts'
export type { DriverEvent, InternalMessage } from './pi-sdk-driver-events'

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
 * 由 YuanxiaoRuntime 实现，注入到 PiSdkDriver 的自定义工具中，
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
  /** 仅在 yuanxiao session 中提供，用于 create_agent 工具回调。 */
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
  /** SDK 文件中的真实 entry id，用于确定分叉点。 */
  entryId: string
  /** 公开 transcript 的 messageId，随分叉来源记录持久化。 */
  messageId: string
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
  | {
      // SDK 原生 `compaction_end`（未中止）：会话上下文已被压缩。
      type: 'compaction-ended'
      reason: 'manual' | 'threshold' | 'overflow'
    }
  | {
      // SDK 原生 `auto_retry_start`：API 错误触发自动重试开始。
      type: 'auto-retry-started'
      attempt: number
      maxAttempts: number
    }
  | {
      // SDK 原生 `auto_retry_end`：自动重试结束（成功或耗尽）。
      type: 'auto-retry-ended'
      success: boolean
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
} from '../session/session-index-types'

/**
 * 创建 AgentRuntimeError 时使用的输入与错误类（定义见 errors.ts）。
 */
export type { AgentRuntimeErrorInput } from '../core'
export { AgentRuntimeError } from '../core'

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
