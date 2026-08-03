import { YuanxiaoRuntimeOrchestrator } from './yuanxiao-runtime-orchestrator'
import type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'
import { collectSessionSubtree } from '../session/session-archive-coordinator'
import { AgentRuntimeError } from '../core'
import { canRestoreSessionLineage } from './session-lineage'
import type { ToolApprovalGateway } from '../driver'
import { createToolApprovalGateway } from '../approval'
import type { RuntimeServices } from './runtime-services'
import type {
  BashApprovalRequest,
  QuestionClarificationRequest,
  SkillApprovalRequest,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
  AgentSummary,
  GetSessionModelInfoRequest,
  ProfileUpdateResult,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
  SoulContent,
  UnclaimedDirectory,
  UpdateAgentConfigRequest,
  UserProfileContent,
} from '@yuanxiao/contracts'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type ArchiveSessionRequest,
  type ArchiveSessionResult,
  type DeleteSessionRequest,
  type DeleteSessionResult,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type DeleteProviderRequest,
  type ForkSessionRequest,
  type GetSessionMessagesRequest,
  type LastActiveSession,
  type ProviderConfiguration,
  type RecoverSessionRequest,
  type RetryRunRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SessionLineageActivity,
  type SessionLineageActivityKind,
  type SetLastActiveSessionRequest,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'

export type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'

/**
 * Electron Main 调用运行时行为的唯一高层接口。
 */
class DefaultYuanxiaoRuntime extends YuanxiaoRuntimeOrchestrator {
  async approveBash(approvalId: string): Promise<void> {
    this.bashApprovals.approve(approvalId)
  }

  async rejectBash(approvalId: string): Promise<void> {
    this.bashApprovals.reject(approvalId)
  }

  getPendingApprovals(): BashApprovalRequest[] {
    return this.bashApprovals.list()
  }

  async answerClarification(
    clarificationId: string,
    answer: string,
  ): Promise<void> {
    this.clarifications.answer(clarificationId, answer)
  }

  async cancelClarification(clarificationId: string): Promise<void> {
    this.clarifications.cancel(clarificationId)
  }

