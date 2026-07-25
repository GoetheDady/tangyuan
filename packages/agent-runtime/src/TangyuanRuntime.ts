import { TangyuanRuntimeOrchestrator } from './tangyuan-runtime-orchestrator'
import type { TangyuanRuntimeDependencies } from './tangyuan-runtime-dependencies'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type ProfileUpdateResult,
  type RetryRunRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SkillSummary,
  type SoulContent,
  type TranscriptSnapshot,
  type UpdateAgentConfigRequest,
  type UserProfileContent,
} from '@tangyuan/contracts'

export type { TangyuanRuntimeDependencies } from './tangyuan-runtime-dependencies'

/**
 * Electron Main 调用运行时行为的唯一高层接口。
 */
class DefaultTangyuanRuntime extends TangyuanRuntimeOrchestrator {
  /**
   * 读取当前运行时快照并写入 Runtime 缓存。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 读取失败时，Promise 会 reject。
   */
  async getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.reload()
  }

  /**
   * 刷新运行时资源并写入 Runtime 缓存。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 刷新失败时，Promise 会 reject。
   */
  async refreshRuntime(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.refresh()
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
    return this.snapshotStore.saveConfiguration(configuration)
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
    return this.snapshotStore.cancelConfigurationVerification(request)
  }

  /**
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少恢复能力或恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.restoreFromBackup()
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当 RuntimeResourceDriver 缺少重置能力或重置失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.resetConfiguration()
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
    this.sessionCache.replace(
      driverSessions.map((session) => ({
        ...session,
        state: this.activeRunIds.has(session.sessionId)
          ? 'running'
          : this.runQueue.some((q) => q.request.sessionId === session.sessionId)
            ? 'queued'
            : session.state,
      })),
    )
    return this.sessionCache.list()
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当 RuntimeResourceDriver 读取配置失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    return this.agentManager.list()
  }

  /**
   * 创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当 AgentSessionDriver 不支持创建或创建失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentManager.create(displayName)
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
    return this.agentManager.updateConfig(request)
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或归档失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.archive(agentId)
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或恢复失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.recover(agentId)
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
    return this.agentManager.reconcileDirectories()
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
    return this.agentManager.claimDirectory(agentId, displayName)
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当 AgentSessionDriver 不支持或重建失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    return this.agentManager.rebuildTangyuanHome()
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
    return this.sessionModelService.getInfo(request)
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
    return this.sessionModelService.setModel(request)
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
    return this.sessionModelService.setThinkingLevel(request)
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    return this.skillService.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillService.listSharedSkills()
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
    return this.identityService.getSoul(agentId)
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当 AgentSessionDriver 不支持或读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    return this.identityService.getUserProfile()
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
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateSoul(agentId, content, expectedVersion)
  }

  /**
   * 更新共享 user profile 内容。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当 AgentSessionDriver 不支持或操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileUpdateResult> {
    return this.identityService.updateUserProfile(content)
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
    this.sessionCache.upsert(session)
    return session
  }

  /**
   * 读取指定会话的结构化 transcript 快照。
   *
   * 优先使用 TranscriptEmitter 缓存的快照（含 turns/steps）；
   * 缓存未命中时通过 Driver 加载。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 结构化会话快照。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot> {
    // 优先使用 TranscriptEmitter 缓存的快照（含 turns/steps）
    const cached = this.transcriptEmitter.getSnapshot(request.sessionId)
    if (cached) {
      return cached
    }

    // 回退：通过 Driver 加载结构化 transcript
    if (this.sessionDriver.getTranscript) {
      return this.sessionDriver.getTranscript(request)
    }

    // 最终回退：返回空快照
    return {
      sessionId: request.sessionId,
      agentId: request.agentId,
      entries: [],
      updatedAt: new Date().toISOString(),
    }
  }

  /**
   * 向指定会话发送消息，并返回发送完成后的最新对话消息。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后的当前会话消息列表。
   * @throws 当运行时缺少配置、会话不存在或 AgentSessionDriver 发送失败时，Promise 会 reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<TranscriptSnapshot> {
    await this.assertRuntimeReady()

    const session =
      this.sessionCache.find(request.sessionId) ??
      (await this.findSession(request.sessionId))

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

    return this.getTranscript({
      agentId: request.agentId,
      sessionId: request.sessionId,
    })
  }

  /**
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 重试完成后的结构化会话快照。
   * @throws 当 Driver 不支持重试或执行失败时，Promise 会 reject。
   */
  async retryMessage(request: RetryRunRequest): Promise<TranscriptSnapshot> {
    if (!this.sessionDriver.retryMessage) {
      throw new Error('当前运行时不支持重试消息。')
    }

    await this.sessionDriver.retryMessage(request)

    return this.getTranscript({
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
      queued!.resolve({
        agentId: request.agentId,
        sessionId: request.sessionId,
        entries: [],
        updatedAt: now,
      })
      return (
        this.sessionCache.find(request.sessionId) ?? {
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
    const session = this.sessionCache.find(request.sessionId)

    if (!session) {
      throw new Error(`找不到会话 ${request.sessionId}。`)
    }

    return session
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
  | 'getTranscript'
  | 'sendMessage'
  | 'retryMessage'
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
  | 'answerClarification'
  | 'cancelClarification'
  | 'getPendingClarifications'
  | 'createToolApprovalGateway'
  | 'installSkill'
  | 'deleteSkill'
  | 'approveSkillOperation'
  | 'rejectSkillOperation'
  | 'getPendingSkillApprovals'
  | 'getSkillInstallRecords'
>
