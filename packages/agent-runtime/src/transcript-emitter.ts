import type {
  AgentEvent,
  AgentEventListener,
} from './index'
import {
  applyTranscriptDelta,
  type ExecutionAttempt,
  type TranscriptDelta,
  type TranscriptSnapshot,
  type TurnStep,
} from '@tangyuan/contracts'

/**
 * turn 追踪状态。
 */
interface TurnState {
  entryIndex: number
  turnIndex: number
  stepIndex: number
  currentTurnHasToolCall: boolean
  lastStepKind: TurnStep['kind'] | null
}

/**
 * 负责 transcript delta 的发射逻辑。
 *
 * 持有 session ↔ entry 索引和 attempt 关联等内部状态，
 * 通过注入的 emit 回调向 Runtime 订阅者广播标准事件。
 */
export class TranscriptEmitter {
  private readonly sessionNextIndex = new Map<string, number>()
  private readonly messageToEntryIndex = new Map<string, number>()
  private readonly pendingAttemptBySession = new Map<string, ExecutionAttempt>()
  private readonly runToAttempt = new Map<string, ExecutionAttempt>()
  private readonly turnStateByRun = new Map<string, TurnState>()
  private readonly transcriptSnapshots = new Map<string, TranscriptSnapshot>()
  private readonly emit: AgentEventListener

  constructor(emit: AgentEventListener) {
    this.emit = emit
  }

  /**
   * 返回指定会话的累积 transcript 快照（含 turns/steps）。
   * 若从未收到过该会话的 delta，返回 undefined。
   */
  getSnapshot(sessionId: string): TranscriptSnapshot | undefined {
    return this.transcriptSnapshots.get(sessionId)
  }

  /**
   * 确保指定会话有初始 transcript 快照。
   */
  private ensureSnapshot(agentId: string, sessionId: string): TranscriptSnapshot {
    const existing = this.transcriptSnapshots.get(sessionId)
    if (existing) return existing

    const snapshot: TranscriptSnapshot = {
      sessionId,
      agentId,
      entries: [],
      updatedAt: new Date().toISOString(),
    }
    this.transcriptSnapshots.set(sessionId, snapshot)
    return snapshot
  }