  getPendingClarifications(): QuestionClarificationRequest[] {
    return this.clarifications.list()
  }

  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.install(params)
  }

  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.delete(params)
  }

  async approveSkillOperation(approvalId: string): Promise<void> {
    this.skillService.approveOperation(approvalId)
  }

  async rejectSkillOperation(approvalId: string): Promise<void> {
    this.skillService.rejectOperation(approvalId)
  }

  getPendingSkillApprovals(): SkillApprovalRequest[] {
    return this.skillService.getPendingApprovals()
  }

  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillService.getInstallRecords()
  }

  createToolApprovalGateway(): ToolApprovalGateway {
    return createToolApprovalGateway({
      bashApprovals: this.bashApprovals,
      clarifications: this.clarifications,
      resolveRunId: (sessionId) => this.activeRunIds.get(sessionId) || '',
      now: () => new Date().toISOString(),
    })
  }

  async listAgents(): Promise<AgentSummary[]> {
    return this.agentManager.list()
  }

  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentManager.create(displayName)
  }

  async updateAgentConfig(
    request: UpdateAgentConfigRequest,
  ): Promise<AgentSummary> {
    return this.agentManager.updateConfig(request)
  }

  async archiveAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.archive(agentId)
  }

  async recoverAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.recover(agentId)
  }

  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }> {
    return this.agentManager.reconcileDirectories()
  }

  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    return this.agentManager.claimDirectory(agentId, displayName)
  }

  async rebuildYuanxiaoHome(): Promise<AgentSummary> {
    return this.agentManager.rebuildYuanxiaoHome()
  }

  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.getInfo(request)
  }

  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.setModel(request)
  }

  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.setThinkingLevel(request)
  }

  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    return this.skillService.listAgentSkills(agentId)
  }

  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillService.listSharedSkills()
  }

  async reloadAgentSessions(agentId: string): Promise<void> {
    return this.sessions.reloadAgentSessions(agentId)
  }

  async reloadAllSessions(): Promise<void> {
    return this.sessions.reloadAllSessions()
  }

  async getSoul(agentId: string): Promise<SoulContent> {
    return this.identityService.getSoul(agentId)
  }

  async getUserProfile(): Promise<UserProfileContent> {
    return this.identityService.getUserProfile()
  }

  async updateSoul(
    agentId: string,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateSoul(agentId, content, expectedVersion)
  }

  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateUserProfile(content, expectedVersion)
  }

  /**
   * 读取当前运行时快照并写入 Runtime 缓存。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当配置模块读取失败时，Promise 会 reject。
   */
  async getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.reload()
  }

  /**
   * 刷新运行时资源并写入 Runtime 缓存。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当配置模块刷新失败时，Promise 会 reject。
   */
  async refreshRuntime(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.refresh()
  }

  /**
   * 验证并保存运行时配置，再写入 Runtime 缓存。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当配置验证或保存失败时，Promise 会 reject。
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
   * @throws 当取消配置验证失败时，Promise 会 reject。
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
   * @throws 当配置恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.restoreFromBackup()
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当配置重置失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<RuntimeSnapshot> {
    return this.snapshotStore.resetConfiguration()
  }

  /**
   * 读取指定 Agent 的会话摘要列表并写入 Runtime 缓存。
   *
   * @param agentId - 要读取会话的 Agent 标识，默认为默认 Agent。
   * @returns 会话摘要列表。
   * @throws 当 Session 模块读取失败时，Promise 会 reject。
   */
  async listSessions(
    agentId: string = YUANXIAO_DEFAULT_AGENT_ID,
    includeArchived = false,
  ): Promise<AgentSessionSummary[]> {
    const driverSessions = await this.sessions.listSessions({
      agentId,
      ...(includeArchived ? { includeArchived: true } : {}),
    })
    const sessions = driverSessions.map((session) => ({
      ...session,
      state: this.activeRunIds.has(session.sessionId)
        ? ('running' as const)
        : this.runScheduler.hasQueued(session.sessionId)
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
                await this.sessions.getTranscript({
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
          (await canRestoreSessionLineage(
            this.sessions,
            recordedSession,
            sessions,
          ))
        ) {
          return record
        }
      }
    }

    const fallbackSessions = await this.listSessions(YUANXIAO_DEFAULT_AGENT_ID)
    let fallbackSession: AgentSessionSummary | undefined

    for (const session of fallbackSessions) {
      if (
        await canRestoreSessionLineage(this.sessions, session, fallbackSessions)
      ) {
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
   * 创建会话并把结果合并到 Runtime 缓存。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 Session 模块创建失败时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    await this.assertRuntimeReady()

    const session = await this.sessions.createSession(request)
    this.sessionCache.upsert(session)
    return session
  }

  /**
   * 读取指定会话的结构化 transcript 快照。
   *
   * 优先使用 TranscriptEmitter 缓存的快照（含 turns/steps）；
   * 缓存未命中时通过 Session 模块加载。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 结构化会话快照。
   * @throws 当 Session 模块读取失败时，Promise 会 reject。
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
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId}，或该会话已归档。`,
        recoverable: true,
      })
    }

    if (session) this.assertLineageAvailable(session)

    // 优先使用 TranscriptEmitter 缓存的快照（含 turns/steps）
    const cached = this.transcriptEmitter.getSnapshot(request.sessionId)
    if (cached) {
      return cached
    }

    return this.sessions.getTranscript(request)
  }

  /**
   * 向指定会话发送消息，并返回发送完成后的最新对话消息。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后的当前会话消息列表。
   * @throws 当运行时缺少配置、会话不存在或 Session 模块发送失败时，Promise 会 reject。
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
      this.runScheduler.isRunStarting(request.sessionId) ||
      session?.state === 'running'
    ) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }

    // 检查会话是否已在队列中
    if (this.runScheduler.hasQueued(request.sessionId)) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话已在排队中，请等待或取消排队。',
        recoverable: true,
      })
    }

    // 达到并发上限时入队
    if (!this.runScheduler.hasRunCapacity()) {
      return this.runScheduler.enqueueRun(request)
    }

    this.runScheduler.beginRunStart(request.sessionId)
    try {
      await this.sessions.sendMessage(request)
    } finally {
      this.runScheduler.completeRunStart(request.sessionId)
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
   * @throws 当 Session 模块重试执行失败时，Promise 会 reject。
   */
  async retryMessage(request: RetryRunRequest): Promise<TranscriptSnapshot> {
    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)

    const retrySession = this.sessionCache.find(request.sessionId)
    if (retrySession) this.assertLineageAvailable(retrySession)

    this.runScheduler.beginRunStart(request.sessionId)
    try {
      await this.sessions.retryMessage(request)
    } finally {
      this.runScheduler.completeRunStart(request.sessionId)
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
   * @throws 当 Session 模块分叉失败时，Promise 会 reject。
   */
  async forkSession(request: ForkSessionRequest): Promise<AgentSessionSummary> {
    this.sessionArchiveCoordinator.assertAvailable(request.sessionId)
    const forkSourceSession = this.sessionCache.find(request.sessionId)
    if (forkSourceSession) this.assertLineageAvailable(forkSourceSession)
    const forked = await this.sessionArchiveCoordinator.trackFork(
      request.sessionId,
      this.sessions.forkSession(request),
    )
    await this.transcriptEmitter.seedSession(() =>
      this.getTranscript({
        agentId: forked.agentId,
        sessionId: forked.sessionId,
      }),
    )
    return forked
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
        affectedSessionIds.map((sessionId) =>
          this.runScheduler.waitForRunStart(sessionId),
        ),
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

      await this.sessions.setSessionsArchived(
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
      this.runScheduler.dequeueNext()
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

    const recovered = await this.sessions.setSessionsArchived(
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
        affectedSessionIds.map((sessionId) =>
          this.runScheduler.waitForRunStart(sessionId),
        ),
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

      await this.sessions.deleteSessions(affectedSessionIds)

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
      this.runScheduler.dequeueNext()
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
        this.runScheduler.isRunStarting(session.sessionId)
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
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message:
          '该会话的祖先 Pi 会话文件已丢失或损坏，无法操作。请尝试恢复或重新创建。',
        recoverable: true,
      })
    }
  }

  /**
   * 取消指定会话正在运行的 Agent 响应，并返回更新后的摘要。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 取消后的会话摘要。
   * @throws 当会话不存在或 Session 模块取消失败时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary> {
    // 自动拒绝该 session 的所有待审批请求
    this.rejectSessionPendingApprovals(request.sessionId)

    // 先检查队列中的待处理请求
    if (this.runScheduler.cancelQueued(request.sessionId, request.agentId)) {
      return (
        this.sessionCache.find(request.sessionId) ?? {
          agentId: request.agentId,
          sessionId: request.sessionId,
          title: '',
          state: 'cancelled',
          updatedAt: new Date().toISOString(),
        }
      )
    }

    await this.sessions.cancelRun(request)
    this.activeRunIds.delete(request.sessionId)
    await this.listSessions(request.agentId)
    const session = this.sessionCache.find(request.sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId}。`,
        recoverable: true,
      })
    }

    return session
  }
}

/**
 * 使用可控职责模块创建测试用 YuanxiaoRuntime。
 *
 * @param dependencies - 测试提供的 Runtime 职责模块。
 * @returns 通过公开 YuanxiaoRuntime 方法观察行为的测试实例。
 * @throws 此方法不会主动抛出错误。
 */
export function createYuanxiaoRuntimeForTesting(
  dependencies: YuanxiaoRuntimeDependencies,
  services?: RuntimeServices,
): YuanxiaoRuntime {
  return new DefaultYuanxiaoRuntime(dependencies, services)
}

/**
 * Electron Main 可以调用的 YuanxiaoRuntime 高层能力集合。
 */
export type YuanxiaoRuntime = Pick<
  DefaultYuanxiaoRuntime,
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
  | 'rebuildYuanxiaoHome'
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
