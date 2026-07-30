import { TangyuanRuntimeOrchestrator } from './tangyuan-runtime-orchestrator'
import type { TangyuanRuntimeDependencies } from './tangyuan-runtime-dependencies'
import { collectSessionSubtree } from './session-archive-coordinator'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type ArchiveSessionRequest,
  type ArchiveSessionResult,
  type DeleteSessionRequest,
  type DeleteSessionResult,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type DeleteProviderRequest,
  type ForkSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type LastActiveSession,
  type ProfileUpdateResult,
  type ProviderConfiguration,
  type RecoverSessionRequest,
  type RetryRunRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SessionModelInfo,
  type SessionLineageActivity,
  type SessionLineageActivityKind,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SetLastActiveSessionRequest,
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

  async saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot> {
    return this.snapshotStore.saveProvider(config)
  }

  async deleteProvider(
    request: DeleteProviderRequest,
  ): Promise<RuntimeSnapshot> {
    return this.snapshotStore.deleteProvider(request)
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
   * 读取指定 Agent 的会话摘要列表并写入 Runtime 缓存。
   *
   * @param agentId - 要读取会话的 Agent 标识，默认为默认 Agent。
   * @returns 会话摘要列表。
   * @throws 当 AgentSessionDriver 读取失败时，Promise 会 reject。
   */
  async listSessions(
    agentId: string = TANGYUAN_DEFAULT_AGENT_ID,
    includeArchived = false,
  ): Promise<AgentSessionSummary[]> {
    const driverSessions = await this.sessionDriver.listSessions({
      agentId,
      ...(includeArchived ? { includeArchived: true } : {}),
    })
    const sessions = driverSessions.map((session) => ({
      ...session,
      state: this.activeRunIds.has(session.sessionId)
        ? ('running' as const)
        : this.runQueue.some((q) => q.request.sessionId === session.sessionId)
          ? ('queued' as const)
          : session.state,
    }))
    // 对非归档会话检查祖先谱系完整性
    if (!includeArchived) {
      const sessionsById = new Map(sessions.map((s) => [s.sessionId, s]))
      const lineageCache = new Map<string, boolean>()

      for (const session of sessions) {
        if (!session.forkedFrom?.sessionId) continue

        let ancestorId: string | undefined = session.forkedFrom.sessionId
        const visited = new Set<string>()

        while (ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId)
          if (!lineageCache.has(ancestorId)) {
            const ancestor = sessionsById.get(ancestorId)
            if (!ancestor) {
              lineageCache.set(ancestorId, false)
            } else {
              try {
                await this.sessionDriver.getTranscript({
                  agentId: ancestor.agentId,
                  sessionId: ancestor.sessionId,
                })
                lineageCache.set(ancestorId, true)
              } catch {
                lineageCache.set(ancestorId, false)
              }
            }
          }
          if (!lineageCache.get(ancestorId)) {
            session.lineageUnavailable = true
            break
          }
          ancestorId = sessionsById.get(ancestorId)?.forkedFrom?.sessionId
        }
      }
    }
    this.sessionCache.replace(
      sessions.filter((session) => session.archivedAt === undefined),
    )
    return includeArchived ? sessions : this.sessionCache.list()
  }

  /**
   * 解析应用启动时应恢复的最后激活会话。
   *
   * @returns 最后激活会话可用时返回原记录；否则返回并记录默认 Agent 的首个可恢复会话；无可恢复会话时返回 null。
   * @throws 当 Agent 或会话列表读取失败，或回退记录写入、清理失败时，Promise 会 reject。
   */
  async getLastActiveSession(): Promise<LastActiveSession | null> {
    const record = await this.lastActiveSessionStore.read()

    if (record) {
      const agents = await this.listAgents()
      const agent = agents.find(
        (candidate) => candidate.agentId === record.agentId,
      )

      if (agent?.status === 'active') {
        const sessions = await this.listSessions(record.agentId)
        const recordedSession = sessions.find(
          (session) => session.sessionId === record.sessionId,
        )

        if (
          recordedSession &&
          (await this.canRestoreSessionLineage(recordedSession, sessions))
        ) {
          return record
        }
      }
    }

    const fallbackSessions = await this.listSessions(TANGYUAN_DEFAULT_AGENT_ID)
    let fallbackSession: AgentSessionSummary | undefined

    for (const session of fallbackSessions) {
      if (await this.canRestoreSessionLineage(session, fallbackSessions)) {
        fallbackSession = session
        break
      }
    }

    if (!fallbackSession) {
      await this.lastActiveSessionStore.clear()
      return null
    }

    return this.lastActiveSessionStore.write({
      agentId: fallbackSession.agentId,
      sessionId: fallbackSession.sessionId,
    })
  }

  /**
   * 验证会话及其完整父链的 Pi session 内容仍可读取。
   *
   * @param session - 需要验证的会话摘要。
   * @param sessions - 同一 Agent 的全部可见会话。
   * @returns 谱系完整且每个 transcript 可读时返回 true。
   */
  private async canRestoreSessionLineage(
    session: AgentSessionSummary,
    sessions: AgentSessionSummary[],
  ): Promise<boolean> {
    const sessionsById = new Map(
      sessions.map((candidate) => [candidate.sessionId, candidate]),
    )
    const visitedSessionIds = new Set<string>()
    let candidate: AgentSessionSummary | undefined = session

    while (candidate) {
      if (
        candidate.agentId !== session.agentId ||
        visitedSessionIds.has(candidate.sessionId)
      ) {
        return false
      }
      visitedSessionIds.add(candidate.sessionId)

      try {
        await this.sessionDriver.getTranscript({
          agentId: candidate.agentId,
          sessionId: candidate.sessionId,
        })
      } catch {
        return false
      }

      const parentSessionId = candidate.forkedFrom?.sessionId
      if (!parentSessionId) {
        return true
      }
      candidate = sessionsById.get(parentSessionId)
    }

    return false
  }

  /**
   * 校验并持久化用户最后打开的会话。
   *
   * @param request - 要记录的 Agent 和会话标识。
   * @returns 目标可用时返回写入后的记录，否则返回 null。
   * @throws 当 Agent、会话列表或记录文件读写失败时，Promise 会 reject。
   */
  async setLastActiveSession(
    request: SetLastActiveSessionRequest,
  ): Promise<LastActiveSession | null> {
    const agents = await this.listAgents()
    const agent = agents.find(
      (candidate) => candidate.agentId === request.agentId,
    )

    if (!agent || agent.status !== 'active') {
      return null
    }

    const sessions = await this.listSessions(request.agentId)
    const isAvailable = sessions.some(
      (session) =>
        session.agentId === request.agentId &&
        session.sessionId === request.sessionId,
    )

    return isAvailable ? this.lastActiveSessionStore.write(request) : null
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
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当 AgentSessionDriver 不支持或操作失败时，Promise 会 reject。
   */
  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateUserProfile(content, expectedVersion)
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
    let session = this.sessionCache.find(request.sessionId)
    if (session?.agentId !== request.agentId) {
      await this.listSessions(request.agentId)
      session = this.sessionCache.find(request.sessionId)
    }
    if (session?.agentId !== request.agentId) {
      throw new Error(`找不到会话 ${request.sessionId}，或该会话已归档。`)
    }

    if (session) this.assertLineageAvailable(session)

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
    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)
    await this.assertRuntimeReady()

    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)

    const session =
      this.sessionCache.find(request.sessionId) ??
      (await this.findSession(request.sessionId))

    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)

    if (session) this.assertLineageAvailable(session)

    if (
      this.activeRunIds.has(request.sessionId) ||
      this.isRunStarting(request.sessionId) ||
      session?.state === 'running'
    ) {
      throw new Error('当前会话正在运行，请等待完成或先取消本次响应。')
    }

    // 检查会话是否已在队列中
    if (this.runQueue.some((q) => q.request.sessionId === request.sessionId)) {
      throw new Error('当前会话已在排队中，请等待或取消排队。')
    }

    // 达到并发上限时入队
    if (!this.hasRunCapacity()) {
      return this.enqueueRun(request)
    }

    this.beginRunStart(request.sessionId)
    try {
      await this.sessionDriver.sendMessage(request)
    } finally {
      this.completeRunStart(request.sessionId)
    }

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

    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)

    const retrySession = this.sessionCache.find(request.sessionId)
    if (retrySession) this.assertLineageAvailable(retrySession)

    this.beginRunStart(request.sessionId)
    try {
      await this.sessionDriver.retryMessage(request)
    } finally {
      this.completeRunStart(request.sessionId)
    }

    return this.getTranscript({
      agentId: request.agentId,
      sessionId: request.sessionId,
    })
  }

  /**
   * 从指定会话的某个用户消息创建独立分叉会话。
   *
   * @param request - Agent 标识、会话标识和分叉起始节点。
   * @returns 新分支的会话摘要。
   * @throws 当 Driver 不支持或分叉失败时，Promise 会 reject。
   */
  async forkSession(request: ForkSessionRequest): Promise<AgentSessionSummary> {
    if (!this.sessionDriver.forkSession) {
      throw new Error('当前运行时不支持分叉会话。')
    }

    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)
    const forkSourceSession = this.sessionCache.find(request.sessionId)
    if (forkSourceSession) this.assertLineageAvailable(forkSourceSession)
    const pendingFork = this.sessionDriver.forkSession(request)
    return this.sessionArchiveCoordinator.trackFork(
      request.sessionId,
      pendingFork,
    )
  }

  /**
   * 可恢复地归档目标会话及其全部后代。
   *
   * 活动子树在用户确认前只返回影响预览；确认后会等待每个会话完成取消，
   * 再一次性写入整棵子树的归档状态。
   */
  async archiveSession(
    request: ArchiveSessionRequest,
  ): Promise<ArchiveSessionResult> {
    const archiveLease = this.sessionArchiveCoordinator.acquire(
      request.sessionId,
    )

    try {
      let sessions = await this.listSessions(request.agentId, true)
      let subtree = collectSessionSubtree(
        sessions,
        request.agentId,
        request.sessionId,
      )

      while (true) {
        archiveLease.lock(subtree.map((session) => session.sessionId))
        await archiveLease.waitForPendingForks(
          subtree.map((session) => session.sessionId),
        )
        sessions = await this.listSessions(request.agentId, true)
        const refreshedSubtree = collectSessionSubtree(
          sessions,
          request.agentId,
          request.sessionId,
        )
        const hasUnlockedDescendant = refreshedSubtree.some(
          (session) => !archiveLease.owns(session.sessionId),
        )
        subtree = refreshedSubtree
        if (!hasUnlockedDescendant) break
      }

      const affectedActivities = this.collectSessionActivities(subtree)
      const affectedSessionIds = subtree.map((session) => session.sessionId)

      if (affectedActivities.length > 0 && !request.confirmActivityStop) {
        return {
          status: 'confirmation-required',
          affectedSessionIds,
          affectedActivities,
        }
      }

      await Promise.all(
        affectedSessionIds.map((sessionId) => this.waitForRunStart(sessionId)),
      )
      const currentSessions = await this.listSessions(request.agentId, true)
      const currentSubtree = collectSessionSubtree(
        currentSessions,
        request.agentId,
        request.sessionId,
      )
      const currentActivities = this.collectSessionActivities(currentSubtree)
      const orderedActivities = [...currentActivities].sort(
        (left, right) =>
          Number(right.kinds.includes('queued')) -
          Number(left.kinds.includes('queued')),
      )
      for (const activity of orderedActivities) {
        await this.cancelRun({
          agentId: request.agentId,
          sessionId: activity.sessionId,
        })
      }

      if (!this.sessionDriver.setSessionsArchived) {
        throw new Error('当前运行时不支持归档会话。')
      }

      await this.sessionDriver.setSessionsArchived(
        affectedSessionIds,
        new Date().toISOString(),
      )
      await this.listSessions(request.agentId)

      return {
        status: 'archived',
        affectedSessionIds,
        affectedActivities,
      }
    } finally {
      archiveLease.release()
      this.dequeueNext()
    }
  }

  /** 恢复目标会话及其全部后代。 */
  async recoverSession(
    request: RecoverSessionRequest,
  ): Promise<AgentSessionSummary[]> {
    const sessions = await this.listSessions(request.agentId, true)
    const subtree = collectSessionSubtree(
      sessions,
      request.agentId,
      request.sessionId,
    )

    if (!this.sessionDriver.setSessionsArchived) {
      throw new Error('当前运行时不支持恢复会话。')
    }

    const recovered = await this.sessionDriver.setSessionsArchived(
      subtree.map((session) => session.sessionId),
      null,
    )
    await this.listSessions(request.agentId)
    return recovered
  }

  /** 永久删除目标会话及其全部后代。 */
  async deleteSession(
    request: DeleteSessionRequest,
  ): Promise<DeleteSessionResult> {
    const archiveLease = this.sessionArchiveCoordinator.acquire(
      request.sessionId,
    )

    try {
      let sessions = await this.listSessions(request.agentId, true)
      let subtree = collectSessionSubtree(
        sessions,
        request.agentId,
        request.sessionId,
      )

      while (true) {
        archiveLease.lock(subtree.map((session) => session.sessionId))
        await archiveLease.waitForPendingForks(
          subtree.map((session) => session.sessionId),
        )
        sessions = await this.listSessions(request.agentId, true)
        const refreshedSubtree = collectSessionSubtree(
          sessions,
          request.agentId,
          request.sessionId,
        )
        const hasUnlockedDescendant = refreshedSubtree.some(
          (session) => !archiveLease.owns(session.sessionId),
        )
        subtree = refreshedSubtree
        if (!hasUnlockedDescendant) break
      }

      const affectedActivities = this.collectSessionActivities(subtree)
      const affectedSessionIds = subtree.map((session) => session.sessionId)

      if (affectedActivities.length > 0 && !request.confirmActivityStop) {
        return {
          status: 'confirmation-required',
          affectedSessionIds,
          affectedActivities,
        }
      }

      await Promise.all(
        affectedSessionIds.map((sessionId) => this.waitForRunStart(sessionId)),
      )
      const currentSessions = await this.listSessions(request.agentId, true)
      const currentSubtree = collectSessionSubtree(
        currentSessions,
        request.agentId,
        request.sessionId,
      )
      const currentActivities = this.collectSessionActivities(currentSubtree)
      const orderedActivities = [...currentActivities].sort(
        (left, right) =>
          Number(right.kinds.includes('queued')) -
          Number(left.kinds.includes('queued')),
      )
      for (const activity of orderedActivities) {
        await this.cancelRun({
          agentId: request.agentId,
          sessionId: activity.sessionId,
        })
      }

      if (!this.sessionDriver.deleteSessions) {
        throw new Error('当前运行时不支持永久删除会话。')
      }

      await this.sessionDriver.deleteSessions(affectedSessionIds)

      const lastActive = await this.lastActiveSessionStore.read()
      if (lastActive && affectedSessionIds.includes(lastActive.sessionId)) {
        await this.lastActiveSessionStore.clear()
      }

      for (const id of affectedSessionIds) {
        this.sessionCache.remove(id)
        this.activeRunIds.delete(id)
      }

      return {
        status: 'deleted',
        affectedSessionIds,
        affectedActivities,
      }
    } finally {
      archiveLease.release()
      this.dequeueNext()
    }
  }

  /** 汇总子树中需要在归档前停止的运行、队列和对话动作。 */
  private collectSessionActivities(
    sessions: readonly AgentSessionSummary[],
  ): SessionLineageActivity[] {
    const approvalSessionIds = new Set(
      this.getPendingApprovals().map((approval) => approval.sessionId),
    )
    const clarificationSessionIds = new Set(
      this.getPendingClarifications().map(
        (clarification) => clarification.sessionId,
      ),
    )

    return sessions.flatMap((session) => {
      const kinds: SessionLineageActivityKind[] = []
      if (
        session.state === 'running' ||
        this.isRunStarting(session.sessionId)
      ) {
        kinds.push('running')
      }
      if (session.state === 'queued') kinds.push('queued')
      if (approvalSessionIds.has(session.sessionId)) {
        kinds.push('pending-approval')
      }
      if (clarificationSessionIds.has(session.sessionId)) {
        kinds.push('pending-clarification')
      }

      return kinds.length > 0
        ? [{ sessionId: session.sessionId, title: session.title, kinds }]
        : []
    })
  }

  /** 断言会话谱系可用，不可用时抛出错误阻断操作。 */
  private assertLineageAvailable(session: AgentSessionSummary): void {
    if (session.lineageUnavailable) {
      throw new Error(
        '该会话的祖先 Pi 会话文件已丢失或损坏，无法操作。请尝试恢复或重新创建。',
      )
    }
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
    await this.listSessions(request.agentId)
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
  | 'saveProvider'
  | 'deleteProvider'
  | 'cancelRuntimeConfigurationVerification'
  | 'restoreFromBackup'
  | 'resetConfiguration'
  | 'listSessions'
  | 'getLastActiveSession'
  | 'setLastActiveSession'
  | 'createSession'
  | 'getTranscript'
  | 'sendMessage'
  | 'retryMessage'
  | 'forkSession'
  | 'archiveSession'
  | 'recoverSession'
  | 'deleteSession'
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