  /**
   * 为 message-appended 事件生成 transcript-delta。
   *
   * @param event - message-appended 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  emitTranscriptDeltaForMessageAppended(
    event: Extract<AgentEvent, { type: 'message-appended' }>,
  ): void {
    const message = event.message
    const sessionId = message.sessionId
    const nextIndex = this.sessionNextIndex.get(sessionId) ?? 0

    if (message.role === 'user') {
      const delta: TranscriptDelta = {
        type: 'entry-appended',
        entry: {
          kind: 'user-message',
          index: nextIndex,
          messageId: message.messageId,
          content: message.content,
          createdAt: message.createdAt,
        },
      }
      this.emitTranscriptDeltaEvent(event.agentId, sessionId, delta)
      this.sessionNextIndex.set(sessionId, nextIndex + 1)
      return
    }

    if (message.role === 'agent') {
      const attempt = this.pendingAttemptBySession.get(sessionId) ?? null
      const delta: TranscriptDelta = {
        type: 'entry-appended',
        entry: {
          kind: 'agent-reply',
          index: nextIndex,
          messageId: message.messageId,
          content: message.content,
          createdAt: message.createdAt,
          attempt,
          turns: [],
        },
      }
      this.messageToEntryIndex.set(message.messageId, nextIndex)
      this.emitTranscriptDeltaEvent(event.agentId, sessionId, delta)
      this.sessionNextIndex.set(sessionId, nextIndex + 1)
      return
    }

    if (message.role === 'compaction') {
      const delta: TranscriptDelta = {
        type: 'entry-appended',
        entry: {
          kind: 'compaction',
          index: nextIndex,
          timestamp: message.createdAt,
        },
      }
      this.emitTranscriptDeltaEvent(event.agentId, sessionId, delta)
      this.sessionNextIndex.set(sessionId, nextIndex + 1)
    }
  }

  /**
   * 为 turn-started 事件创建 ExecutionAttempt 并发出 transcript-delta。
   *
   * @param event - turn-started 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  startAttemptForRun(
    event: Extract<AgentEvent, { type: 'turn-started' }>,
  ): void {
    const attempt: ExecutionAttempt = {
      attemptId: event.runId,
      runId: event.runId,
      status: 'running',
      startedAt: event.occurredAt,
      completedAt: null,
    }
    this.runToAttempt.set(event.runId, attempt)
    this.pendingAttemptBySession.set(event.sessionId, attempt)
  }

  /**
   * 为 message-delta 事件发出 delta-appended。
   *
   * @param event - message-delta 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  emitTranscriptDeltaForDelta(
    event: Extract<AgentEvent, { type: 'message-delta' }>,
  ): void {
    const entryIndex = this.messageToEntryIndex.get(event.messageId)
    if (entryIndex === undefined) return

    const delta: TranscriptDelta = {
      type: 'delta-appended',
      index: entryIndex,
      delta: event.delta,
    }
    this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
  }

  /**
   * 为 turn-started 事件初始化 turn 状态并发出第一个 turn 的 step-appended。
   *
   * @param event - turn-started 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  initializeTurnStateForRun(
    event: Extract<AgentEvent, { type: 'turn-started' }>,
  ): void {
    const entryIndex = this.findLastAgentReplyIndex()
    if (entryIndex === undefined) return

    this.turnStateByRun.set(event.runId, {
      entryIndex,
      turnIndex: 0,
      stepIndex: 0,
      currentTurnHasToolCall: false,
      lastStepKind: null,
    })
  }

  /**
   * 为 thinking delta 发出 step-appended 或 step-updated。
   *
   * @param event - message-delta 事件（deltaKind 为 'thinking'）。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  emitTranscriptDeltaForThinking(
    event: Extract<AgentEvent, { type: 'message-delta' }>,
  ): void {
    const turnState = this.turnStateByRun.get(event.runId)
    if (!turnState) return

    const now = event.occurredAt
    // If the current step is a thinking step, update it. Otherwise, create new.
    // For simplicity, create a step-appended on first thinking delta, step-updated on subsequent.
    const step: import('@tangyuan/contracts').TurnStep = {
      index: turnState.stepIndex,
      kind: 'thinking',
      content: event.delta,
      status: 'running',
      startedAt: now,
      completedAt: null,
    }

    // If last step was thinking, update it (accumulate). Otherwise create new.
    if (turnState.lastStepKind === 'thinking') {
      const stepIndex = turnState.stepIndex - 1
      const delta: TranscriptDelta = {
        type: 'step-updated',
        index: turnState.entryIndex,
        turnIndex: turnState.turnIndex,
        stepIndex,
        step: { ...step, index: stepIndex },
      }
      this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
    } else {
      const delta: TranscriptDelta = {
        type: 'step-appended',
        index: turnState.entryIndex,
        turnIndex: turnState.turnIndex,
        step,
      }
      this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
      turnState.stepIndex++
      turnState.lastStepKind = 'thinking'
    }
  }

  /**
   * 为 activity-updated 事件发出 step-appended 或 step-updated。
   *
   * @param event - activity-updated 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  emitTranscriptDeltaForActivity(
    event: Extract<AgentEvent, { type: 'activity-updated' }>,
  ): void {
    const turnState = this.turnStateByRun.get(event.runId)
    if (!turnState) return

    const now = event.occurredAt
    const activity = event.activity

    if (activity.kind === 'tool') {
      const toolName = activity.label
      const status =
        activity.state === 'running'
          ? ('running' as const)
          : activity.state === 'completed'
            ? ('completed' as const)
            : ('failed' as const)

      const step: import('@tangyuan/contracts').TurnStep = {
        index: turnState.stepIndex,
        kind: 'tool-call',
        content: toolName,
        status,
        startedAt: now,
        completedAt: status !== 'running' ? now : null,
      }

      if (status === 'running') {
        // New tool call means a new turn boundary
        turnState.currentTurnHasToolCall = true
        const delta: TranscriptDelta = {
          type: 'step-appended',
          index: turnState.entryIndex,
          turnIndex: turnState.turnIndex,
          step,
        }
        this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
        turnState.stepIndex++
        turnState.lastStepKind = 'tool-call'
      } else {
        // Update existing tool step
        const stepIndex = turnState.stepIndex - 1
        if (stepIndex >= 0) {
          const delta: TranscriptDelta = {
            type: 'step-updated',
            index: turnState.entryIndex,
            turnIndex: turnState.turnIndex,
            stepIndex,
            step: { ...step, index: stepIndex },
          }
          this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
        }
      }
    }
  }

  /**
   * 为 message-completed 事件完成 ExecutionAttempt 并发出 entry-updated。
   *
   * @param event - message-completed 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  completeAttemptForRun(
    event: Extract<AgentEvent, { type: 'message-completed' }>,
  ): void {
    const attempt = this.runToAttempt.get(event.runId)
    const entryIndex = this.messageToEntryIndex.get(event.message.messageId)
    if (entryIndex === undefined) return

    const completedAttempt: ExecutionAttempt = attempt
      ? { ...attempt, status: 'completed', completedAt: event.occurredAt }
      : {
          attemptId: event.runId,
          runId: event.runId,
          status: 'completed',
          startedAt: event.occurredAt,
          completedAt: event.occurredAt,
        }

    // Always store in runToAttempt so future lookups work
    if (!attempt) {
      this.runToAttempt.set(event.runId, completedAttempt)
    }

    const delta: TranscriptDelta = {
      type: 'attempt-status-changed',
      index: entryIndex,
      attempt: completedAttempt,
    }
    this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
    this.pendingAttemptBySession.delete(event.sessionId)
  }

  /**
   * 为 turn-cancelled 或 turn-failed 事件更新 ExecutionAttempt 状态。
   *
   * @param sessionId - 会话标识。
   * @param runId - 运行标识。
   * @param status - 最终状态。
   * @param occurredAt - 事件时间。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  failAttemptForRun(
    sessionId: string,
    runId: string,
    status: 'cancelled' | 'failed',
    occurredAt: string,
  ): void {
    const attempt = this.runToAttempt.get(runId)
    const updatedAttempt: ExecutionAttempt = attempt
      ? { ...attempt, status, completedAt: occurredAt }
      : {
          attemptId: runId,
          runId,
          status,
          startedAt: occurredAt,
          completedAt: occurredAt,
        }

    // Find the agent-reply entry index for this session
    const entryIndex = this.findLastAgentReplyIndex()
    if (entryIndex === undefined) return

    const delta: TranscriptDelta = {
      type: 'attempt-status-changed',
      index: entryIndex,
      attempt: updatedAttempt,
    }
    this.emitTranscriptDeltaEvent(
      // Use a reasonable agentId; the session should be known
      'tangyuan',
      sessionId,
      delta,
    )
    this.pendingAttemptBySession.delete(sessionId)
  }

  /**
   * 查找指定会话中最后一个 agent-reply 条目的索引。
   *
   * @param sessionId - 会话标识。
   * @returns 条目索引；不存在时返回 undefined。
   */
  findLastAgentReplyIndex(): number | undefined {
    let lastIndex: number | undefined
    for (const [, index] of this.messageToEntryIndex) {
      lastIndex = index
    }
    return lastIndex
  }

  /**
   * 发出 transcript-delta 标准事件。
   *
   * @param agentId - Agent 标识。
   * @param sessionId - 会话标识。
   * @param delta - 增量更新载荷。
   * @returns 无返回值。
   */
  emitTranscriptDeltaEvent(
    agentId: string,
    sessionId: string,
    delta: TranscriptDelta,
  ): void {
    // Accumulate snapshot for session reconstruction (AC 8)
    const snapshot = this.ensureSnapshot(agentId, sessionId)
    const nextSnapshot = applyTranscriptDelta(snapshot, delta)
    if (delta.type === 'step-appended') {
      const entry = nextSnapshot.entries[delta.index]
    }
    this.transcriptSnapshots.set(sessionId, {
      ...nextSnapshot,
      updatedAt: new Date().toISOString(),
    })

    this.emit({
      type: 'transcript-delta',
      agentId,
      sessionId,
      delta,
      occurredAt: new Date().toISOString(),
    })
  }
}
