import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentSessionDriver,
  RuntimeResourceDriver,
} from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentMessage,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/contracts'

/**
 * 创建 TangyuanRuntime 时需要注入的内部 Driver。
 */
export interface TangyuanRuntimeDependencies {
  runtimeDriver: RuntimeResourceDriver
  sessionDriver: AgentSessionDriver
}

/**
 * Electron Main 调用运行时行为的唯一高层接口。
 */
class DefaultTangyuanRuntime {
  private readonly runtimeDriver: RuntimeResourceDriver
  private readonly sessionDriver: AgentSessionDriver
  private readonly listeners = new Set<AgentEventListener>()
  private readonly messagesBySession = new Map<string, AgentMessage[]>()
  private readonly activeRunIds = new Map<string, string>()
  private runtimeSnapshot: RuntimeSnapshot | null = null
  private sessions: AgentSessionSummary[] = []

  /**
   * 创建默认 TangyuanRuntime。
   *
   * @param dependencies - Runtime 和会话 Driver。
   * @returns TangyuanRuntime 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(dependencies: TangyuanRuntimeDependencies) {
    this.runtimeDriver = dependencies.runtimeDriver
    this.sessionDriver = dependencies.sessionDriver
    this.sessionDriver.subscribe((event) => {
      this.applyAgentEvent(event)
      this.emit(event)
    })
  }

  /**
   * 读取当前运行时快照并写入 Runtime 缓存。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 读取失败时，Promise 会 reject。
   */
  async getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return this.runtimeSnapshot
  }

  /**
   * 刷新运行时资源并写入 Runtime 缓存。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 刷新失败时，Promise 会 reject。
   */
  async refreshRuntime(): Promise<RuntimeSnapshot> {
    this.runtimeSnapshot = await this.runtimeDriver.refresh()
    return this.runtimeSnapshot
  }

  /**
   * 验证并保存运行时配置，再写入 Runtime 缓存。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少保存能力或验证失败时，Promise 会 reject。
   */
  async saveRuntimeConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.saveConfiguration) {
      throw new Error('当前运行时不支持保存配置。')
    }

    this.runtimeSnapshot =
      await this.runtimeDriver.saveConfiguration(configuration)
    return this.runtimeSnapshot
  }

  /**
   * 取消正在进行的运行时配置验证，再刷新 Runtime 缓存。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少取消能力或取消失败时，Promise 会 reject。
   */
  async cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.cancelConfigurationVerification) {
      throw new Error('当前运行时不支持取消配置验证。')
    }

    this.runtimeSnapshot =
      await this.runtimeDriver.cancelConfigurationVerification(request)
    return this.runtimeSnapshot
  }

  /**
   * 读取默认 Agent 的会话摘要列表并写入 Runtime 缓存。
   *
   * @returns 会话摘要列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async listSessions(): Promise<AgentSessionSummary[]> {
    const driverSessions = await this.sessionDriver.listSessions({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
    })
    this.sessions = driverSessions.map((session) => ({
      ...session,
      state: this.activeRunIds.has(session.sessionId)
        ? 'running'
        : session.state,
    }))
    return this.sessions
  }

  /**
   * 创建会话并把结果合并到 Runtime 缓存。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 AgentSessionDriver 创建失败时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    await this.assertRuntimeReady()

    const session = await this.sessionDriver.createSession(request)
    this.sessions = [
      session,
      ...this.sessions.filter(
        (candidate) => candidate.sessionId !== session.sessionId,
      ),
    ]
    return session
  }

  /**
   * 读取指定会话的消息列表。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 当前会话消息列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async getMessages(
    request: GetSessionMessagesRequest,
  ): Promise<AgentMessage[]> {
    if (this.messagesBySession.has(request.sessionId)) {
      return [...(this.messagesBySession.get(request.sessionId) ?? [])]
    }

    const messages = await this.sessionDriver.getMessages(request)
    this.messagesBySession.set(request.sessionId, messages)

    return messages
  }

  /**
   * 向指定会话发送消息，并返回发送完成后的最新对话消息。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后的当前会话消息列表。
   * @throws 当运行时缺少配置、会话不存在或 AgentSessionDriver 发送失败时，Promise 会 reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<AgentMessage[]> {
    await this.assertRuntimeReady()

    const session =
      this.sessions.find(
        (candidate) => candidate.sessionId === request.sessionId,
      ) ?? (await this.findSession(request.sessionId))

    if (
      this.activeRunIds.has(request.sessionId) ||
      session?.state === 'running'
    ) {
      throw new Error('当前会话正在运行，请等待完成或先取消本次响应。')
    }

    await this.sessionDriver.sendMessage(request)

    return this.getMessages({
      agentId: request.agentId,
      sessionId: request.sessionId,
    })
  }

  /**
   * 取消指定会话正在运行的 Agent 响应，并返回更新后的摘要。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 取消后的会话摘要。
   * @throws 当会话不存在或 AgentSessionDriver 取消失败时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary> {
    await this.sessionDriver.cancelRun(request)
    this.activeRunIds.delete(request.sessionId)
    await this.listSessions()
    const session = this.sessions.find(
      (candidate) => candidate.sessionId === request.sessionId,
    )

    if (!session) {
      throw new Error(`找不到会话 ${request.sessionId}。`)
    }

    return session
  }

  /**
   * 订阅 Runtime 转发的 Agent 标准事件。
   *
   * @param listener - 事件监听回调。
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
   * 取消所有仍处于 running 状态的会话。
   *
   * @returns 无返回值。
   * @throws 当底层 Driver 取消失败时，Promise 会 reject。
   */
  async cancelAllActiveRuns(): Promise<void> {
    const runningSessions = this.sessions.filter(
      (session) =>
        session.state === 'running' || this.activeRunIds.has(session.sessionId),
    )

    await Promise.all(
      runningSessions.map((session) =>
        this.cancelRun({
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ),
    )
  }

  /**
   * 确认运行时快照已经满足会话启动条件。
   *
   * @returns 无返回值。
   * @throws 当 Provider、模型或 API Key 缺失时抛出可读错误。
   */
  private async assertRuntimeReady(): Promise<void> {
    const snapshot = this.runtimeSnapshot ?? (await this.getRuntimeSnapshot())

    if (snapshot.status !== 'ready') {
      throw new Error(
        '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
      )
    }
  }

  /**
   * 从当前缓存或 Driver 会话列表中查找会话摘要。
   *
   * @param sessionId - 需要查找的会话标识。
   * @returns 找到时返回会话摘要，否则返回 undefined。
   * @throws 当 Driver 读取会话列表失败时，Promise 会 reject。
   */
  private async findSession(
    sessionId: string,
  ): Promise<AgentSessionSummary | undefined> {
    const cachedSession = this.sessions.find(
      (session) => session.sessionId === sessionId,
    )

    if (cachedSession) {
      return cachedSession
    }

    await this.listSessions()

    return this.sessions.find((session) => session.sessionId === sessionId)
  }

  /**
   * 把 Driver 事件归并到 Runtime 的本地缓存。
   *
   * @param event - Driver 发出的标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private applyAgentEvent(event: AgentEvent): void {
    if (event.type === 'session-created') {
      this.upsertSession(event.session)
      this.messagesBySession.set(event.session.sessionId, [])
      return
    }

    if (event.type === 'message-appended') {
      this.upsertMessage(event.message)
      return
    }

    if (event.type === 'turn-started') {
      this.activeRunIds.set(event.sessionId, event.runId)
      this.upsertSessionState(event.sessionId, 'running', event.occurredAt)
      return
    }

    if (event.type === 'message-delta') {
      this.appendDelta(event)
      return
    }

    if (event.type === 'message-completed') {
      this.upsertMessage(event.message)
      return
    }

    if (event.type === 'activity-updated') {
      this.upsertActivityMessage(event)
      return
    }

    if (event.type === 'turn-cancelled') {
      this.activeRunIds.delete(event.sessionId)
      this.upsertSessionState(event.sessionId, 'cancelled', event.occurredAt)
      return
    }

    if (event.type === 'turn-failed') {
      this.activeRunIds.delete(event.sessionId)
      this.upsertSessionState(event.sessionId, 'failed', event.occurredAt)
      this.upsertMessage({
        messageId: `${event.sessionId}-${event.runId}-error`,
        agentId: event.agentId,
        sessionId: event.sessionId,
        role: 'system',
        content: event.error.message,
        createdAt: event.occurredAt,
      })
      return
    }

    if (event.type === 'run-state-changed') {
      this.upsertSessionState(event.sessionId, event.state, event.occurredAt)

      if (event.state !== 'running') {
        this.activeRunIds.delete(event.sessionId)
      }
    }
  }

  /**
   * 新增或替换会话摘要，并保持最近更新会话排在前面。
   *
   * @param session - 需要写入缓存的会话摘要。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private upsertSession(session: AgentSessionSummary): void {
    this.sessions = [
      session,
      ...this.sessions.filter(
        (candidate) => candidate.sessionId !== session.sessionId,
      ),
    ]
  }

  /**
   * 更新指定会话的运行状态。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param state - 新运行状态。
   * @param updatedAt - 状态更新时间。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private upsertSessionState(
    sessionId: string,
    state: AgentSessionSummary['state'],
    updatedAt: string,
  ): void {
    this.sessions = this.sessions.map((session) =>
      session.sessionId === sessionId
        ? { ...session, state, updatedAt }
        : session,
    )
  }

  /**
   * 新增或替换对话消息。
   *
   * @param message - 需要写入缓存的消息。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private upsertMessage(message: AgentMessage): void {
    const messages = this.messagesBySession.get(message.sessionId) ?? []
    const messageExists = messages.some(
      (candidate) => candidate.messageId === message.messageId,
    )
    const nextMessages = messageExists
      ? messages.map((candidate) =>
          candidate.messageId === message.messageId ? message : candidate,
        )
      : [...messages, message]
    this.messagesBySession.set(message.sessionId, nextMessages)
  }

  /**
   * 把文本增量拼接进对应 Agent 消息。
   *
   * @param event - message-delta 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private appendDelta(
    event: Extract<AgentEvent, { type: 'message-delta' }>,
  ): void {
    const messages = this.messagesBySession.get(event.sessionId) ?? []
    const messageIndex = messages.findIndex(
      (message) => message.messageId === event.messageId,
    )

    if (messageIndex === -1) {
      this.messagesBySession.set(event.sessionId, [
        ...messages,
        {
          messageId: event.messageId,
          agentId: event.agentId,
          sessionId: event.sessionId,
          role: 'agent',
          content: event.delta,
          createdAt: event.occurredAt,
        },
      ])
      return
    }

    const nextMessages = [...messages]
    const currentMessage = nextMessages[messageIndex]

    if (!currentMessage) {
      return
    }

    nextMessages[messageIndex] = {
      ...currentMessage,
      content: `${currentMessage.content}${event.delta}`,
    }
    this.messagesBySession.set(event.sessionId, nextMessages)
  }

  /**
   * 把 thinking/tool 活动写成可见但不含敏感参数的系统消息。
   *
   * @param event - activity-updated 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private upsertActivityMessage(
    event: Extract<AgentEvent, { type: 'activity-updated' }>,
  ): void {
    this.upsertMessage({
      messageId: `${event.sessionId}-${event.runId}-${event.activity.kind}`,
      agentId: event.agentId,
      sessionId: event.sessionId,
      role: 'system',
      content: event.activity.label,
      createdAt: event.occurredAt,
    })
  }

  /**
   * 向 Runtime 订阅者广播标准事件。
   *
   * @param event - 需要广播的标准事件。
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
 * 使用可控 Driver 创建测试用 TangyuanRuntime。
 *
 * @param dependencies - 测试提供的运行时资源与会话 Driver。
 * @returns 通过公开 TangyuanRuntime 方法观察行为的测试实例。
 * @throws 此方法不会主动抛出错误。
 */
export function createTangyuanRuntimeForTesting(
  dependencies: TangyuanRuntimeDependencies,
): TangyuanRuntime {
  return new DefaultTangyuanRuntime(dependencies)
}

/**
 * Electron Main 可以调用的 TangyuanRuntime 高层能力集合。
 */
export type TangyuanRuntime = Pick<
  DefaultTangyuanRuntime,
  | 'getRuntimeSnapshot'
  | 'refreshRuntime'
  | 'saveRuntimeConfiguration'
  | 'cancelRuntimeConfigurationVerification'
  | 'listSessions'
  | 'createSession'
  | 'getMessages'
  | 'sendMessage'
  | 'cancelRun'
  | 'subscribe'
  | 'cancelAllActiveRuns'
>
