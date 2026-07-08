import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentId,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
  createDefaultSessionSummary,
  type AgentId,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

/**
 * 描述 Agent Runtime 统一错误码。
 */
export type AgentRuntimeErrorCode =
  | 'configuration-missing'
  | 'driver-unavailable'
  | 'provider-verification-failed'
  | 'session-not-found'
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
 * 创建 AgentRuntimeError 时使用的输入。
 */
export interface AgentRuntimeErrorInput extends AgentRuntimeErrorPayload {
  cause?: unknown
}

/**
 * 描述 Agent 运行过程中发给 DesktopAppStore 的标准事件。
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
}

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver implements AgentSessionDriver, RuntimeResourceDriver {
  private readonly now: () => string
  private readonly agentHomePath: string
  private readonly listeners = new Set<AgentEventListener>()
  private readonly sessions = new Map<string, AgentSessionSummary>()

  /**
   * 创建 Pi SDK Driver 骨架。
   *
   * @param options - 时间函数和默认 Agent Home 路径等可替换依赖。
   * @returns PiSdkDriver 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(options: PiSdkDriverOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.agentHomePath = options.agentHomePath ?? '~/.tangyuan/agents/tangyuan'
  }

  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 此骨架实现不会主动抛出错误。
   */
  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.createMissingConfigurationSnapshot()
  }

  /**
   * 刷新运行时资源。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 此骨架实现不会主动抛出错误。
   */
  async refresh(): Promise<RuntimeSnapshot> {
    return this.createMissingConfigurationSnapshot()
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
    return [...this.sessions.values()].filter(
      (session) => session.agentId === request.agentId,
    )
  }

  /**
   * 创建一个新的本地会话摘要。
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

    const session = createDefaultSessionSummary({
      sessionId: `session-${this.sessions.size + 1}`,
      title: request.title,
      updatedAt: this.now(),
    })

    this.sessions.set(session.sessionId, session)
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
   * @returns 当前骨架实现返回空消息列表。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async getMessages(
    request: GetSessionMessagesRequest,
  ): Promise<AgentMessage[]> {
    this.assertKnownSession(request.sessionId)
    return []
  }

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和消息内容。
   * @returns 无返回值。
   * @throws 当前骨架实现始终以 `configuration-missing` reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<void> {
    this.assertKnownSession(request.sessionId)

    throw new AgentRuntimeError({
      code: 'configuration-missing',
      message:
        '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
      recoverable: true,
    })
  }

  /**
   * 取消指定会话正在运行的响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<void> {
    this.assertKnownSession(request.sessionId)
    this.emit({
      type: 'run-state-changed',
      agentId: request.agentId,
      sessionId: request.sessionId,
      state: 'cancelled',
      occurredAt: this.now(),
    })
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
   * 创建缺少配置时的默认运行时快照。
   *
   * @returns 一个 `missing-config` 状态的 RuntimeSnapshot。
   * @throws 此方法不会主动抛出错误。
   */
  private createMissingConfigurationSnapshot(): RuntimeSnapshot {
    return createRuntimeSnapshot({
      activeAgent: {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        homePath: this.agentHomePath,
        profile: {
          initialized: false,
          soulUpdatedAt: null,
          userUpdatedAt: null,
        },
      },
      providers: [],
      models: [],
      settings: {
        selectedProviderId: null,
        selectedModelId: null,
      },
      auth: {
        apiKey: {
          configured: false,
          maskedValue: null,
        },
      },
    })
  }

  /**
   * 确认会话已存在。
   *
   * @param sessionId - 需要确认的会话标识。
   * @returns 无返回值。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private assertKnownSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }
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
