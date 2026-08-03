import type {
  SendMessageRequest,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { YuanxiaoRuntimeApprovals } from './yuanxiao-runtime-approvals'

/** Runtime 的并发槽、排队和 Session 启动阶段协调。 */
export abstract class YuanxiaoRuntimeScheduling extends YuanxiaoRuntimeApprovals {
  private static readonly MAX_CONCURRENT_RUNS = 4
  private readonly pendingRunStarts = new Map<
    string,
    { promise: Promise<void>; resolve(): void }
  >()

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

  protected dequeueNext(): void {
    if (!this.hasRunCapacity()) return

    const queueIndex = this.runQueue.findIndex(
      (candidate) =>
        !this.sessionArchiveCoordinator.isArchiving(
          candidate.request.sessionId,
        ),
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
    this.sessions
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

  protected beginRunStart(sessionId: string): void {
    if (this.pendingRunStarts.has(sessionId)) return

    let resolve!: () => void
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve
    })
    this.pendingRunStarts.set(sessionId, { promise, resolve })
  }

  protected completeRunStart(sessionId: string): void {
    const pending = this.pendingRunStarts.get(sessionId)
    if (!pending) return

    this.pendingRunStarts.delete(sessionId)
    pending.resolve()
  }

  protected async waitForRunStart(sessionId: string): Promise<void> {
    await this.pendingRunStarts.get(sessionId)?.promise
  }

  protected isRunStarting(sessionId: string): boolean {
    return this.pendingRunStarts.has(sessionId)
  }

  protected hasRunCapacity(): boolean {
    return (
      this.activeRunIds.size + this.pendingRunStarts.size <
      YuanxiaoRuntimeScheduling.MAX_CONCURRENT_RUNS
    )
  }
}
