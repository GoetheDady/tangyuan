import type { AgentEventListener, DriverEvent } from './index'
import {
  applyTranscriptDelta,
  type AgentRuntimeErrorPayload,
  type ExecutionAttempt,
  type TranscriptDelta,
  type TranscriptSnapshot,
  type TurnStep,
} from '@tangyuan/contracts'
import { createToolStepSummary } from './utils'

/**
 * turn 追踪状态。
 */
interface TurnState {
  entryIndex: number
  turnIndex: number
  stepIndex: number
  currentTurnHasToolCall: boolean
  lastStepKind: TurnStep['kind'] | null
  /** toolCallId → stepIndex 映射，用于归并同一工具的实时更新与最终结果。 */
  toolCallStepIndex: Map<string, number>
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
  private ensureSnapshot(
    agentId: string,
    sessionId: string,
  ): TranscriptSnapshot {
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
    event: Extract<DriverEvent, { type: 'message-appended' }>,
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
      // 幂等：agent 条目在 turn 开头已宣告，结尾的重复 message-appended 不再建新条目。
      if (this.messageToEntryIndex.has(message.messageId)) {
        return
      }
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
          ...(event.inReplyTo ? { inReplyTo: event.inReplyTo } : {}),
        },
      }
      this.messageToEntryIndex.set(message.messageId, nextIndex)
      this.emitTranscriptDeltaEvent(event.agentId, sessionId, delta)
      this.sessionNextIndex.set(sessionId, nextIndex + 1)
      // entry 刚创建完成，若对应 attempt 已存在（turn-started 先到），立即初始化并
      // 用本轮真实 entryIndex 修正 turn-started 早到时的猜测。
      if (attempt) {
        this.ensureTurnStateInitialized(attempt.runId, nextIndex)
      }
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
    event: Extract<DriverEvent, { type: 'turn-started' }>,
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
    event: Extract<DriverEvent, { type: 'message-delta' }>,
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
   * 为 turn-started 事件初始化 turn 状态。
   *
   * turnState 依附于 agent-reply 条目，而条目可能在 turn-started 之后才创建。
   * 因此此处只尝试初始化；若条目尚未存在，则在 agent message-appended 到达时补充初始化。
   *
   * @param event - turn-started 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  initializeTurnStateForRun(
    event: Extract<DriverEvent, { type: 'turn-started' }>,
  ): void {
    this.ensureTurnStateInitialized(event.runId)
  }

  /**
   * 为指定 run 建立或修正 turn 状态，并绑定到正确的 agent-reply 条目。
   *
   * 真实顺序下 turn-started 先于 agent message-appended，此时本轮条目尚未创建，
   * findLastAgentReplyIndex 会误指上一轮条目。因此 message-appended 创建条目时
   * 会传入确切的 entryIndex 修正此前的猜测。delta 均在 message-appended 之后才发出，
   * 故修正发生在任何步骤写入之前，不会造成步骤错位。
   *
   * @param runId - 运行标识。
   * @param entryIndex - 本轮 agent-reply 条目索引；为 undefined 时回退到最后一个条目。
   * @returns 无返回值。
   */
  private ensureTurnStateInitialized(
    runId: string,
    entryIndex?: number,
  ): void {
    const existing = this.turnStateByRun.get(runId)
    if (existing) {
      // turn-started 早到时用旧条目猜错了 entryIndex，此处用真实值修正。
      if (entryIndex !== undefined) existing.entryIndex = entryIndex
      return
    }

    const resolvedIndex = entryIndex ?? this.findLastAgentReplyIndex()
    if (resolvedIndex === undefined) return

    this.turnStateByRun.set(runId, {
      entryIndex: resolvedIndex,
      turnIndex: 0,
      stepIndex: 0,
      currentTurnHasToolCall: false,
      lastStepKind: null,
      toolCallStepIndex: new Map(),
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
    event: Extract<DriverEvent, { type: 'message-delta' }>,
  ): void {
    const turnState = this.turnStateByRun.get(event.runId)
    if (!turnState) return

    // 本轮已启动过工具 → 这段 thinking 属于新一轮，先推进 turn 边界，
    // 使思考与它触发的后续工具留在同一轮。
    if (turnState.currentTurnHasToolCall) {
      turnState.turnIndex++
      turnState.stepIndex = 0
      turnState.currentTurnHasToolCall = false
      turnState.lastStepKind = null
      turnState.toolCallStepIndex = new Map()
    }

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
        runId: event.runId,
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
   * 多 turn 工具循环规则：
   * - 新 tool call 在上一个工具已完成/失败后启动 → 推进 turnIndex 创建新 turn
   * - 同一 toolCallId 的 running → completed/failed 归并为同一个 step
   * - 使用 createToolStepSummary 生成不包含敏感参数的安全摘要
   *
   * @param event - activity-updated 标准事件。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  emitTranscriptDeltaForActivity(
    event: Extract<DriverEvent, { type: 'activity-updated' }>,
  ): void {
    const turnState = this.turnStateByRun.get(event.runId)
    if (!turnState) return

    const now = event.occurredAt
    const activity = event.activity

    if (activity.kind === 'tool') {
      const toolName = activity.toolName ?? activity.label
      const toolCallId = activity.toolCallId
      const status =
        activity.state === 'running'
          ? ('running' as const)
          : activity.state === 'completed'
            ? ('completed' as const)
            : ('failed' as const)

      if (status === 'running') {
        // 多 turn 规则：如果当前 turn 已有完成的工具调用，推进到下一个 turn
        if (turnState.currentTurnHasToolCall) {
          turnState.turnIndex++
          turnState.stepIndex = 0
          turnState.currentTurnHasToolCall = false
          turnState.lastStepKind = null
          turnState.toolCallStepIndex = new Map()
        }

        const summary = createToolStepSummary(toolName, 'running')
        const step: TurnStep = {
          index: turnState.stepIndex,
          kind: 'tool-call',
          content: summary,
          status,
          startedAt: now,
          completedAt: null,
        }
        if (toolCallId !== undefined) {
          ;(step as { toolCallId?: string }).toolCallId = toolCallId
        }
        if (toolName) {
          ;(step as { toolName?: string }).toolName = toolName
        }

        // 记录 toolCallId 以便后续更新归并
        if (toolCallId) {
          turnState.toolCallStepIndex.set(toolCallId, turnState.stepIndex)
        }

        turnState.currentTurnHasToolCall = true
        const delta: TranscriptDelta = {
          type: 'step-appended',
          index: turnState.entryIndex,
          turnIndex: turnState.turnIndex,
          runId: event.runId,
          step,
        }
        this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)
        turnState.stepIndex++
        turnState.lastStepKind = 'tool-call'
      } else {
        // completed 或 failed：按 toolCallId 归并更新
        const stepIndex = toolCallId
          ? turnState.toolCallStepIndex.get(toolCallId)
          : undefined

        // 回退到最后一个 tool-call step
        const targetStepIndex =
          stepIndex !== undefined ? stepIndex : turnState.stepIndex - 1

        if (targetStepIndex >= 0) {
          const summary = createToolStepSummary(toolName, status)
          const step: TurnStep = {
            index: targetStepIndex,
            kind: 'tool-call',
            content: summary,
            status,
            startedAt: now,
            completedAt: now,
          }
          if (toolCallId !== undefined) {
            ;(step as { toolCallId?: string }).toolCallId = toolCallId
          }
          if (toolName) {
            ;(step as { toolName?: string }).toolName = toolName
          }

          const delta: TranscriptDelta = {
            type: 'step-updated',
            index: turnState.entryIndex,
            turnIndex: turnState.turnIndex,
            stepIndex: targetStepIndex,
            step,
          }
          this.emitTranscriptDeltaEvent(event.agentId, event.sessionId, delta)

          // 保持 lastStepKind 为 tool-call（用于后续 turn 边界判断）
          // 标记当前 turn 已完成（工具已结束）
          // 但不重置 currentTurnHasToolCall —— 让下一 running 工具触发 turn 推进
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
    event: Extract<DriverEvent, { type: 'message-completed' }>,
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
   * @param error - 失败时的错误信息；取消时为 undefined。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  failAttemptForRun(
    sessionId: string,
    runId: string,
    status: 'cancelled' | 'failed',
    occurredAt: string,
    error?: AgentRuntimeErrorPayload,
  ): void {
    const attempt = this.runToAttempt.get(runId)
    const updatedAttempt: ExecutionAttempt = attempt
      ? {
          ...attempt,
          status,
          completedAt: occurredAt,
          ...(error ? { error } : {}),
        }
      : {
          attemptId: runId,
          runId,
          status,
          startedAt: occurredAt,
          completedAt: occurredAt,
          ...(error ? { error } : {}),
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
