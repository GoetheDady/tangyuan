import type { AgentEvent } from '../driver'
import type {
  AgentSessionSummary,
  GetSessionMessagesRequest,
  SendMessageRequest,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { YUANXIAO_DEFAULT_AGENT_ID } from '@yuanxiao/contracts'

export interface RunSchedulerDependencies {
  /** 向公开订阅者广播运行状态事件。 */
  emit(event: AgentEvent): void
  /** 更新会话缓存的运行状态。 */
  upsertSessionState(
    sessionId: string,
    state: AgentSessionSummary['state'],
    updatedAt: string,
  ): void
  /** 判断会话是否正在归档（归档中的会话不参与出队）。 */
  isArchiving(sessionId: string): boolean
  /** 向 Session 模块发送消息。 */
  sendMessage(request: SendMessageRequest): Promise<void>
  /** 读取发送完成后的会话快照。 */
  getTranscript(request: GetSessionMessagesRequest): Promise<TranscriptSnapshot>
  /** 当前正在运行的会话数（含已收到 driver run-started 的会话）。 */
  activeRunCount(): number
}

/**
 * 运行队列与并发上限调度器。
 *
 * 负责排队、出队、并发容量和"正在启动"占位：把运行调度从
 * Runtime 类中剥离，Runtime 只负责业务编排，调度细节集中在本模块。
 */
export class RunScheduler {
  static readonly MAX_CONCURRENT_RUNS = 4

  private readonly pendingRunStarts = new Map<
    string,
    { promise: Promise<void>; resolve(): void }
  >()
  private runQueue: Array<{
    request: SendMessageRequest
    resolve: (value: TranscriptSnapshot) => void
    reject: (error: Error) => void
  }> = []

  private readonly emit: (event: AgentEvent) => void
  private readonly upsertSessionState: RunSchedulerDependencies['upsertSessionState']
  private readonly isArchiving: (sessionId: string) => boolean
  private readonly sendMessage: (request: SendMessageRequest) => Promise<void>
  private readonly getTranscript: (
    request: GetSessionMessagesRequest,
  ) => Promise<TranscriptSnapshot>
  private readonly activeRunCount: () => number

  constructor(dependencies: RunSchedulerDependencies) {
    this.emit = dependencies.emit
    this.upsertSessionState = dependencies.upsertSessionState
    this.isArchiving = dependencies.isArchiving
    this.sendMessage = dependencies.sendMessage
    this.getTranscript = dependencies.getTranscript
    this.activeRunCount = dependencies.activeRunCount
  }

  /** 入队并返回等待执行的快照 Promise。 */
  enqueueRun(request: SendMessageRequest): Promise<TranscriptSnapshot> {
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

  /** 有剩余容量时取出队列中第一个非归档会话开始执行。 */
  dequeueNext(): void {
    if (!this.hasRunCapacity()) return

    const queueIndex = this.runQueue.findIndex(
      (candidate) => !this.isArchiving(candidate.request.sessionId),
    )
    const [queued] = queueIndex >= 0 ? this.runQueue.splice(queueIndex, 1) : []
    if (!queued) return

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
    this.sendMessage(request)
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

  /** 标记会话开始启动，重复调用不生效（并发保护的占位）。 */
  beginRunStart(sessionId: string): void {
    if (this.pendingRunStarts.has(sessionId)) return

    let resolve!: () => void
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve
    })
    this.pendingRunStarts.set(sessionId, { promise, resolve })
  }

  /** 清除会话的启动占位。 */
  completeRunStart(sessionId: string): void {
    const pending = this.pendingRunStarts.get(sessionId)
    if (!pending) return

    this.pendingRunStarts.delete(sessionId)
    pending.resolve()
  }

  /** 等待会话的启动占位被清除。 */
  async waitForRunStart(sessionId: string): Promise<void> {
    await this.pendingRunStarts.get(sessionId)?.promise
  }

  /** 会话是否处于启动占位中。 */
  isRunStarting(sessionId: string): boolean {
    return this.pendingRunStarts.has(sessionId)
  }

  /** 是否还有并发容量。 */
  hasRunCapacity(): boolean {
    return (
      this.activeRunCount() + this.pendingRunStarts.size <
      RunScheduler.MAX_CONCURRENT_RUNS
    )
  }

  /** 会话是否已在队列中。 */
  hasQueued(sessionId: string): boolean {
    return this.runQueue.some((q) => q.request.sessionId === sessionId)
  }

  /**
   * 取消队列中的会话请求（若存在），返回是否命中。
   *
   * 命中时广播 cancelled 状态并立即以空快照 resolve 排队 Promise。
   */
  cancelQueued(sessionId: string, agentId: string): boolean {
    const queueIndex = this.runQueue.findIndex(
      (q) => q.request.sessionId === sessionId,
    )
    if (queueIndex < 0) return false

    const [queued] = this.runQueue.splice(queueIndex, 1)
    const now = new Date().toISOString()
    this.emit({
      type: 'run-state-changed',
      agentId,
      sessionId,
      state: 'cancelled',
      occurredAt: now,
    })
    this.upsertSessionState(sessionId, 'cancelled', now)
    queued!.resolve({
      agentId,
      sessionId,
      entries: [],
      updatedAt: now,
    })
    return true
  }

  /** 清空队列，把所有排队请求以空快照 resolve（用于应用退出/全部取消）。 */
  drainAll(): void {
    const queue = [...this.runQueue]
    this.runQueue.length = 0
    const now = new Date().toISOString()
    for (const queued of queue) {
      queued.resolve({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: queued.request.sessionId,
        entries: [],
        updatedAt: now,
      })
    }
  }
}
