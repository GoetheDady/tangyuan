/* eslint-disable max-lines -- TODO: 按职责拆分为 session / transcript 等模块 */
import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentSessionDriver,
  DriverEvent,
  RuntimeResourceDriver,
  ToolApprovalGateway,
} from './index'
import { TranscriptEmitter } from './transcript-emitter'
import { BashApprovalRegistry } from './bash-approval-registry'
import { ClarificationRegistry } from './clarification-registry'
import { SessionCache } from './session-cache'
import { validateFilePath } from './file-path-guard'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager } from './agent-manager'
import { SkillService } from './skill-service'
import { IdentityService } from './identity-service'
import { SessionModelService } from './session-model-service'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type AgentSummary,
  type BashApprovalRequest,
  type CancelConfigurationVerificationRequest,
  type QuestionClarificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type ProfileMaintenanceResult,
  type RetryRunRequest,
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
 * 内部驱动事件类型：存在于 DriverEvent 但不属于公开 AgentEvent，
 * 需先经 TranscriptEmitter 翻译为 transcript-delta 后才能向订阅者广播。
 */
const INTERNAL_DRIVER_EVENT_TYPES = new Set([
  'message-appended',
  'message-delta',
  'message-completed',
  'activity-updated',
  'turn-started',
  'turn-ended',
])

/**
 * 判断一个 Driver 事件是否为内部事件（不应直接向公开订阅者转发）。
 *
 * @param event - Driver 发出的事件。
 * @returns 事件为内部驱动事件时返回 true。
 */
