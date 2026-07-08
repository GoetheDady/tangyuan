import type { AgentSessionDriver, RuntimeResourceDriver } from '@tangyuan/agent-runtime'
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
  type SendMessageRequest
} from '@tangyuan/shared'

/**
 * 创建 DesktopAppStore 时需要注入的 Driver。
 */
export interface DesktopAppStoreDependencies {
  runtimeDriver: RuntimeResourceDriver
  sessionDriver: AgentSessionDriver
}

/**
 * 描述 Main 侧供 IPC 层调用的应用状态中心。
 */
export interface DesktopAppStore {
  /**
   * 读取当前运行时快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 读取失败时，Promise 会 reject。
   */
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>

  /**
   * 刷新运行时资源。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 刷新失败时，Promise 会 reject。
   */
  refreshRuntime(): Promise<RuntimeSnapshot>

  /**
   * 验证并保存运行时配置。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少保存能力或验证失败时，Promise 会 reject。
   */
  saveRuntimeConfiguration(configuration: RuntimeConfiguration): Promise<RuntimeSnapshot>

  /**
   * 取消正在进行的运行时配置验证。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少取消能力或取消失败时，Promise 会 reject。
   */
  cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest
  ): Promise<RuntimeSnapshot>

  /**
   * 读取默认 Agent 的会话摘要列表。
   *
   * @returns 会话摘要列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  listSessions(): Promise<AgentSessionSummary[]>

  /**
   * 创建一个新的 Agent 会话。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 AgentSessionDriver 创建失败时，Promise 会 reject。
   */
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>

  /**
   * 读取指定会话的 transcript。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 当前会话消息列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]>

  /**
   * 向指定会话发送用户消息。
   *
   * @param request - 会话所属 Agent、会话标识和消息内容。
   * @returns 发送完成后的当前会话消息列表。
   * @throws 当运行时缺少配置、会话不存在或 AgentSessionDriver 发送失败时，Promise 会 reject。
   */
  sendMessage(request: SendMessageRequest): Promise<AgentMessage[]>

  /**
   * 取消指定会话正在运行的 Agent 响应。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 取消后的会话摘要。
   * @throws 当会话不存在或 AgentSessionDriver 取消失败时，Promise 会 reject。
   */
  cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>
}

/**
 * 创建 Main 侧桌面应用状态中心。
 *
 * @param dependencies - Runtime 和会话 Driver。
 * @returns 可被 IPC 层调用的 DesktopAppStore。
 * @throws 此方法不会主动抛出错误。
 */
export function createDesktopAppStore(dependencies: DesktopAppStoreDependencies): DesktopAppStore {
  return new DefaultDesktopAppStore(dependencies)
}

class DefaultDesktopAppStore implements DesktopAppStore {
  private readonly runtimeDriver: RuntimeResourceDriver
  private readonly sessionDriver: AgentSessionDriver
  private runtimeSnapshot: RuntimeSnapshot | null = null
  private sessions: AgentSessionSummary[] = []

  /**
   * 创建默认 DesktopAppStore。
   *
   * @param dependencies - Runtime 和会话 Driver。
   * @returns DefaultDesktopAppStore 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(dependencies: DesktopAppStoreDependencies) {
    this.runtimeDriver = dependencies.runtimeDriver
    this.sessionDriver = dependencies.sessionDriver
  }

  /**
   * 读取当前运行时快照并写入 Store 缓存。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 读取失败时，Promise 会 reject。
   */
  async getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return this.runtimeSnapshot
  }

  /**
   * 刷新运行时资源并写入 Store 缓存。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 刷新失败时，Promise 会 reject。
   */
  async refreshRuntime(): Promise<RuntimeSnapshot> {
    this.runtimeSnapshot = await this.runtimeDriver.refresh()
    return this.runtimeSnapshot
  }

  /**
   * 验证并保存运行时配置，再写入 Store 缓存。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少保存能力或验证失败时，Promise 会 reject。
   */
  async saveRuntimeConfiguration(configuration: RuntimeConfiguration): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.saveConfiguration) {
      throw new Error('当前运行时不支持保存配置。')
    }

    this.runtimeSnapshot = await this.runtimeDriver.saveConfiguration(configuration)
    return this.runtimeSnapshot
  }

  /**
   * 取消正在进行的运行时配置验证，再刷新 Store 缓存。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少取消能力或取消失败时，Promise 会 reject。
   */
  async cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest
  ): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.cancelConfigurationVerification) {
      throw new Error('当前运行时不支持取消配置验证。')
    }

    this.runtimeSnapshot = await this.runtimeDriver.cancelConfigurationVerification(request)
    return this.runtimeSnapshot
  }

  /**
   * 读取默认 Agent 的会话摘要列表并写入 Store 缓存。
   *
   * @returns 会话摘要列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async listSessions(): Promise<AgentSessionSummary[]> {
    this.sessions = await this.sessionDriver.listSessions({
      agentId: TANGYUAN_DEFAULT_AGENT_ID
    })
    return this.sessions
  }

  /**
   * 创建会话并把结果合并到 Store 缓存。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 AgentSessionDriver 创建失败时，Promise 会 reject。
   */
  async createSession(request: CreateSessionRequest): Promise<AgentSessionSummary> {
    await this.assertRuntimeReady()

    const session = await this.sessionDriver.createSession(request)
    this.sessions = [
      session,
      ...this.sessions.filter((candidate) => candidate.sessionId !== session.sessionId)
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
  async getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]> {
    return this.sessionDriver.getMessages(request)
  }

  /**
   * 向指定会话发送消息，并返回发送完成后的最新 transcript。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后的当前会话消息列表。
   * @throws 当运行时缺少配置、会话不存在或 AgentSessionDriver 发送失败时，Promise 会 reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<AgentMessage[]> {
    await this.assertRuntimeReady()
    await this.sessionDriver.sendMessage(request)
    this.sessions = await this.sessionDriver.listSessions({
      agentId: TANGYUAN_DEFAULT_AGENT_ID
    })

    return this.sessionDriver.getMessages({
      agentId: request.agentId,
      sessionId: request.sessionId
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
    this.sessions = await this.sessionDriver.listSessions({
      agentId: TANGYUAN_DEFAULT_AGENT_ID
    })
    const session = this.sessions.find((candidate) => candidate.sessionId === request.sessionId)

    if (!session) {
      throw new Error(`找不到会话 ${request.sessionId}。`)
    }

    return session
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
        '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。'
      )
    }
  }
}
