import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentSessionDriver,
  RuntimeResourceDriver,
  ToolApprovalGateway,
} from './index'
import { TranscriptEmitter } from './transcript-emitter'
import { resolve as pathResolve } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  buildTranscriptSnapshot,
  type AgentMessage,
  type AgentSessionSummary,
  type AgentSummary,
  type BashApprovalRequest,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type ProfileMaintenanceResult,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SkillApprovalRequest,
  type SkillInstallRecord,
  type SkillOperationParams,
  type SkillSummary,
  type SoulContent,
  type TranscriptSnapshot,
  type UpdateAgentConfigRequest,
  type UserProfileContent,
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
  private static readonly MAX_CONCURRENT_RUNS = 4
  private readonly runtimeDriver: RuntimeResourceDriver
  private readonly sessionDriver: AgentSessionDriver
  private readonly listeners = new Set<AgentEventListener>()
  private readonly messagesBySession = new Map<string, AgentMessage[]>()
  private readonly activeRunIds = new Map<string, string>()
  private readonly transcriptEmitter: TranscriptEmitter
  private runtimeSnapshot: RuntimeSnapshot | null = null
  private sessions: AgentSessionSummary[] = []
  private runQueue: Array<{
    request: SendMessageRequest
    resolve: (value: AgentMessage[]) => void
    reject: (error: Error) => void
  }> = []
  private readonly pendingApprovals = new Map<
    string,
    {
      request: BashApprovalRequest
      resolve: (result: { approved: boolean }) => void
    }
  >()
  private readonly skillApprovals = new Map<
    string,
    {
      request: SkillApprovalRequest
      resolve: (result: { approved: boolean }) => void
    }
  >()

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
    this.transcriptEmitter = new TranscriptEmitter(this.emit.bind(this))
    this.sessionDriver.subscribe((event) => {
      this.applyAgentEvent(event)
      this.emit(event)
      // 当 run 结束（完成/取消/失败）时，释放 slot 并启动下一个排队请求
      if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed' ||
        (event.type === 'run-state-changed' &&
          event.state !== 'running' &&
          event.state !== 'queued')
      ) {
        this.dequeueNext()
      }
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
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少恢复能力或恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.restoreFromBackup) {
      throw new Error('当前运行时不支持配置恢复。')
    }

    this.runtimeSnapshot = await this.runtimeDriver.restoreFromBackup()
    return this.runtimeSnapshot
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少重置能力或重置失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<RuntimeSnapshot> {
    if (!this.runtimeDriver.resetConfiguration) {
      throw new Error('当前运行时不支持配置重置。')
    }

    await this.runtimeDriver.resetConfiguration()
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return this.runtimeSnapshot
  }

  /**
   * 读取默认 Agent 的会话摘要列表并写入 Runtime 缓存。
   *
   * @returns 会话摘要列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async listSessions(
    agentId: string = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<AgentSessionSummary[]> {
    const driverSessions = await this.sessionDriver.listSessions({
      agentId,
    })
    this.sessions = driverSessions.map((session) => ({
      ...session,
      state: this.activeRunIds.has(session.sessionId)
        ? 'running'
        : this.runQueue.some((q) => q.request.sessionId === session.sessionId)
          ? 'queued'
          : session.state,
    }))
    return this.sessions
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当 RuntimeResourceDriver 读取配置失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    const snapshot = this.runtimeSnapshot ?? (await this.getRuntimeSnapshot())
    return snapshot.agents
  }

  /**
   * 创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当 AgentSessionDriver 不支持创建或创建失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    if (!this.sessionDriver.createAgent) {
      throw new Error('当前运行时不支持创建 Agent。')
    }
    const summary = await this.sessionDriver.createAgent(displayName)
    // 刷新运行时快照以包含新 Agent
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param request - Agent 标识和要更新的配置字段。
   * @returns 更新后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或更新失败时，Promise 会 reject。
   */
  async updateAgentConfig(
    request: UpdateAgentConfigRequest,
  ): Promise<AgentSummary> {
    if (!this.sessionDriver.updateAgentConfig) {
      throw new Error('当前运行时不支持更新 Agent 配置。')
    }

    const summary = await this.sessionDriver.updateAgentConfig(
      request.agentId,
      {
        ...(request.defaultProviderId !== undefined
          ? { defaultProviderId: request.defaultProviderId }
          : {}),
        ...(request.defaultModelId !== undefined
          ? { defaultModelId: request.defaultModelId }
          : {}),
      },
    )

    // 刷新运行时快照以反映配置变更
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或归档失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: string): Promise<AgentSummary> {
    if (!this.sessionDriver.archiveAgent) {
      throw new Error('当前运行时不支持归档 Agent。')
    }

    const summary = await this.sessionDriver.archiveAgent(agentId)
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或恢复失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: string): Promise<AgentSummary> {
    if (!this.sessionDriver.recoverAgent) {
      throw new Error('当前运行时不支持恢复 Agent。')
    }

    const summary = await this.sessionDriver.recoverAgent(agentId)
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 执行目录对账：对照配置检查 Agent 目录存在性，扫描发现未归属目录。
   *
   * @returns 对账报告。
   * @throws 当 AgentSessionDriver 不支持或对账失败时，Promise 会 reject。
   */
  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: import('@tangyuan/contracts').UnclaimedDirectory[]
  }> {
    if (!this.sessionDriver.reconcileAgentDirectories) {
      throw new Error('当前运行时不支持目录对账。')
    }

    return this.sessionDriver.reconcileAgentDirectories()
  }

  /**
   * 认领未归属的 Agent 目录。
   *
   * @param agentId - 目录名称（作为 agentId）。
   * @param displayName - Agent 展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或认领失败时，Promise 会 reject。
   */
  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    if (!this.sessionDriver.claimAgentDirectory) {
      throw new Error('当前运行时不支持认领 Agent 目录。')
    }

    const summary = await this.sessionDriver.claimAgentDirectory(
      agentId,
      displayName,
    )
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或重建失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    if (!this.sessionDriver.rebuildTangyuanHome) {
      throw new Error('当前运行时不支持重建汤圆目录。')
    }

    const summary = await this.sessionDriver.rebuildTangyuanHome()
    this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    return summary
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    if (!this.sessionDriver.getSessionModelInfo) {
      throw new Error('当前运行时不支持读取 Session 模型信息。')
    }

    return this.sessionDriver.getSessionModelInfo(request)
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 AgentSessionDriver 不支持或切换失败时，Promise 会 reject。
   */
  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    if (!this.sessionDriver.setSessionModel) {
      throw new Error('当前运行时不支持切换 Session 模型。')
    }

    return this.sessionDriver.setSessionModel(request)
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 AgentSessionDriver 不支持或切换失败时，Promise 会 reject。
   */
  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    if (!this.sessionDriver.setSessionThinkingLevel) {
      throw new Error('当前运行时不支持切换 Thinking Level。')
    }

    return this.sessionDriver.setSessionThinkingLevel(request)
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    if (!this.sessionDriver.listAgentSkills) {
      throw new Error('当前运行时不支持读取 Agent Skills。')
    }

    return this.sessionDriver.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    if (!this.sessionDriver.listSharedSkills) {
      throw new Error('当前运行时不支持读取共享 Skills。')
    }

    return this.sessionDriver.listSharedSkills()
  }

  /**
   * 重新加载指定 Agent 所有活跃 session 的 ResourceLoader。
   *
   * 用于 Agent 专属 Skill 变更后刷新该 Agent 的会话。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当 AgentSessionDriver 不支持或 reload 失败时，Promise 会 reject。
   */
  async reloadAgentSessions(agentId: string): Promise<void> {
    if (!this.sessionDriver.reloadAgentSessions) {
      throw new Error('当前运行时不支持重新加载 Agent session。')
    }

    return this.sessionDriver.reloadAgentSessions(agentId)
  }

  /**
   * 重新加载全部活跃 session 的 ResourceLoader。
   *
   * 用于共享 Skill 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当 AgentSessionDriver 不支持或 reload 失败时，Promise 会 reject。
   */
  async reloadAllSessions(): Promise<void> {
    if (!this.sessionDriver.reloadAllSessions) {
      throw new Error('当前运行时不支持重新加载全部 session。')
    }

    return this.sessionDriver.reloadAllSessions()
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: string): Promise<SoulContent> {
    if (!this.sessionDriver.getSoul) {
      throw new Error('当前运行时不支持读取 Agent soul。')
    }

    return this.sessionDriver.getSoul(agentId)
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    if (!this.sessionDriver.getUserProfile) {
      throw new Error('当前运行时不支持读取 user profile。')
    }

    return this.sessionDriver.getUserProfile()
  }

  /**
   * 更新指定 Agent 的 soul 内容。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @returns profile 维护结果。
   * @throws 当 AgentSessionDriver 不支持或操作失败时，Promise 会 reject。
   */
  async updateSoul(
    agentId: string,
    content: string,
  ): Promise<ProfileMaintenanceResult> {
    if (!this.sessionDriver.updateSoul) {
      throw new Error('当前运行时不支持更新 Agent soul。')
    }

    // 使用 activeAgent 作为请求发起方进行权限校验
    const snapshot = this.runtimeSnapshot ?? (await this.getRuntimeSnapshot())
    const result = await this.sessionDriver.updateSoul(
      agentId,
      content,
      snapshot.activeAgent.agentId,
    )

    // 更新成功后刷新运行时快照以获取最新 profile 时间戳
    if (result.success) {
      this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    }

    return result
  }

  /**
   * 更新共享 user profile 内容。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当 AgentSessionDriver 不支持或操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileMaintenanceResult> {
    if (!this.sessionDriver.updateUserProfile) {
      throw new Error('当前运行时不支持更新 user profile。')
    }

    const result = await this.sessionDriver.updateUserProfile(content)

    // 更新成功后刷新运行时快照以获取最新 profile 时间戳
    if (result.success) {
      this.runtimeSnapshot = await this.runtimeDriver.getSnapshot()
    }

    return result
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
   * 读取指定会话的结构化 transcript 快照。
   *
   * 从本地消息缓存构建 TranscriptSnapshot；
   * 缓存未命中时通过 Driver 加载消息后再构建。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 结构化会话快照。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot> {
    const messages = await this.getMessages(request)

    return buildTranscriptSnapshot(
      messages,
      request.sessionId,
      request.agentId,
      new Date().toISOString(),
    )
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

    // 检查会话是否已在队列中
    if (this.runQueue.some((q) => q.request.sessionId === request.sessionId)) {
      throw new Error('当前会话已在排队中，请等待或取消排队。')
    }

    // 达到并发上限时入队
    if (this.activeRunIds.size >= DefaultTangyuanRuntime.MAX_CONCURRENT_RUNS) {
      return this.enqueueRun(request)
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
    // 自动拒绝该 session 的所有待审批请求
    this.rejectSessionPendingApprovals(request.sessionId)

    // 先检查队列中的待处理请求
    const queueIndex = this.runQueue.findIndex(
      (q) => q.request.sessionId === request.sessionId,
    )

    if (queueIndex >= 0) {
      const [queued] = this.runQueue.splice(queueIndex, 1)
      const now = new Date().toISOString()
      this.emit({
        type: 'run-state-changed',
        agentId: request.agentId,
        sessionId: request.sessionId,
        state: 'cancelled',
        occurredAt: now,
      })
      this.upsertSessionState(request.sessionId, 'cancelled', now)
      queued!.resolve([])
      return (
        this.sessions.find((s) => s.sessionId === request.sessionId) ?? {
          agentId: request.agentId,
          sessionId: request.sessionId,
          title: '',
          state: 'cancelled',
          updatedAt: now,
        }
      )
    }

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
    // 自动拒绝所有待审批请求
    this.rejectAllPendingApprovals()
    this.rejectAllPendingSkillApprovals()

    // 清空队列
    const queue = [...this.runQueue]
    this.runQueue.length = 0
    for (const queued of queue) {
      queued.resolve([])
    }

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
   * 批准指定 Bash 审批请求，使命令继续执行。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async approveBash(approvalId: string): Promise<void> {
    const entry = this.pendingApprovals.get(approvalId)

    if (!entry) {
      throw new Error(`找不到审批请求 ${approvalId}，可能已过期或已被处理。`)
    }

    this.pendingApprovals.delete(approvalId)
    const now = new Date().toISOString()

    this.emit({
      type: 'approval-resolved',
      agentId: entry.request.agentId,
      sessionId: entry.request.sessionId,
      approvalId,
      status: 'approved',
      occurredAt: now,
    })

    entry.resolve({ approved: true })
  }

  /**
   * 拒绝指定 Bash 审批请求，向 Agent 返回拒绝结果。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async rejectBash(approvalId: string): Promise<void> {
    const entry = this.pendingApprovals.get(approvalId)

    if (!entry) {
      throw new Error(`找不到审批请求 ${approvalId}，可能已过期或已被处理。`)
    }

    this.pendingApprovals.delete(approvalId)
    const now = new Date().toISOString()

    this.emit({
      type: 'approval-resolved',
      agentId: entry.request.agentId,
      sessionId: entry.request.sessionId,
      approvalId,
      status: 'rejected',
      occurredAt: now,
    })

    entry.resolve({ approved: false })
  }

  /**
   * 读取所有待审批的 Bash 请求。
   *
   * @returns 待审批请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingApprovals(): BashApprovalRequest[] {
    return [...this.pendingApprovals.values()].map((entry) => entry.request)
  }

  /**
   * 安装或更新 Skill（含权限校验和审批）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、校验失败或 Driver 不支持时，Promise 会 reject。
   */
  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validateSkillOperationPermission(params)

    if (!this.sessionDriver.installSkill) {
      throw new Error('当前运行时不支持安装 Skill。')
    }

    // 创建审批并等待用户决议
    const approved = await this.requestSkillApproval(params)
    if (!approved) {
      throw new Error('用户拒绝了 Skill 操作。')
    }

    // 执行安装
    const result = await this.sessionDriver.installSkill(params)

    // 根据来源决定 reload 范围
    if (params.source === 'shared') {
      await this.reloadAllSessions()
    } else if (params.targetAgentId) {
      await this.reloadAgentSessions(params.targetAgentId)
    }

    return result
  }

  /**
   * 删除 Skill（含权限校验和审批）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足或 Driver 不支持时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validateSkillOperationPermission(params)

    if (!this.sessionDriver.deleteSkill) {
      throw new Error('当前运行时不支持删除 Skill。')
    }

    // 创建审批并等待用户决议
    const approved = await this.requestSkillApproval(params)
    if (!approved) {
      throw new Error('用户拒绝了 Skill 操作。')
    }

    // 执行删除
    const result = await this.sessionDriver.deleteSkill(params)

    // 根据来源决定 reload 范围
    if (params.source === 'shared') {
      await this.reloadAllSessions()
    } else if (params.targetAgentId) {
      await this.reloadAgentSessions(params.targetAgentId)
    }

    return result
  }

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async approveSkillOperation(approvalId: string): Promise<void> {
    const entry = this.skillApprovals.get(approvalId)

    if (!entry) {
      throw new Error(
        `找不到 Skill 审批请求 ${approvalId}，可能已过期或已被处理。`,
      )
    }

    this.skillApprovals.delete(approvalId)
    const now = new Date().toISOString()

    this.emit({
      type: 'skill-approval-resolved',
      agentId: entry.request.agentId,
      approvalId,
      status: 'approved',
      occurredAt: now,
    })

    entry.resolve({ approved: true })
  }

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async rejectSkillOperation(approvalId: string): Promise<void> {
    const entry = this.skillApprovals.get(approvalId)

    if (!entry) {
      throw new Error(
        `找不到 Skill 审批请求 ${approvalId}，可能已过期或已被处理。`,
      )
    }

    this.skillApprovals.delete(approvalId)
    const now = new Date().toISOString()

    this.emit({
      type: 'skill-approval-resolved',
      agentId: entry.request.agentId,
      approvalId,
      status: 'rejected',
      occurredAt: now,
    })

    entry.resolve({ approved: false })
  }

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingSkillApprovals(): SkillApprovalRequest[] {
    return [...this.skillApprovals.values()].map((entry) => entry.request)
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    if (!this.sessionDriver.getSkillInstallRecords) {
      throw new Error('当前运行时不支持读取 Skill 安装记录。')
    }

    return this.sessionDriver.getSkillInstallRecords()
  }

  /**
   * 校验 Skill 操作权限。
   *
   * @param params - 操作参数。
   * @returns 无返回值。
   * @throws 当权限不足时抛出可读错误。
   */
  private validateSkillOperationPermission(params: SkillOperationParams): void {
    if (params.source === 'shared') {
      // 共享 Skill 只能由汤圆管理
      if (params.agentId !== TANGYUAN_DEFAULT_AGENT_ID) {
        throw new Error(
          `只有默认 Agent「汤圆」可以管理共享 Skill，当前 Agent "${params.agentId}" 无权操作。`,
        )
      }
    } else {
      // 专属 Skill：只能由 Agent 自身或汤圆管理
      const targetId = params.targetAgentId ?? params.agentId
      if (
        params.agentId !== targetId &&
        params.agentId !== TANGYUAN_DEFAULT_AGENT_ID
      ) {
        throw new Error(
          `Agent "${params.agentId}" 无权管理 Agent "${targetId}" 的专属 Skill。只有 Agent 自身或汤圆可以操作。`,
        )
      }
    }
  }

  /**
   * 创建 Skill 操作审批请求并等待用户决议。
   *
   * @param params - 操作参数。
   * @returns Promise 在用户批准时 resolve true，拒绝时 resolve false。
   * @throws 此方法不会主动抛出错误。
   */
  private async requestSkillApproval(
    params: SkillOperationParams,
  ): Promise<boolean> {
    const approvalId = crypto.randomUUID()
    const now = new Date().toISOString()

    const request: SkillApprovalRequest = {
      approvalId,
      agentId: params.agentId,
      operation: params.operation,
      source: params.source,
      ...(params.targetAgentId !== undefined
        ? { targetAgentId: params.targetAgentId }
        : {}),
      skillName: params.skillName,
      description: '',
      hasScripts: false,
      status: 'pending',
      createdAt: now,
    }

    return new Promise<boolean>((resolve) => {
      this.skillApprovals.set(approvalId, {
        request,
        resolve: (result: { approved: boolean }) => resolve(result.approved),
      })

      this.emit({
        type: 'skill-approval-required',
        agentId: params.agentId,
        approval: request,
        occurredAt: now,
      })
    })
  }

  /**
   * 创建工具审批与路径校验网关。
   *
   * @returns 供 PiSdkDriver 注入到自定义工具中的 ToolApprovalGateway 实例。
   * @throws 此方法不会主动抛出错误。
   */
  createToolApprovalGateway(): ToolApprovalGateway {
    return {
      requestBashApproval: async (params) => {
        const approvalId = crypto.randomUUID()
        const now = new Date().toISOString()
        const request: BashApprovalRequest = {
          approvalId,
          agentId: params.agentId,
          sessionId: params.sessionId,
          runId: params.runId,
          command: params.command,
          cwd: params.cwd,
          riskDescription: params.riskDescription,
          status: 'pending',
          createdAt: now,
        }

        return new Promise<{ approved: boolean }>((resolve) => {
          this.pendingApprovals.set(approvalId, { request, resolve })

          this.emit({
            type: 'approval-required',
            agentId: params.agentId,
            sessionId: params.sessionId,
            approval: request,
            occurredAt: now,
          })
        })
      },

      validateFilePath: (params) => {
        return this.validateFilePath(params)
      },
    }
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
      this.transcriptEmitter.emitTranscriptDeltaForMessageAppended(event)
      return
    }

    if (event.type === 'turn-started') {
      this.activeRunIds.set(event.sessionId, event.runId)
      this.upsertSessionState(event.sessionId, 'running', event.occurredAt)
      this.transcriptEmitter.startAttemptForRun(event)
      this.transcriptEmitter.initializeTurnStateForRun(event)
      return
    }

    if (event.type === 'message-delta') {
      this.appendDelta(event)
      if (event.deltaKind === 'thinking') {
        this.transcriptEmitter.emitTranscriptDeltaForThinking(event)
      } else {
        this.transcriptEmitter.emitTranscriptDeltaForDelta(event)
      }
      return
    }

    if (event.type === 'message-completed') {
      this.upsertMessage(event.message)
      this.transcriptEmitter.completeAttemptForRun(event)
      return
    }

    if (event.type === 'activity-updated') {
      this.upsertActivityMessage(event)
      this.transcriptEmitter.emitTranscriptDeltaForActivity(event)
      return
    }

    if (event.type === 'turn-cancelled') {
      this.activeRunIds.delete(event.sessionId)
      this.upsertSessionState(event.sessionId, 'cancelled', event.occurredAt)
      this.transcriptEmitter.failAttemptForRun(event.sessionId, event.runId, 'cancelled', event.occurredAt)
      return
    }

    if (event.type === 'turn-failed') {
      this.activeRunIds.delete(event.sessionId)
      this.upsertSessionState(event.sessionId, 'failed', event.occurredAt)
      this.transcriptEmitter.failAttemptForRun(event.sessionId, event.runId, 'failed', event.occurredAt)
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
   * 将请求加入调度队列并广播 queued 状态。
   *
   * @param request - 需要排队等待的消息发送请求。
   * @returns 排队完成后 resolve 的 Promise，含最终消息列表。
   * @throws 此方法不会主动抛出错误。
   */
  private enqueueRun(request: SendMessageRequest): Promise<AgentMessage[]> {
    const now = new Date().toISOString()
    this.emit({
      type: 'run-state-changed',
      agentId: request.agentId,
      sessionId: request.sessionId,
      state: 'queued',
      occurredAt: now,
    })
    this.upsertSessionState(request.sessionId, 'queued', now)

    return new Promise<AgentMessage[]>((resolve, reject) => {
      this.runQueue.push({ request, resolve, reject })
    })
  }

  /**
   * 从队列头部取出下一个请求并启动执行。
   *
   * 由 run 结束事件触发，确保始终只有一个 slot 释放时启动一个新 run。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private dequeueNext(): void {
    const queued = this.runQueue.shift()
    if (!queued) {
      return
    }

    const { request, resolve, reject } = queued
    const now = new Date().toISOString()

    this.emit({
      type: 'run-state-changed',
      agentId: request.agentId,
      sessionId: request.sessionId,
      state: 'running',
      occurredAt: now,
    })
    this.upsertSessionState(request.sessionId, 'running', now)

    this.sessionDriver
      .sendMessage(request)
      .then(async () =>
        resolve(
          await this.getMessages({
            agentId: request.agentId,
            sessionId: request.sessionId,
          }),
        ),
      )
      .catch(reject)
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

  /**
   * 自动拒绝所有待审批请求（用于应用退出/全部取消场景）。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private rejectAllPendingApprovals(): void {
    const now = new Date().toISOString()

    for (const [approvalId, entry] of this.pendingApprovals) {
      this.emit({
        type: 'approval-resolved',
        agentId: entry.request.agentId,
        sessionId: entry.request.sessionId,
        approvalId,
        status: 'rejected',
        occurredAt: now,
      })
      entry.resolve({ approved: false })
    }

    this.pendingApprovals.clear()
  }

  /**
   * 自动拒绝指定 session 的所有待审批请求。
   *
   * @param sessionId - 被取消的会话标识。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private rejectSessionPendingApprovals(sessionId: string): void {
    const now = new Date().toISOString()

    for (const [approvalId, entry] of this.pendingApprovals) {
      if (entry.request.sessionId !== sessionId) {
        continue
      }

      this.emit({
        type: 'approval-resolved',
        agentId: entry.request.agentId,
        sessionId: entry.request.sessionId,
        approvalId,
        status: 'rejected',
        occurredAt: now,
      })
      entry.resolve({ approved: false })
      this.pendingApprovals.delete(approvalId)
    }
  }

  /**
   * 自动拒绝所有待审批 Skill 操作（用于应用退出/全部取消场景）。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private rejectAllPendingSkillApprovals(): void {
    const now = new Date().toISOString()

    for (const [approvalId, entry] of this.skillApprovals) {
      this.emit({
        type: 'skill-approval-resolved',
        agentId: entry.request.agentId,
        approvalId,
        status: 'rejected',
        occurredAt: now,
      })
      entry.resolve({ approved: false })
    }

    this.skillApprovals.clear()
  }

  /**
   * 校验文件路径是否允许当前 Agent 访问。
   *
   * @param params - 校验上下文（Agent、路径、操作类型）。
   * @returns allowed 为 true 表示允许访问；为 false 时 reason 包含拒绝原因。
   * @throws 此方法不会主动抛出错误。
   */
  private validateFilePath(params: {
    agentId: string
    path: string
    operation: 'read' | 'write' | 'edit'
  }): { allowed: boolean; reason?: string } {
    const resolvedPath = pathResolve(params.path)
    const operationLabel =
      params.operation === 'read'
        ? '读取'
        : params.operation === 'write'
          ? '写入'
          : '编辑'

    // 检查路径中是否包含受保护的子路径（soul、skills、config、profile）
    const pathSegments = resolvedPath.split('/')
    const hasProtectedSegment =
      pathSegments.includes('soul.md') ||
      pathSegments.includes('soul.history') ||
      pathSegments.includes('skills') ||
      pathSegments.includes('config.json') ||
      pathSegments.includes('config.backups') ||
      (pathSegments.includes('profile') &&
        (pathSegments.includes('user.md') ||
          pathSegments.includes('user.history')))

    if (hasProtectedSegment) {
      return {
        allowed: false,
        reason: `不允许${operationLabel}受保护的文件：${resolvedPath}。该路径可能包含 Agent 配置、身份文件或 Skill 等受保护数据，请使用专用工具操作。`,
      }
    }

    // 检查是否访问了其他 Agent 的目录（soul.md、workspace 除外属于受保护）
    // agents 目录下的非自己目录中的 soul 相关文件已被上面检查拦截
    return { allowed: true }
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
  | 'restoreFromBackup'
  | 'resetConfiguration'
  | 'listSessions'
  | 'createSession'
  | 'getMessages'
  | 'getTranscript'
  | 'sendMessage'
  | 'cancelRun'
  | 'subscribe'
  | 'cancelAllActiveRuns'
  | 'listAgents'
  | 'createAgent'
  | 'updateAgentConfig'
  | 'archiveAgent'
  | 'recoverAgent'
  | 'reconcileAgentDirectories'
  | 'claimAgentDirectory'
  | 'rebuildTangyuanHome'
  | 'getSessionModelInfo'
  | 'setSessionModel'
  | 'setSessionThinkingLevel'
  | 'listAgentSkills'
  | 'listSharedSkills'
  | 'reloadAgentSessions'
  | 'reloadAllSessions'
  | 'getSoul'
  | 'getUserProfile'
  | 'updateSoul'
  | 'updateUserProfile'
  | 'approveBash'
  | 'rejectBash'
  | 'getPendingApprovals'
  | 'createToolApprovalGateway'
  | 'installSkill'
  | 'deleteSkill'
  | 'approveSkillOperation'
  | 'rejectSkillOperation'
  | 'getPendingSkillApprovals'
  | 'getSkillInstallRecords'
>
