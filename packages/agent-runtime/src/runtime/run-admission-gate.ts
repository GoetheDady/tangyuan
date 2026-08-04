import type { AgentEvent, DriverEvent } from '../driver'
import { AgentRuntimeError } from '../core'
import type {
  AgentRunState,
  GetSessionMessagesRequest,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'

/** 谱系 mutation 持有的会话锁。 */
export interface SessionMutationLease {
  lock(sessionIds: readonly string[]): void
  owns(sessionId: string): boolean
  waitForPendingForks(sessionIds: readonly string[]): Promise<void>
  release(): void
}

export interface RunAdmissionGateDependencies {
  emit(event: AgentEvent): void
  upsertSessionState(
    sessionId: string,
    state: AgentRunState,
    updatedAt: string,
  ): void
  getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot>
  activeRunCount(): number
  isRunActive(sessionId: string): boolean
  now(): string
}

interface QueuedRun {
  request: GetSessionMessagesRequest
  execute(): Promise<void>
  resolve(snapshot: TranscriptSnapshot): void
  reject(error: unknown): void
}

const DEFAULT_DEPENDENCIES: RunAdmissionGateDependencies = {
  emit: () => undefined,
  upsertSessionState: () => undefined,
  getTranscript: async () => {
    throw new Error('运行准入 module 未配置 transcript 读取能力。')
  },
  activeRunCount: () => 0,
  isRunActive: () => false,
  now: () => new Date().toISOString(),
}

/**
 * 运行准入 module：统一持有容量、队列、run-start 占位、谱系 mutation 与并发分叉。
 */
export class RunAdmissionGate {
  static readonly MAX_CONCURRENT_RUNS = 4

  private readonly dependencies: RunAdmissionGateDependencies
  private readonly pendingRunStarts = new Map<
    string,
    { promise: Promise<void>; resolve(): void }
  >()
  private readonly mutatingSessionIds = new Set<string>()
  private readonly pendingForksBySourceSession = new Map<
    string,
    Set<Promise<unknown>>
  >()
  private readonly runQueue: QueuedRun[] = []

  constructor(dependencies: RunAdmissionGateDependencies = DEFAULT_DEPENDENCIES) {
    this.dependencies = dependencies
  }

  /** 提交一次 run；内部决定立即执行或排队，并在完成后返回 transcript。 */
  submit(
    request: GetSessionMessagesRequest,
    execute: () => Promise<void>,
  ): Promise<TranscriptSnapshot> {
    this.assertAvailable(request.sessionId)
    this.assertNotAlreadyAdmitted(request.sessionId)

    if (!this.hasCapacity()) {
      return this.enqueue(request, execute)
    }

    return this.executeAdmitted(request, execute, false)
  }

  /** 将 Driver 事件归入准入状态机，释放启动占位并唤醒队列。 */
  applyEvent(event: AgentEvent | DriverEvent): void {
    if (event.type === 'attempt-started') {
      this.completeRunStart(event.sessionId)
      this.dequeueNext()
      return
    }

    if (
      event.type === 'turn-cancelled' ||
      event.type === 'turn-failed' ||
      (event.type === 'run-state-changed' &&
        event.state !== 'running' &&
        event.state !== 'queued')
    ) {
      this.dequeueNext()
    }
  }

  /** 会话是否已经排队。 */
  isQueued(sessionId: string): boolean {
    return this.runQueue.some((queued) => queued.request.sessionId === sessionId)
  }

  /** 取消一个排队 run；命中时投影 cancelled 并 resolve 空 transcript。 */
  cancelQueued(sessionId: string, agentId: string): boolean {
    const queueIndex = this.runQueue.findIndex(
      (queued) => queued.request.sessionId === sessionId,
    )
    if (queueIndex < 0) return false

    const [queued] = this.runQueue.splice(queueIndex, 1)
    const occurredAt = this.dependencies.now()
    this.transition(sessionId, agentId, 'cancelled', occurredAt)
    queued!.resolve({
      agentId,
      sessionId,
      entries: [],
      updatedAt: occurredAt,
    })
    return true
  }

  /** 清空所有排队 run，供应用退出使用。 */
  drainAll(): void {
    const queue = this.runQueue.splice(0)
    const occurredAt = this.dependencies.now()
    for (const queued of queue) {
      queued.resolve({
        agentId: queued.request.agentId,
        sessionId: queued.request.sessionId,
        entries: [],
        updatedAt: occurredAt,
      })
    }
  }

  assertAvailable(sessionId: string): void {
    if (this.isMutationLocked(sessionId)) {
      throw new Error('当前会话正在归档或删除，请稍后重试。')
    }
  }

  async trackFork<T>(
    sourceSessionId: string,
    pendingFork: Promise<T>,
  ): Promise<T> {
    this.assertAvailable(sourceSessionId)
    const pendingForSource =
      this.pendingForksBySourceSession.get(sourceSessionId) ?? new Set()
    pendingForSource.add(pendingFork)
    this.pendingForksBySourceSession.set(sourceSessionId, pendingForSource)

    try {
      return await pendingFork
    } finally {
      pendingForSource.delete(pendingFork)
      if (pendingForSource.size === 0) {
        this.pendingForksBySourceSession.delete(sourceSessionId)
      }
    }
  }

  async waitForRunStart(sessionId: string): Promise<void> {
    await this.pendingRunStarts.get(sessionId)?.promise
  }

  isRunStarting(sessionId: string): boolean {
    return this.pendingRunStarts.has(sessionId)
  }

  acquireMutation(rootSessionId: string): SessionMutationLease {
    const ownedSessionIds = new Set<string>()
    let released = false
    const lock = (sessionIds: readonly string[]): void => {
      const conflict = sessionIds.find(
        (sessionId) =>
          this.mutatingSessionIds.has(sessionId) &&
          !ownedSessionIds.has(sessionId),
      )
      if (conflict) {
        throw new Error(`会话 ${conflict} 已在其他归档或删除操作中。`)
      }
      for (const sessionId of sessionIds) {
        this.mutatingSessionIds.add(sessionId)
        ownedSessionIds.add(sessionId)
      }
    }
    lock([rootSessionId])

    return {
      lock,
      owns: (sessionId) => ownedSessionIds.has(sessionId),
      waitForPendingForks: async (sessionIds) => {
        const pending = sessionIds.flatMap((sessionId) => [
          ...(this.pendingForksBySourceSession.get(sessionId) ?? []),
        ])
        await Promise.allSettled(pending)
      },
      release: () => {
        if (released) return
        released = true
        for (const sessionId of ownedSessionIds) {
          this.mutatingSessionIds.delete(sessionId)
        }
        this.dequeueNext()
      },
    }
  }

  private assertNotAlreadyAdmitted(sessionId: string): void {
    if (this.isQueued(sessionId)) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话已在排队中，请等待或取消排队。',
        recoverable: true,
      })
    }

    if (
      this.dependencies.isRunActive(sessionId) ||
      this.isRunStarting(sessionId)
    ) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }
  }

  private isMutationLocked(sessionId: string): boolean {
    return this.mutatingSessionIds.has(sessionId)
  }

  private hasCapacity(): boolean {
    return (
      this.dependencies.activeRunCount() + this.pendingRunStarts.size <
      RunAdmissionGate.MAX_CONCURRENT_RUNS
    )
  }

  private enqueue(
    request: GetSessionMessagesRequest,
    execute: () => Promise<void>,
  ): Promise<TranscriptSnapshot> {
    const occurredAt = this.dependencies.now()
    this.transition(request.sessionId, request.agentId, 'queued', occurredAt)
    return new Promise<TranscriptSnapshot>((resolve, reject) => {
      this.runQueue.push({ request, execute, resolve, reject })
    })
  }

  private executeAdmitted(
    request: GetSessionMessagesRequest,
    execute: () => Promise<void>,
    wasQueued: boolean,
  ): Promise<TranscriptSnapshot> {
    if (wasQueued) {
      const occurredAt = this.dependencies.now()
      this.transition(request.sessionId, request.agentId, 'running', occurredAt)
    }
    this.beginRunStart(request.sessionId)

    return Promise.resolve()
      .then(execute)
      .then(() => this.dependencies.getTranscript(request))
      .finally(() => {
        this.completeRunStart(request.sessionId)
        this.dequeueNext()
      })
  }

  private dequeueNext(): void {
    while (this.hasCapacity()) {
      const queueIndex = this.runQueue.findIndex(
        (queued) => !this.isMutationLocked(queued.request.sessionId),
      )
      const [queued] =
        queueIndex >= 0 ? this.runQueue.splice(queueIndex, 1) : []
      if (!queued) return

      void this.executeAdmitted(queued.request, queued.execute, true).then(
        queued.resolve,
        queued.reject,
      )
    }
  }

  private beginRunStart(sessionId: string): void {
    if (this.pendingRunStarts.has(sessionId)) return

    let resolve!: () => void
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve
    })
    this.pendingRunStarts.set(sessionId, { promise, resolve })
  }

  private completeRunStart(sessionId: string): void {
    const pending = this.pendingRunStarts.get(sessionId)
    if (!pending) return

    this.pendingRunStarts.delete(sessionId)
    pending.resolve()
  }

  private transition(
    sessionId: string,
    agentId: string,
    state: AgentRunState,
    occurredAt: string,
  ): void {
    this.dependencies.emit({
      type: 'run-state-changed',
      agentId,
      sessionId,
      state,
      occurredAt,
    })
    this.dependencies.upsertSessionState(sessionId, state, occurredAt)
  }
}
