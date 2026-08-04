import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  DriverEvent,
} from '../driver'
import { TranscriptEmitter } from '../session/transcript-emitter'
import { CommandPermissionModule, ClarificationRegistry } from '../approval'
import { SessionDirectory } from '../session/session-directory'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager, IdentityService } from '../agent'
import { SkillService } from '../skill'
import { SessionContinuation } from '../session/session-continuation'
import { SessionLineageLifecycle } from '../session/session-lineage-lifecycle'
import { createRuntimeInternals } from './runtime-internals'
import { RunAdmissionGate } from './run-admission-gate'
import { AgentRuntimeError } from '../core'
import {
  type AgentSessionSummary,
  type CancelRunRequest,
  type GetSessionMessagesRequest,
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
  protected readonly sessionLineageLifecycle: SessionLineageLifecycle
  protected readonly transcriptEmitter: TranscriptEmitter
  protected readonly snapshotStore: RuntimeSnapshotStore
  protected readonly agentManager: AgentManager
  protected readonly identityService: IdentityService
  protected readonly sessionDirectory: SessionDirectory
  protected readonly sessionContinuation: SessionContinuation
  protected readonly runAdmission: RunAdmissionGate
  protected readonly commandPermissions: CommandPermissionModule
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
    const created = createRuntimeInternals(
      dependencies,
      this.emit.bind(this),
      () => new Date().toISOString(),
    )
    this.transcriptEmitter = created.transcriptEmitter
    this.snapshotStore = created.snapshotStore
    this.agentManager = created.agentManager
    this.identityService = created.identityService
    this.commandPermissions = created.commandPermissions
    this.skillService = created.skillService
    this.clarifications = created.clarifications
    this.runAdmission = new RunAdmissionGate({
      emit: this.emit.bind(this),
      upsertSessionState: (sessionId, state, updatedAt) =>
        this.upsertSessionState(sessionId, state, updatedAt),
      getTranscript: (request) => this.getTranscript(request),
      activeRunCount: () => this.sessions.getActiveRunCount(),
      isRunActive: (sessionId) =>
        this.sessions.getActiveRunId(sessionId) !== undefined,
      now: () => new Date().toISOString(),
    })
    this.sessionDirectory = new SessionDirectory({
      sessions: this.sessions,
      isQueued: (sessionId) => this.runAdmission.isQueued(sessionId),
    })
    this.sessionContinuation = new SessionContinuation({
      sessions: this.sessions,
      directory: this.sessionDirectory,
      snapshotStore: this.snapshotStore,
      lastActiveSessionStore: this.lastActiveSessionStore,
      getTranscript: (request) => this.getTranscript(request),
    })
    this.sessionLineageLifecycle = new SessionLineageLifecycle({
      sessions: this.sessions,
      directory: this.sessionDirectory,
      admission: this.runAdmission,
      transcriptEmitter: this.transcriptEmitter,
      lastActiveSessionStore: this.lastActiveSessionStore,
      cancelRun: (request) => this.cancelRun(request),
      pendingApprovalSessionIds: () =>
        this.commandPermissions.list().map((approval) => approval.sessionId),
      pendingClarificationSessionIds: () =>
        this.clarifications.list().map((item) => item.sessionId),
      now: () => new Date().toISOString(),
    })
    this.sessions.subscribe((event) => {
      this.runAdmission.applyEvent(event)
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
   * @throws 当 Session 模块取消失败时，Promise 会 reject。
   */
  async cancelAllActiveRuns(): Promise<void> {
    // 自动拒绝所有待审批请求
    this.rejectAllPendingApprovals()
    this.rejectAllPendingSkillApprovals()

    // 清空队列
    this.runAdmission.drainAll()

    const runningSessions = this.sessionDirectory
      .listAll()
      .filter(
        (session) =>
          session.state === 'running' ||
          this.sessions.getActiveRunId(session.sessionId) !== undefined,
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
      const corrupted =
        snapshot.configRecovery.state === 'corrupted' ||
        snapshot.configRecovery.state === 'migration-failed'
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: corrupted
          ? '配置文件已损坏，请先恢复或重置配置。'
          : '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
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
    agentId: string,
    sessionId: string,
  ): Promise<AgentSessionSummary | undefined> {
    const cachedSession = this.sessionDirectory.find(sessionId)

    if (cachedSession) {
      return cachedSession
    }

    await this.listSessions(agentId)

    return this.sessionDirectory.find(sessionId)
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

    // 会话状态与调度是编排层的职责；transcript 投影统一交给 emitter 分派。
    if (driverEvent.type === 'attempt-started') {
      this.upsertSessionState(
        driverEvent.sessionId,
        'running',
        driverEvent.occurredAt,
      )
    } else if (driverEvent.type === 'turn-cancelled') {
      this.upsertSessionState(
        driverEvent.sessionId,
        'cancelled',
        driverEvent.occurredAt,
      )
    } else if (driverEvent.type === 'turn-failed') {
      this.upsertSessionState(
        driverEvent.sessionId,
        'failed',
        driverEvent.occurredAt,
      )
    } else if (driverEvent.type === 'run-state-changed') {
      this.upsertSessionState(
        driverEvent.sessionId,
        driverEvent.state,
        driverEvent.occurredAt,
      )
    }

    this.transcriptEmitter.applyEvent(driverEvent)
  }

  /**
   * 新增或替换会话摘要，并保持最近更新会话排在前面。
   *
   * @param session - 需要写入缓存的会话摘要。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  protected upsertSession(session: AgentSessionSummary): void {
    this.sessionDirectory.upsert(session)
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
    this.sessionDirectory.updateState(sessionId, state, updatedAt)
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
    this.commandPermissions.rejectAll()
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
    this.commandPermissions.rejectSession(sessionId)
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
