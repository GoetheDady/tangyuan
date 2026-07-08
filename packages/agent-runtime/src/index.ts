import {
  access,
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
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createDefaultSessionSummary,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

/**
 * 描述 Pi SDK 临时配置验证时使用的固定 prompt。
 */
const CONFIGURATION_VERIFICATION_PROMPT = 'Reply with OK.'

/**
 * 默认 Agent profile 注入到 Pi SDK prompt 时使用的分隔标题。
 */
const PROFILE_CONTEXT_HEADER = '汤圆长期上下文'

/**
 * 描述持久化在 Electron userData 下的运行时配置。
 */
export type PersistedRuntimeConfiguration = RuntimeConfiguration

/**
 * 描述 Pi SDK 验证配置时需要的参数。
 */
export interface PiSdkVerificationRequest extends RuntimeConfiguration {
  prompt: string
  signal: AbortSignal
}

/**
 * 描述创建真实 Pi SDK 会话时需要的参数。
 */
export interface PiSdkCreateSessionRequest extends RuntimeConfiguration {
  sessionId: string
  sdkSessionFile: string
  cwd: string
}

/**
 * 描述打开已有 Pi SDK 会话时需要的参数。
 */
export interface PiSdkOpenSessionRequest extends RuntimeConfiguration {
  sessionId: string
  sdkSessionFile: string
  cwd: string
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
  private readonly listeners = new Set<AgentEventListener>()
  private readonly sessions = new Map<string, AgentSessionSummary>()
  private readonly sessionIndex = new Map<string, PersistedSessionIndexEntry>()
  private readonly messages = new Map<string, AgentMessage[]>()
  private readonly sessionHandles = new Map<string, PiSdkSessionHandle>()
  private readonly activeRunIds = new Map<string, string>()
  private readonly runSequenceBySession = new Map<string, number>()
  private configurationVerificationController: AbortController | null = null

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

    await this.writePersistedConfiguration(normalizedConfiguration)
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
   * @throws 当 request.agentId 不是默认 Agent 时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    if (request.agentId !== TANGYUAN_DEFAULT_AGENT_ID) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: 'v1 只支持默认 tangyuan Agent（智能体）。',
        recoverable: true,
      })
    }

    const [configuration, existingEntries] = await Promise.all([
      this.readRequiredConfiguration(),
      this.loadSessionIndex(),
    ])
    const sessionId = this.createNextSessionId(existingEntries)
    const now = this.now()
    const sdkSessionFile = this.resolveSdkSessionFile(sessionId)
    await mkdir(dirname(sdkSessionFile), { recursive: true })
    const handle = await this.gateway.createSession({
      ...configuration,
      sessionId,
      sdkSessionFile,
      cwd: this.resolveAgentHomePath(),
    })
    const persistedSdkSessionFile = handle.sdkSessionFile ?? sdkSessionFile
    const session = createDefaultSessionSummary({
      sessionId,
      title: request.title,
      updatedAt: now,
    })
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
      const prompt = await this.buildPromptWithProfileContext(content)
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
    const [configuration, resources] = await Promise.all([
      this.readPersistedConfiguration(),
      this.gateway.listProvidersAndModels(),
    ])

    return createRuntimeSnapshot({
      activeAgent: {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        homePath: this.agentHomePath,
        profile: createAgentProfileStatus(homeStatus),
      },
      providers: resources.providers,
      models: resources.models,
      settings: {
        selectedProviderId: configuration?.providerId ?? null,
        selectedModelId: configuration?.modelId ?? null,
      },
      auth: {
        apiKey: {
          configured: Boolean(configuration?.apiKey),
          maskedValue: configuration?.apiKey
            ? PiSdkDriver.maskApiKey(configuration.apiKey)
            : null,
        },
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
   * 从 Electron userData 下读取配置 JSON。
   *
   * @returns 已保存的运行时配置；不存在时返回 null。
   * @throws 当 JSON 无法读取或格式错误时，Promise 会 reject。
   */
  private async readPersistedConfiguration(): Promise<PersistedRuntimeConfiguration | null> {
    const configPath = this.resolveConfigPath()

    try {
      const rawConfig = await readFile(configPath, 'utf8')
      const parsedConfig = JSON.parse(
        rawConfig,
      ) as Partial<PersistedRuntimeConfiguration>

      if (
        typeof parsedConfig.providerId !== 'string' ||
        typeof parsedConfig.modelId !== 'string' ||
        typeof parsedConfig.apiKey !== 'string'
      ) {
        return null
      }

      return {
        providerId: parsedConfig.providerId,
        modelId: parsedConfig.modelId,
        apiKey: parsedConfig.apiKey,
      }
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
   * 读取已保存且可用于真实会话的运行时配置。
   *
   * @returns 已保存的 Provider、模型和 API Key。
   * @throws 当配置不存在时抛出 AgentRuntimeError。
   */
  private async readRequiredConfiguration(): Promise<PersistedRuntimeConfiguration> {
    const configuration = await this.readPersistedConfiguration()

    if (!configuration) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message:
          '创建会话前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    return configuration
  }

  /**
   * 写入 Electron userData 下的配置 JSON。
   *
   * @param configuration - 已通过真实 SDK 验证的运行时配置。
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  private async writePersistedConfiguration(
    configuration: PersistedRuntimeConfiguration,
  ): Promise<void> {
    const configPath = this.resolveConfigPath()
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      `${configPath}.tmp`,
      `${JSON.stringify(configuration, null, 2)}\n`,
      'utf8',
    )
    await import('node:fs/promises').then(({ rename }) =>
      rename(`${configPath}.tmp`, configPath),
    )
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
   * 读取本地会话索引；索引不存在时尝试从 Pi SDK 原生 session 重建。
   *
   * @returns 当前可展示的会话索引条目。
   * @throws 当索引 JSON 损坏或 SDK 列表读取失败时，Promise 会 reject。
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

      throw error
    }
  }

  /**
   * 在本地索引缺失时，从 Pi SDK 原生 session 列表重建基础索引。
   *
   * @returns 从 SDK 恢复出的索引条目。
   * @throws 当运行时配置或 SDK session 列表读取失败时，Promise 会 reject。
   */
  private async rebuildSessionIndexFromSdk(): Promise<
    PersistedSessionIndexEntry[]
  > {
    const configuration = await this.readPersistedConfiguration()

    if (!configuration) {
      this.replaceSessionIndex([])
      return []
    }

    const sdkSessions = await this.gateway.listSessions({
      cwd: this.resolveAgentHomePath(),
      sessionDir: this.resolveSdkSessionDir(),
    })
    const entries = sdkSessions.map((session) => ({
      sessionId: session.sessionId,
      sdkSessionFile: session.sdkSessionFile,
      title: session.title?.trim() || session.sessionId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      provider: configuration.providerId,
      model: configuration.modelId,
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      lastMessagePreview: '',
      status: 'idle' as const,
    }))

    this.replaceSessionIndex(entries)
    await this.writeSessionIndex()

    return entries
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

    const [configuration, indexEntry] = await Promise.all([
      this.readRequiredConfiguration(),
      Promise.resolve(this.getKnownSessionIndexEntry(sessionId)),
    ])
    const handle = await this.gateway.openSession({
      ...configuration,
      sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
      cwd: this.resolveAgentHomePath(),
    })
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
  private createNextSessionId(entries: PersistedSessionIndexEntry[]): string {
    const maxNumericId = entries.reduce((maxId, entry) => {
      const match = /^session-(\d+)$/.exec(entry.sessionId)
      return match ? Math.max(maxId, Number(match[1])) : maxId
    }, 0)

    return `session-${maxNumericId + 1}`
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
   * 确保默认 Agent Home 及 bootstrap 相关文件存在。
   *
   * @returns 默认 Agent Home 的文件状态。
   * @throws 当文件系统创建、读取或写入失败时，Promise 会 reject。
   */
  private async ensureDefaultAgentHome(): Promise<AgentHomeStatus> {
    const absoluteHomePath = this.resolveAgentHomePath()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')
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
      const profileSnapshot = await this.readProfileMaintenanceSnapshot()
      const maintenancePrompt = this.buildProfileMaintenancePrompt({
        userContent: input.userContent,
        agentContent: input.agentContent,
        soulContent: profileSnapshot.soul.content,
        profileUserContent: profileSnapshot.user.content,
      })

      await input.handle.prompt(maintenancePrompt)

      const configuration = await this.readPersistedConfiguration()
      await this.applyProfileMaintenanceResults({
        agentId: input.agentId,
        sessionId: input.sessionId,
        previousSnapshot: profileSnapshot,
        apiKey: configuration?.apiKey ?? null,
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
   * 读取维护回合开始前的 profile 文件内容和历史目录状态。
   *
   * @returns soul.md、user.md 及其历史目录的快照。
   * @throws 当 profile 文件或历史目录无法读取时，Promise 会 reject。
   */
  private async readProfileMaintenanceSnapshot(): Promise<ProfileMaintenanceSnapshot> {
    const absoluteHomePath = this.resolveAgentHomePath()

    return {
      soul: await this.readProfileMaintenanceFileSnapshot({
        target: 'soul',
        path: join(absoluteHomePath, 'soul.md'),
        historyPath: join(absoluteHomePath, 'soul.history'),
      }),
      user: await this.readProfileMaintenanceFileSnapshot({
        target: 'user',
        path: join(absoluteHomePath, 'user.md'),
        historyPath: join(absoluteHomePath, 'user.history'),
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
    await Promise.all([
      this.applyProfileMaintenanceFileResult({
        agentId: input.agentId,
        sessionId: input.sessionId,
        previousFile: input.previousSnapshot.soul,
        apiKey: input.apiKey,
      }),
      this.applyProfileMaintenanceFileResult({
        agentId: input.agentId,
        sessionId: input.sessionId,
        previousFile: input.previousSnapshot.user,
        apiKey: input.apiKey,
      }),
    ])
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
  ): Promise<string> {
    const absoluteHomePath = this.resolveAgentHomePath()
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
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
   * 把用户家目录下的相对默认 Agent Home 转成绝对路径。
   *
   * @returns 默认 Agent Home 的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveAgentHomePath(): string {
    return this.agentHomePath.startsWith('~')
      ? join(this.fsRoot, this.agentHomePath.slice(2))
      : this.agentHomePath
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
    this.assertKnownSession(input.sessionId)

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
    const session = this.assertKnownSession(sessionId)
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
    const models = modelRegistry.getAll()
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
    const { AuthStorage, ModelRegistry, SessionManager, createAgentSession } =
      await import('@earendil-works/pi-coding-agent')
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

    const { session } = await createAgentSession({
      cwd: request.cwd,
      authStorage,
      modelRegistry,
      model,
      sessionManager,
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
    return [{ type: 'tool-started', toolName: event.toolName }]
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
