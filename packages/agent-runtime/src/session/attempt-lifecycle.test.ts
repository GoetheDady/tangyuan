import { describe, expect, it, vi } from 'vitest'
import { AttemptLifecycle } from './attempt-lifecycle'
import type { AttemptLifecycleDependencies } from './attempt-lifecycle'
import type { PersistedAttemptEntry } from './session-index-types'

function createDeps(initialAttempts: PersistedAttemptEntry[] = []) {
  let attempts = initialAttempts
  const sessionIndexStore = {
    resolveAttempts: vi.fn(async () => attempts),
    upsertAttempt: vi.fn(
      async (_sessionId: string, attempt: PersistedAttemptEntry) => {
        attempts = [
          ...attempts.filter(
            (candidate) => candidate.attemptId !== attempt.attemptId,
          ),
          attempt,
        ]
      },
    ),
  }

  const deps: AttemptLifecycleDependencies = {
    sessionIndexStore,
    messageStore: {
      append: vi.fn((input) => ({
        messageId: `${input.sessionId}-message-1`,
        agentId: input.agentId,
        sessionId: input.sessionId,
        role: input.role as 'agent',
        content: input.content,
        createdAt: '2026-08-04T00:00:00.000Z',
      })),
      appendDelta: vi.fn((messageId) => ({
        messageId,
        agentId: 'test',
        sessionId: 'test',
        role: 'agent' as const,
        content: '',
        createdAt: '2026-08-04T00:00:00.000Z',
      })),
      complete: vi.fn((messageId) => ({
        messageId,
        agentId: 'test',
        sessionId: 'test',
        role: 'agent' as const,
        content: '',
        createdAt: '2026-08-04T00:00:00.000Z',
      })),
      removeIfEmpty: vi.fn(() => false),
    },
    emit: vi.fn(),
    updateSessionState: vi.fn(async () => {}),
    invalidateTranscript: vi.fn(),
    performBootstrapCompletionGating: vi.fn(async () => {}),
    afterRun: vi.fn(async () => {}),
    now: () => '2026-08-04T00:00:00.000Z',
  }

  return { deps, sessionIndexStore, getAttempts: () => attempts }
}

describe('AttemptLifecycle', () => {
  it('启动时持久化 running attempt 并同步会话摘要', async () => {
    const { deps, sessionIndexStore, getAttempts } = createDeps()
    // start/finish are private but we access them directly to test persistence logic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lifecycle = new AttemptLifecycle(deps) as any

    await expect(
      lifecycle.start({
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'agent-message-1',
        startedAt: '2026-08-04T00:00:00.000Z',
        lastMessagePreview: '你好',
        inReplyTo: 'user-message-1',
      }),
    ).resolves.toMatchObject({
      attemptId: 'run-1',
      status: 'running',
      completedAt: null,
      inReplyTo: 'user-message-1',
    })
    expect(getAttempts()).toEqual([
      expect.objectContaining({ runId: 'run-1', status: 'running' }),
    ])
    expect(sessionIndexStore.upsertAttempt).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ runId: 'run-1', status: 'running' }),
      {
        status: 'running',
        updatedAt: '2026-08-04T00:00:00.000Z',
        lastMessagePreview: '你好',
      },
    )
  })

  it('终态保留 running attempt 的启动时间与消息关联', async () => {
    const { deps, sessionIndexStore } = createDeps([
      {
        attemptId: 'run-1',
        runId: 'run-1',
        messageId: 'agent-message-1',
        status: 'running',
        startedAt: '2026-08-04T00:00:00.000Z',
        completedAt: null,
        inReplyTo: 'user-message-1',
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lifecycle = new AttemptLifecycle(deps) as any

    await expect(
      lifecycle.finish({
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'fallback-message',
        status: 'failed',
        completedAt: '2026-08-04T00:00:10.000Z',
        lastMessagePreview: '执行失败',
        error: { code: 'unknown', message: '执行失败', recoverable: true },
        retryCount: 2,
      }),
    ).resolves.toMatchObject({
      messageId: 'agent-message-1',
      status: 'failed',
      startedAt: '2026-08-04T00:00:00.000Z',
      completedAt: '2026-08-04T00:00:10.000Z',
      inReplyTo: 'user-message-1',
      retryCount: 2,
    })
    expect(sessionIndexStore.upsertAttempt).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        messageId: 'agent-message-1',
        startedAt: '2026-08-04T00:00:00.000Z',
      }),
      {
        status: 'failed',
        updatedAt: '2026-08-04T00:00:10.000Z',
        lastMessagePreview: '执行失败',
      },
    )
  })
})
