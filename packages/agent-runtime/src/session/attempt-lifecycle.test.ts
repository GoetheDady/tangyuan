import { describe, expect, it, vi } from 'vitest'
import { AttemptLifecycle } from './attempt-lifecycle'
import type { PersistedAttemptEntry } from './session-index-types'

function createIndex(initialAttempts: PersistedAttemptEntry[] = []) {
  let attempts = initialAttempts
  const index = {
    getAttempts: vi.fn(() => attempts),
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

  return { index, getAttempts: () => attempts }
}

describe('AttemptLifecycle', () => {
  it('启动时持久化 running attempt 并同步会话摘要', async () => {
    const { index, getAttempts } = createIndex()
    const lifecycle = new AttemptLifecycle(index)

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
    expect(index.upsertAttempt).toHaveBeenCalledWith(
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
    const { index } = createIndex([
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
    const lifecycle = new AttemptLifecycle(index)

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
    expect(index.upsertAttempt).toHaveBeenCalledWith(
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
