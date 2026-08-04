import type {
  AgentId,
  AgentRunState,
  AgentRuntimeErrorPayload,
} from '@yuanxiao/contracts'
import {
  AgentRuntimeError,
  createMessagePreview,
  isAbortError,
  mapPiSdkStreamEventToActivity,
  sanitizeErrorMessage,
} from '../core'
import type {
  DriverEvent,
  PiSdkSessionHandle,
} from '../driver/pi-sdk-driver-contracts'
import type { MessageStore } from './message-store'
import type { SessionIndexStore } from './session-index-store'
import type { PersistedAttemptEntry } from './session-index-types'

type AttemptIndex = Pick<SessionIndexStore, 'resolveAttempts' | 'upsertAttempt'>
type AttemptMessages = Pick<
  MessageStore,
  'append' | 'appendDelta' | 'complete' | 'removeIfEmpty'
>

export interface AttemptLifecycleDependencies {
  sessionIndexStore: AttemptIndex
  messageStore: AttemptMessages
  emit(event: DriverEvent): void
  updateSessionState(sessionId: string, state: AgentRunState): Promise<void>
  invalidateTranscript(sessionId: string): void
  performBootstrapCompletionGating(): Promise<void>
  afterRun(sessionId: string, agentId: AgentId): Promise<void>
  now(): string
}

export interface ExecuteAttemptInput {
  agentId: AgentId
  sessionId: string
  sessionState: AgentRunState
  content: string
  handle: PiSdkSessionHandle
  inReplyTo?: string
}

interface FinishAttemptInput {
  sessionId: string
  runId: string
  messageId: string
  status: Exclude<PersistedAttemptEntry['status'], 'running'>
  completedAt: string
  lastMessagePreview?: string
  inReplyTo?: string
  error?: AgentRuntimeErrorPayload
  retryCount?: number
}

/**
 * 执行一次完整尝试：持有运行身份、stream 投影、消息、终态、持久化与收尾协议。
 */
export class AttemptLifecycle {
  private readonly activeRunIds = new Map<string, string>()
  private readonly runSequenceBySession = new Map<string, number>()

  constructor(private readonly dependencies: AttemptLifecycleDependencies) {}

  getActiveRunId(sessionId: string): string | undefined {
    return this.activeRunIds.get(sessionId)
  }

  getActiveRunCount(): number {
    return this.activeRunIds.size
  }

