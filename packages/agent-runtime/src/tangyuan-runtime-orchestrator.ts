import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentSessionDriver,
  DriverEvent,
  ToolApprovalGateway,
} from './pi-sdk-driver-contracts'
import { TranscriptEmitter } from './transcript-emitter'
import { BashApprovalRegistry } from './bash-approval-registry'
import { ClarificationRegistry } from './clarification-registry'
import { SessionCache } from './session-cache'
import { createToolApprovalGateway } from './tool-approval-gateway'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager } from './agent-manager'
import { SkillService } from './skill-service'
import { IdentityService } from './identity-service'
import { SessionModelService } from './session-model-service'
import { SessionArchiveCoordinator } from './session-archive-coordinator'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type BashApprovalRequest,
  type QuestionClarificationRequest,
  type CancelRunRequest,
  type GetSessionMessagesRequest,
  type SendMessageRequest,
  type SkillApprovalRequest,
  type SkillInstallRecord,
  type SkillOperationParams,
  type SkillSummary,
  type TranscriptSnapshot,
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

import type { TangyuanRuntimeDependencies } from './tangyuan-runtime-dependencies'
import type { LastActiveSessionStore } from './last-active-session-store'

export abstract class TangyuanRuntimeOrchestrator {
  protected static readonly MAX_CONCURRENT_RUNS = 4
  protected readonly sessionDriver: AgentSessionDriver
  protected readonly lastActiveSessionStore:
    Pick<LastActiveSessionStore, 'read' | 'write' | 'clear'>
  protected readonly listeners = new Set<AgentEventListener>()
  protected readonly activeRunIds = new Map<string, string>()
  protected readonly sessionArchiveCoordinator = new SessionArchiveCoordinator()
  private readonly pendingRunStarts = new Map<
    string,
    { promise: Promise<void>; resolve(): void }
  >()
  protected readonly transcriptEmitter: TranscriptEmitter
  protected readonly snapshotStore: RuntimeSnapshotStore
  protected readonly agentManager: AgentManager
  protected readonly identityService: IdentityService
  protected readonly sessionModelService: SessionModelService
  protected readonly sessionCache = new SessionCache()
  protected runQueue: Array<{
    request: SendMessageRequest
    resolve: (value: TranscriptSnapshot) => void
    reject: (error: Error) => void
  }> = []
  protected readonly bashApprovals: BashApprovalRegistry
  protected readonly skillService: SkillService
  protected readonly clarifications: ClarificationRegistry

  /**
   * 创建默认 TangyuanRuntime。
   *
   * @param dependencies - Runtime 和会话 Driver。
   * @returns TangyuanRuntime 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(dependencies: TangyuanRuntimeDependencies) {
    this.sessionDriver = dependencies.sessionDriver
    this.lastActiveSessionStore = dependencies.lastActiveSessionStore ?? {
      read: async () => null,
      write: async (record) => ({
        ...record,
        updatedAt: new Date().toISOString(),
      }),
      clear: async () => undefined,
    }
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
      // 当 run 因任何原因结束（取消/失败/完成）时，自动清理
      // 该 session 的待审批请求，防止审批卡片在 UI 中堆积。
      if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed'
      ) {
        this.rejectSessionPendingApprovals(event.sessionId)
      } else if (
        event.type === 'run-state-changed' &&
        event.state !== 'running' &&
        event.state !== 'queued'
      ) {
        this.rejectSessionPendingApprovals(event.sessionId)
      }

      // 当 run 结束时，释放 slot 并启动下一个排队请求
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

  abstract cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>

  abstract listSessions(agentId?: string): Promise<AgentSessionSummary[]>

  abstract getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot>

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
    return createToolApprovalGateway({
      bashApprovals: this.bashApprovals,
      clarifications: this.clarifications,
      resolveRunId: (sessionId) => this.activeRunIds.get(sessionId) || '',
      now: () => new Date().toISOString(),
    })
  }

  /**
   * 确认运行时快照已经满足会话启动条件。
   *
   * @returns 无返回值。
   * @throws 当 Provider、模型或 API Key 缺失时抛出可读错误。
   */
  protected async assertRuntimeReady(): Promise<void> {
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
  protected async findSession(
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
  protected applyAgentEvent(event: AgentEvent): void {
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
      this.completeRunStart(driverEvent.sessionId)
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
  protected upsertSession(session: AgentSessionSummary): void {
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
  protected upsertSessionState(
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
  protected enqueueRun(
    request: SendMessageRequest,
  ): Promise<TranscriptSnapshot> {
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
  protected dequeueNext(): void {
    if (!this.hasRunCapacity()) return

    const queueIndex = this.runQueue.findIndex(
      (candidate) =>
        !this.sessionArchiveCoordinator.isArchiving(
          candidate.request.sessionId,
        ),
    )
    const [queued] = queueIndex >= 0 ? this.runQueue.splice(queueIndex, 1) : []
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

    this.beginRunStart(request.sessionId)
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
      .finally(() => {
        this.completeRunStart(request.sessionId)
      })
  }

  /** 标记一次消息运行已进入 Driver 启动阶段。 */
  protected beginRunStart(sessionId: string): void {
    if (this.pendingRunStarts.has(sessionId)) return

    let resolve!: () => void
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve
    })
    this.pendingRunStarts.set(sessionId, { promise, resolve })
  }

  /** 标记 Driver 已经可以取消该运行，或启动已经结束。 */
  protected completeRunStart(sessionId: string): void {
    const pending = this.pendingRunStarts.get(sessionId)
    if (!pending) return

    this.pendingRunStarts.delete(sessionId)
    pending.resolve()
  }

  /** 等待尚在 Driver 初始化阶段的运行进入可取消状态。 */
  protected async waitForRunStart(sessionId: string): Promise<void> {
    await this.pendingRunStarts.get(sessionId)?.promise
  }

  /** 判断会话是否正在进入 Driver 运行态。 */
  protected isRunStarting(sessionId: string): boolean {
    return this.pendingRunStarts.has(sessionId)
  }

  /** 判断全局运行槽是否仍可接纳一个正在启动或运行中的会话。 */
  protected hasRunCapacity(): boolean {
    return (
      this.activeRunIds.size + this.pendingRunStarts.size <
      TangyuanRuntimeOrchestrator.MAX_CONCURRENT_RUNS
    )
  }

  /**
   * 向 Runtime 订阅者广播标准事件。
   *
   * @param event - 需要广播的标准事件。
   * @returns 无返回值。
   * @throws 订阅者回调抛出的错误会透传给调用方。
   */
  protected emit(event: AgentEvent): void {
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
  protected rejectAllPendingApprovals(): void {
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
  protected rejectSessionPendingApprovals(sessionId: string): void {
    this.bashApprovals.rejectSession(sessionId)
    this.clarifications.cancelSession(sessionId)
  }

  /**
   * 自动拒绝所有待审批 Skill 操作（用于应用退出/全部取消场景）。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  protected rejectAllPendingSkillApprovals(): void {
    this.skillService.rejectAllApprovals()
  }
}
