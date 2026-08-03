import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  DriverEvent,
} from '../driver'
import { TranscriptEmitter } from '../session/transcript-emitter'
import { BashApprovalRegistry, ClarificationRegistry } from '../approval'
import { SessionCache } from '../session/session-cache'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager, IdentityService } from '../agent'
import { SkillService } from '../skill'
import { SessionModelService } from '../session/session-model-service'
import { SessionArchiveCoordinator } from '../session/session-archive-coordinator'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type CancelRunRequest,
  type GetSessionMessagesRequest,
  type SendMessageRequest,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'

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
  'compaction-detected',
  'auto-retry-progress',
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

import type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'
import type { LastActiveSessionStore } from '../session/last-active-session-store'
import type { SessionModule } from './runtime-modules'

export abstract class YuanxiaoRuntimeOrchestrator {
  protected readonly sessions: SessionModule
  protected readonly lastActiveSessionStore: Pick<
    LastActiveSessionStore,
    'read' | 'write' | 'clear'
  >
  protected readonly listeners = new Set<AgentEventListener>()
  protected readonly activeRunIds = new Map<string, string>()
  protected readonly sessionArchiveCoordinator = new SessionArchiveCoordinator()
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
   * 创建默认 YuanxiaoRuntime。
   *
   * @param dependencies - Runtime 所需的职责模块。
   * @returns YuanxiaoRuntime 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(dependencies: YuanxiaoRuntimeDependencies) {
    this.sessions = dependencies.sessions
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
      configuration: dependencies.configuration,
    })
    this.agentManager = new AgentManager({
      agents: dependencies.agents,
      snapshotStore: this.snapshotStore,
    })
    this.identityService = new IdentityService({
      profiles: dependencies.profiles,
      snapshotStore: this.snapshotStore,
    })
    this.sessionModelService = new SessionModelService({
      sessions: dependencies.sessions,
    })
    const emit = this.emit.bind(this)
    const now = () => new Date().toISOString()
    this.bashApprovals = new BashApprovalRegistry({ emit, now })
    this.skillService = new SkillService({
      skills: dependencies.skills,
      sessions: dependencies.sessions,
      defaultAgentId: YUANXIAO_DEFAULT_AGENT_ID,
      emit,
      now,
    })
    this.clarifications = new ClarificationRegistry({ emit, now })
    this.sessions.subscribe((event) => {
      this.applyAgentEvent(event)
      // 内部驱动事件（message-appended/message-delta/message-completed/
      // activity-updated）已由 applyAgentEvent 翻译为 transcript-delta，
      // 不属于公开 AgentEvent，直接向订阅者转发会导致 agentEventSchema 校验失败。
      if (!isInternalDriverEvent(event)) {
        this.emit(event)
      }
      // 当 run 因任何原因结束（取消/失败/完成）时，自动清理
      // 该 session 的待审批请求，防止审批卡片在 UI 中堆积。
      if (event.type === 'turn-cancelled' || event.type === 'turn-failed') {
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

  protected abstract dequeueNext(): void

  protected abstract completeRunStart(sessionId: string): void

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
   * @throws 当 Session 模块取消失败时，Promise 会 reject。
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
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
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
   * 从当前缓存或 Session 模块的会话列表中查找会话摘要。
   *
   * @param sessionId - 需要查找的会话标识。
   * @returns 找到时返回会话摘要，否则返回 undefined。
   * @throws 当 Session 模块读取会话列表失败时，Promise 会 reject。
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
    const driverEvent = event as DriverEvent

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

    if (driverEvent.type === 'compaction-detected') {
      this.transcriptEmitter.appendCompactionEntry(driverEvent)
      return
    }

    if (driverEvent.type === 'auto-retry-progress') {
      this.transcriptEmitter.updateAttemptRetryCount(driverEvent)
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