function isInternalDriverEvent(event: AgentEvent | DriverEvent): boolean {
  return INTERNAL_DRIVER_EVENT_TYPES.has(event.type)
}

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
  private readonly sessionDriver: AgentSessionDriver
  private readonly listeners = new Set<AgentEventListener>()
  private readonly activeRunIds = new Map<string, string>()
  private readonly transcriptEmitter: TranscriptEmitter
  private readonly snapshotStore: RuntimeSnapshotStore
  private readonly agentManager: AgentManager
  private readonly identityService: IdentityService
  private readonly sessionModelService: SessionModelService
  private readonly sessionCache = new SessionCache()
  private runQueue: Array<{
    request: SendMessageRequest
    resolve: (value: TranscriptSnapshot) => void
    reject: (error: Error) => void
  }> = []
  private readonly bashApprovals: BashApprovalRegistry
  private readonly skillService: SkillService
  private readonly clarifications: ClarificationRegistry

  /**
   * 创建默认 TangyuanRuntime。
   *
   * @param dependencies - Runtime 和会话 Driver。
   * @returns TangyuanRuntime 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(dependencies: TangyuanRuntimeDependencies) {
    this.sessionDriver = dependencies.sessionDriver
    this.transcriptEmitter = new TranscriptEmitter(this.emit.bind(this))
    this.snapshotStore = new RuntimeSnapshotStore({
      runtimeDriver: dependencies.runtimeDriver,
    })
    this.agentManager = new AgentManager({
      sessionDriver: dependencies.sessionDriver,
      snapshotStore: this.snapshotStore,
    })
    this.identityService = new IdentityService({
      sessionDriver: dependencies.sessionDriver,
      snapshotStore: this.snapshotStore,
    })
    this.sessionModelService = new SessionModelService({
      sessionDriver: dependencies.sessionDriver,
    })
    const emit = this.emit.bind(this)
    const now = () => new Date().toISOString()
    this.bashApprovals = new BashApprovalRegistry({ emit, now })
    this.skillService = new SkillService({
      sessionDriver: dependencies.sessionDriver,
      defaultAgentId: TANGYUAN_DEFAULT_AGENT_ID,
      emit,
      now,
    })
    this.clarifications = new ClarificationRegistry({ emit, now })
    this.sessionDriver.subscribe((event) => {
      this.applyAgentEvent(event)
      // 内部驱动事件（message-appended/message-delta/message-completed/
      // activity-updated）已由 applyAgentEvent 翻译为 transcript-delta，
      // 不属于公开 AgentEvent，直接向订阅者转发会导致 agentEventSchema 校验失败。
      if (!isInternalDriverEvent(event)) {
        this.emit(event)
      }
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
          : this.runQueue.some(
                (q) => q.request.sessionId === session.sessionId,
              )
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
  ): Promise<ProfileMaintenanceResult> {
    return this.identityService.updateSoul(agentId, content)
  }

  /**
   * 更新共享 user profile 内容。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当 AgentSessionDriver 不支持或操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileMaintenanceResult> {
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
      queued.resolve({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: queued.request.sessionId,
        entries: [],
        updatedAt: new Date().toISOString(),
      })
    }

    const runningSessions = this.sessionCache
      .list()
      .filter(
        (session) =>
          session.state === 'running' ||
          this.activeRunIds.has(session.sessionId),
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
    this.bashApprovals.approve(approvalId)
  }

  /**
   * 拒绝指定 Bash 审批请求，向 Agent 返回拒绝结果。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async rejectBash(approvalId: string): Promise<void> {
    this.bashApprovals.reject(approvalId)
  }

  /**
   * 读取所有待审批的 Bash 请求。
   *
   * @returns 待审批请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingApprovals(): BashApprovalRequest[] {
    return this.bashApprovals.list()
  }

  /**
   * 提交澄清问题的答案，使 Agent 从断点继续执行。
   *
   * @param clarificationId - 澄清标识。
   * @param answer - 用户选择的答案（预设选项或自定义输入）。
   * @returns 无返回值。
   * @throws 当澄清不存在或已过期时抛出错误。
   */
  async answerClarification(
    clarificationId: string,
    answer: string,
  ): Promise<void> {
    this.clarifications.answer(clarificationId, answer)
  }

  /**
   * 取消澄清问题，以取消结果结束工具调用。
   *
   * @param clarificationId - 澄清标识。
   * @returns 无返回值。
   * @throws 当澄清不存在或已过期时抛出错误。
   */
  async cancelClarification(clarificationId: string): Promise<void> {
    this.clarifications.cancel(clarificationId)
  }

  /**
   * 读取所有待回答的澄清请求。
   *
   * @returns 待回答澄清请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingClarifications(): QuestionClarificationRequest[] {
    return this.clarifications.list()
  }

  /**
   * 安装或更新 Skill（含权限校验和审批）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、校验失败或 Driver 不支持时，Promise 会 reject。
   */
  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.install(params)
  }

  /**
   * 删除 Skill（含权限校验和审批）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足或 Driver 不支持时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.delete(params)
  }

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async approveSkillOperation(approvalId: string): Promise<void> {
    this.skillService.approveOperation(approvalId)
  }

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  async rejectSkillOperation(approvalId: string): Promise<void> {
    this.skillService.rejectOperation(approvalId)
  }

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingSkillApprovals(): SkillApprovalRequest[] {
    return this.skillService.getPendingApprovals()
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillService.getInstallRecords()
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
        // bash 工具在 session 建立时构造，那时还没有 runId；
        // 真正执行时一定处于某个 active run 内，用它补齐。
        const runId =
          params.runId || this.activeRunIds.get(params.sessionId) || ''
        const request: BashApprovalRequest = {
          approvalId: crypto.randomUUID(),
          agentId: params.agentId,
          sessionId: params.sessionId,
          runId,
          command: params.command,
          cwd: params.cwd,
          riskDescription: params.riskDescription,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }

        return this.bashApprovals.register(request)
      },

      validateFilePath: (params) => {
        return validateFilePath(params)
      },

      requestClarification: async (params) => {
        const runId =
          params.runId || this.activeRunIds.get(params.sessionId) || ''
        const request: QuestionClarificationRequest = {
          clarificationId: crypto.randomUUID(),
          agentId: params.agentId,
          sessionId: params.sessionId,
          runId,
          question: params.question,
          options: params.options,
          allowCustomAnswer: params.allowCustomAnswer,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }

        return this.clarifications.register(request)
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
    const snapshot = await this.snapshotStore.getOrLoad()

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
    const cachedSession = this.sessionCache.find(sessionId)

    if (cachedSession) {
      return cachedSession
    }

    await this.listSessions()

    return this.sessionCache.find(sessionId)
  }

  /**
   * 把 Driver 事件归并到 Runtime 的本地缓存。
   *
   * @param event - Driver 发出的标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private applyAgentEvent(event: AgentEvent): void {
    // Cast to DriverEvent for internal handlers that process old event types
    const driverEvent = event as import('./index').DriverEvent

    if (driverEvent.type === 'session-created') {
      this.upsertSession(driverEvent.session)
      return
    }

    if (driverEvent.type === 'message-appended') {
      this.transcriptEmitter.emitTranscriptDeltaForMessageAppended(
        driverEvent as Extract<AgentEvent, { type: 'message-appended' }>,
      )
      return
    }

    if (driverEvent.type === 'attempt-started') {
      this.activeRunIds.set(driverEvent.sessionId, driverEvent.runId)
      this.upsertSessionState(
        driverEvent.sessionId,
        'running',
        driverEvent.occurredAt,
      )
      this.transcriptEmitter.startAttemptForRun(driverEvent)
      this.transcriptEmitter.initializeTurnStateForRun(driverEvent)
      return
    }

    if (driverEvent.type === 'message-delta') {
      if (driverEvent.deltaKind === 'thinking') {
        this.transcriptEmitter.emitTranscriptDeltaForThinking(
          driverEvent as Extract<AgentEvent, { type: 'message-delta' }>,
        )
      } else {
        this.transcriptEmitter.emitTranscriptDeltaForDelta(
          driverEvent as Extract<AgentEvent, { type: 'message-delta' }>,
        )
      }
      return
    }

    if (driverEvent.type === 'message-completed') {
      this.transcriptEmitter.completeAttemptForRun(
        driverEvent as Extract<AgentEvent, { type: 'message-completed' }>,
      )
      return
    }

    if (driverEvent.type === 'activity-updated') {
      this.transcriptEmitter.emitTranscriptDeltaForActivity(
        driverEvent as Extract<AgentEvent, { type: 'activity-updated' }>,
      )
      return
    }

    if (driverEvent.type === 'turn-started') {
      this.transcriptEmitter.startTurn(driverEvent)
      return
    }

    if (driverEvent.type === 'turn-ended') {
      this.transcriptEmitter.endTurn(driverEvent)
      return
    }

    if (driverEvent.type === 'turn-cancelled') {
      this.activeRunIds.delete(driverEvent.sessionId)
      this.upsertSessionState(
        driverEvent.sessionId,
        'cancelled',
        driverEvent.occurredAt,
      )
      this.transcriptEmitter.failAttemptForRun(
        driverEvent.sessionId,
        driverEvent.runId,
        'cancelled',
        driverEvent.occurredAt,
      )
      return
    }

    if (driverEvent.type === 'turn-failed') {
      this.activeRunIds.delete(driverEvent.sessionId)
      this.upsertSessionState(
        driverEvent.sessionId,
        'failed',
        driverEvent.occurredAt,
      )
      this.transcriptEmitter.failAttemptForRun(
        driverEvent.sessionId,
        driverEvent.runId,
        'failed',
        driverEvent.occurredAt,
        driverEvent.error,
      )
      return
    }

    if (driverEvent.type === 'run-state-changed') {
      this.upsertSessionState(
        driverEvent.sessionId,
        driverEvent.state,
        driverEvent.occurredAt,
      )

      if (driverEvent.state !== 'running') {
        this.activeRunIds.delete(driverEvent.sessionId)
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
    this.sessionCache.upsert(session)
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
    this.sessionCache.updateState(sessionId, state, updatedAt)
  }

  /**
   * 将请求加入调度队列并广播 queued 状态。
   *
   * @param request - 需要排队等待的消息发送请求。
   * @returns 排队完成后 resolve 的 Promise，含结构化会话快照。
   * @throws 此方法不会主动抛出错误。
   */
  private enqueueRun(request: SendMessageRequest): Promise<TranscriptSnapshot> {
    const now = new Date().toISOString()
    this.emit({
      type: 'run-state-changed',
      agentId: request.agentId,
      sessionId: request.sessionId,
      state: 'queued',
      occurredAt: now,
    })
    this.upsertSessionState(request.sessionId, 'queued', now)

    return new Promise<TranscriptSnapshot>((resolve, reject) => {
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
          await this.getTranscript({
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
    this.bashApprovals.rejectAll()
    this.clarifications.cancelAll()
  }

  /**
   * 自动拒绝指定 session 的所有待审批请求。
   *
   * @param sessionId - 被取消的会话标识。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private rejectSessionPendingApprovals(sessionId: string): void {
    this.bashApprovals.rejectSession(sessionId)
    this.clarifications.cancelSession(sessionId)
  }

  /**
   * 自动拒绝所有待审批 Skill 操作（用于应用退出/全部取消场景）。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private rejectAllPendingSkillApprovals(): void {
    this.skillService.rejectAllApprovals()
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