  removeSessions(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      this.activeRunIds.delete(sessionId)
      this.runSequenceBySession.delete(sessionId)
    }
  }

  async execute(input: ExecuteAttemptInput): Promise<void> {
    const content = input.content.trim()
    if (this.activeRunIds.has(input.sessionId) || input.sessionState === 'running') {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }
    if (!content) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '消息为空，无法启动执行尝试。',
        recoverable: true,
      })
    }

    const runId = this.createRunId(input.sessionId)
    const startedAt = this.dependencies.now()
    const agentMessage = this.dependencies.messageStore.append({
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: 'agent',
      content: '',
    })

    this.activeRunIds.set(input.sessionId, runId)
    await this.dependencies.updateSessionState(input.sessionId, 'running')
    this.dependencies.emit({
      type: 'attempt-started',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId,
      occurredAt: startedAt,
    })
    await this.start({
      sessionId: input.sessionId,
      runId,
      messageId: agentMessage.messageId,
      startedAt,
      lastMessagePreview: createMessagePreview(content),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    })
    this.dependencies.invalidateTranscript(input.sessionId)

    await this.executePrompt({
      ...input,
      content,
      runId,
      messageId: agentMessage.messageId,
    })
  }

  async cancel(input: {
    agentId: AgentId
    sessionId: string
    handle?: PiSdkSessionHandle
  }): Promise<void> {
    const runId = this.activeRunIds.get(input.sessionId)
    if (runId) this.activeRunIds.delete(input.sessionId)

    await input.handle?.abort()
    await this.dependencies.updateSessionState(input.sessionId, 'cancelled')

    if (runId) {
      this.dependencies.emit({
        type: 'turn-cancelled',
        agentId: input.agentId,
        sessionId: input.sessionId,
        runId,
        occurredAt: this.dependencies.now(),
      })
    }
  }

  private async executePrompt(
    input: ExecuteAttemptInput & { runId: string; messageId: string },
  ): Promise<void> {
    const inReplyToPatch = input.inReplyTo
      ? { inReplyTo: input.inReplyTo }
      : {}
    let retryCount = 0
    try {
      let accumulatedReply = ''
      let turnIndex = 0
      let agentEntryAnnounced = false
      const announceAgentEntry = (): void => {
        if (agentEntryAnnounced) return
        agentEntryAnnounced = true
        this.dependencies.emit({
          type: 'message-appended',
          agentId: input.agentId,
          message: this.dependencies.messageStore.complete(input.messageId),
          occurredAt: this.dependencies.now(),
        })
      }

      const agentReply = await input.handle.prompt(input.content, {
        onEvent: (event) => {
          if (event.type === 'thinking-started') {
            announceAgentEntry()
            this.dependencies.emit({
              type: 'activity-updated',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              activity: mapPiSdkStreamEventToActivity(event),
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'thinking-delta') {
            announceAgentEntry()
            this.dependencies.emit({
              type: 'message-delta',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              messageId: input.messageId,
              delta: event.delta,
              deltaKind: 'thinking',
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'text-delta') {
            announceAgentEntry()
            accumulatedReply += event.delta
            this.dependencies.messageStore.appendDelta(input.messageId, event.delta)
            this.dependencies.emit({
              type: 'message-delta',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              messageId: input.messageId,
              delta: event.delta,
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'turn-started') {
            this.dependencies.emit({
              type: 'turn-started',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              turnIndex,
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'turn-ended') {
            this.dependencies.emit({
              type: 'turn-ended',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              turnIndex,
              message: event.message,
              toolResults: event.toolResults,
              occurredAt: this.dependencies.now(),
            })
            turnIndex += 1
            return
          }

          if (event.type === 'compaction-ended') {
            this.dependencies.emit({
              type: 'compaction-detected',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'auto-retry-started') {
            retryCount = event.attempt
            announceAgentEntry()
            this.dependencies.emit({
              type: 'auto-retry-progress',
              agentId: input.agentId,
              sessionId: input.sessionId,
              runId: input.runId,
              retryCount: event.attempt,
              maxAttempts: event.maxAttempts,
              occurredAt: this.dependencies.now(),
            })
            return
          }

          if (event.type === 'auto-retry-ended') return

          announceAgentEntry()
          this.dependencies.emit({
            type: 'activity-updated',
            agentId: input.agentId,
            sessionId: input.sessionId,
            runId: input.runId,
            activity: mapPiSdkStreamEventToActivity(event),
            occurredAt: this.dependencies.now(),
          })
        },
      })

      if (this.activeRunIds.get(input.sessionId) !== input.runId) {
        await this.finishCancelled(input, retryCount)
        return
      }

      if (!accumulatedReply && agentReply?.trim()) {
        accumulatedReply = agentReply.trim()
        this.dependencies.messageStore.appendDelta(
          input.messageId,
          accumulatedReply,
        )
        this.dependencies.emit({
          type: 'message-delta',
          agentId: input.agentId,
          sessionId: input.sessionId,
          runId: input.runId,
          messageId: input.messageId,
          delta: accumulatedReply,
          occurredAt: this.dependencies.now(),
        })
      }

      const completedMessage = this.dependencies.messageStore.complete(
        input.messageId,
      )
      this.dependencies.emit({
        type: 'message-completed',
        agentId: input.agentId,
        sessionId: input.sessionId,
        runId: input.runId,
        message: completedMessage,
        occurredAt: this.dependencies.now(),
      })
      this.dependencies.emit({
        type: 'message-appended',
        agentId: input.agentId,
        message: completedMessage,
        occurredAt: this.dependencies.now(),
        ...inReplyToPatch,
      })
      await this.dependencies.performBootstrapCompletionGating()
      await this.finish({
        sessionId: input.sessionId,
        runId: input.runId,
        messageId: input.messageId,
        status: 'completed',
        completedAt: this.dependencies.now(),
        lastMessagePreview: createMessagePreview(completedMessage.content),
        ...inReplyToPatch,
        ...(retryCount > 0 ? { retryCount } : {}),
      })
      await this.dependencies.updateSessionState(input.sessionId, 'completed')
    } catch (error) {
      if (isAbortError(error) || !this.activeRunIds.has(input.sessionId)) {
        await this.finishCancelled(input, retryCount)
        this.dependencies.emit({
          type: 'turn-cancelled',
          agentId: input.agentId,
          sessionId: input.sessionId,
          runId: input.runId,
          occurredAt: this.dependencies.now(),
        })
        return
      }

      const runtimeError = {
        code: 'unknown' as const,
        message: sanitizeErrorMessage(error),
        recoverable: true,
      }
      this.dependencies.messageStore.removeIfEmpty(input.messageId)
      await this.finish({
        sessionId: input.sessionId,
        runId: input.runId,
        messageId: input.messageId,
        status: 'failed',
        completedAt: this.dependencies.now(),
        error: runtimeError,
        lastMessagePreview: createMessagePreview(runtimeError.message),
        ...inReplyToPatch,
        ...(retryCount > 0 ? { retryCount } : {}),
      })
      await this.dependencies.updateSessionState(input.sessionId, 'failed')
      this.dependencies.emit({
        type: 'turn-failed',
        agentId: input.agentId,
        sessionId: input.sessionId,
        runId: input.runId,
        error: runtimeError,
        occurredAt: this.dependencies.now(),
      })
      this.dependencies.emit({
        type: 'runtime-error',
        agentId: input.agentId,
        error: runtimeError,
        occurredAt: this.dependencies.now(),
      })
      throw error
    } finally {
      if (this.activeRunIds.get(input.sessionId) === input.runId) {
        this.activeRunIds.delete(input.sessionId)
      }
      await this.dependencies.afterRun(input.sessionId, input.agentId)
    }
  }

  private async finishCancelled(
    input: ExecuteAttemptInput & { runId: string; messageId: string },
    retryCount: number,
  ): Promise<void> {
    this.dependencies.messageStore.removeIfEmpty(input.messageId)
    await this.finish({
      sessionId: input.sessionId,
      runId: input.runId,
      messageId: input.messageId,
      status: 'cancelled',
      completedAt: this.dependencies.now(),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(retryCount > 0 ? { retryCount } : {}),
    })
    await this.dependencies.updateSessionState(input.sessionId, 'cancelled')
  }

  private createRunId(sessionId: string): string {
    const nextSequence = (this.runSequenceBySession.get(sessionId) ?? 0) + 1
    this.runSequenceBySession.set(sessionId, nextSequence)
    return `${sessionId}-run-${nextSequence}`
  }

  private async start(input: {
    sessionId: string
    runId: string
    messageId: string
    startedAt: string
    lastMessagePreview: string
    inReplyTo?: string
  }): Promise<PersistedAttemptEntry> {
    const attempt: PersistedAttemptEntry = {
      attemptId: input.runId,
      runId: input.runId,
      messageId: input.messageId,
      status: 'running',
      startedAt: input.startedAt,
      completedAt: null,
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    }
    await this.dependencies.sessionIndexStore.upsertAttempt(
      input.sessionId,
      attempt,
      {
        status: 'running',
        updatedAt: input.startedAt,
        lastMessagePreview: input.lastMessagePreview,
      },
    )
    return attempt
  }

  private async finish(
    input: FinishAttemptInput,
  ): Promise<PersistedAttemptEntry> {
    const runningAttempt = (
      await this.dependencies.sessionIndexStore.resolveAttempts(input.sessionId)
    ).find((attempt) => attempt.runId === input.runId)
    const attempt: PersistedAttemptEntry = {
      attemptId: input.runId,
      runId: input.runId,
      messageId: runningAttempt?.messageId ?? input.messageId,
      status: input.status,
      startedAt: runningAttempt?.startedAt ?? input.completedAt,
      completedAt: input.completedAt,
      ...((runningAttempt?.inReplyTo ?? input.inReplyTo)
        ? { inReplyTo: runningAttempt?.inReplyTo ?? input.inReplyTo }
        : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.retryCount !== undefined
        ? { retryCount: input.retryCount }
        : {}),
    }
    await this.dependencies.sessionIndexStore.upsertAttempt(
      input.sessionId,
      attempt,
      {
        status: input.status,
        updatedAt: input.completedAt,
        ...(input.lastMessagePreview !== undefined
          ? { lastMessagePreview: input.lastMessagePreview }
          : {}),
      },
    )
    return attempt
  }
}
