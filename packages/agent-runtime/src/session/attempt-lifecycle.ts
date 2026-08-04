import type { AgentRuntimeErrorPayload } from '@yuanxiao/contracts'
import type { SessionIndexStore } from './session-index-store'
import type { PersistedAttemptEntry } from './session-index-types'

type AttemptIndex = Pick<SessionIndexStore, 'getAttempts' | 'upsertAttempt'>

interface StartAttemptInput {
  sessionId: string
  runId: string
  messageId: string
  startedAt: string
  lastMessagePreview: string
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

/** 持久化执行尝试的完整生命周期，并同步会话摘要状态。 */
export class AttemptLifecycle {
  constructor(private readonly sessionIndexStore: AttemptIndex) {}

  async start(input: StartAttemptInput): Promise<PersistedAttemptEntry> {
    const attempt: PersistedAttemptEntry = {
      attemptId: input.runId,
      runId: input.runId,
      messageId: input.messageId,
      status: 'running',
      startedAt: input.startedAt,
      completedAt: null,
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    }

    await this.sessionIndexStore.upsertAttempt(input.sessionId, attempt, {
      status: 'running',
      updatedAt: input.startedAt,
      lastMessagePreview: input.lastMessagePreview,
    })

    return attempt
  }

  async finish(input: FinishAttemptInput): Promise<PersistedAttemptEntry> {
    const runningAttempt = this.sessionIndexStore
      .getAttempts(input.sessionId)
      .find((attempt) => attempt.runId === input.runId)
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

    await this.sessionIndexStore.upsertAttempt(input.sessionId, attempt, {
      status: input.status,
      updatedAt: input.completedAt,
      ...(input.lastMessagePreview !== undefined
        ? { lastMessagePreview: input.lastMessagePreview }
        : {}),
    })

    return attempt
  }
}
