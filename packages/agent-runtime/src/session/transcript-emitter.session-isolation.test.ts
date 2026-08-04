import { describe, expect, it } from 'vitest'
import type { TranscriptSnapshot } from '@yuanxiao/contracts'
import { TranscriptEmitter } from './transcript-emitter'

describe('TranscriptEmitter.applyEvent 统一分派', () => {
  function createEmitter(): {
    emitter: TranscriptEmitter
    getSnapshot: (sessionId: string) => TranscriptSnapshot | undefined
  } {
    const emitter = new TranscriptEmitter(() => undefined)
    return {
      emitter,
      getSnapshot: (sessionId: string) => emitter.getSnapshot(sessionId),
    }
  }

  it('message-appended 与 message-delta 经 applyEvent 组装条目', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = new Date().toISOString()

    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'yuanxiao',
      message: {
        messageId: 'user-1',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        role: 'user',
        content: '你好',
        createdAt: occurredAt,
      },
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'yuanxiao',
      message: {
        messageId: 'agent-1',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        role: 'agent',
        content: '收到',
        createdAt: occurredAt,
      },
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-delta',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: 'agent-1',
      delta: '收到',
      occurredAt,
    })

    const snapshot = getSnapshot('session-1')
    expect(snapshot?.entries).toHaveLength(2)
    expect(snapshot?.entries[0]).toMatchObject({
      kind: 'user-message',
      content: '你好',
    })
    // message-appended 携带已累计内容，后续 message-delta 继续追加
    expect(snapshot?.entries[1]).toMatchObject({
      kind: 'agent-reply',
      content: '收到收到',
    })
  })

  it('turn-cancelled 经 applyEvent 更新 attempt 状态', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = new Date().toISOString()

    emitter.applyEvent({
      type: 'attempt-started',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'yuanxiao',
      message: {
        messageId: 'agent-1',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        role: 'agent',
        content: '',
        createdAt: occurredAt,
      },
      occurredAt,
    })
    emitter.applyEvent({
      type: 'turn-cancelled',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt,
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot?.entries[0]
    expect(agentEntry?.kind).toBe('agent-reply')
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.attempt).toMatchObject({
        status: 'cancelled',
        runId: 'run-1',
      })
    }
  })

  it('turn-failed 经 applyEvent 携带错误', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = new Date().toISOString()
    const error = {
      code: 'unknown' as const,
      message: '执行失败',
      recoverable: true,
    }

    emitter.applyEvent({
      type: 'attempt-started',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'yuanxiao',
      message: {
        messageId: 'agent-1',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        role: 'agent',
        content: '',
        createdAt: occurredAt,
      },
      occurredAt,
    })
    emitter.applyEvent({
      type: 'turn-failed',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      error,
      occurredAt,
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot?.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.attempt).toMatchObject({
        status: 'failed',
        error,
      })
    }
  })

  it('未创建 agent 条目就失败时清理待关联 attempt', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = '2026-08-04T00:00:00.000Z'

    emitter.applyEvent({
      type: 'attempt-started',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt,
    })
    emitter.applyEvent({
      type: 'turn-failed',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      error: { code: 'unknown', message: '执行失败', recoverable: true },
      occurredAt: '2026-08-04T00:00:01.000Z',
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'yuanxiao',
      message: {
        messageId: 'late-agent-message',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        role: 'agent',
        content: '',
        createdAt: '2026-08-04T00:00:02.000Z',
      },
      occurredAt: '2026-08-04T00:00:02.000Z',
    })

    expect(getSnapshot('session-1')?.entries[0]).toMatchObject({
      kind: 'agent-reply',
      attempt: null,
    })
  })

  it('多会话交错时失败 attempt 只更新所属会话的回复', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = '2026-08-04T00:00:00.000Z'

    emitter.applyEvent({
      type: 'attempt-started',
      agentId: 'agent-a',
      sessionId: 'session-a',
      runId: 'run-a',
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'agent-a',
      message: {
        messageId: 'agent-message-a',
        agentId: 'agent-a',
        sessionId: 'session-a',
        role: 'agent',
        content: '',
        createdAt: occurredAt,
      },
      occurredAt,
    })

    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'agent-b',
      message: {
        messageId: 'user-message-b',
        agentId: 'agent-b',
        sessionId: 'session-b',
        role: 'user',
        content: '开始',
        createdAt: occurredAt,
      },
      occurredAt,
    })
    emitter.applyEvent({
      type: 'attempt-started',
      agentId: 'agent-b',
      sessionId: 'session-b',
      runId: 'run-b',
      occurredAt,
    })
    emitter.applyEvent({
      type: 'message-appended',
      agentId: 'agent-b',
      message: {
        messageId: 'agent-message-b',
        agentId: 'agent-b',
        sessionId: 'session-b',
        role: 'agent',
        content: '',
        createdAt: occurredAt,
      },
      occurredAt,
    })

    emitter.applyEvent({
      type: 'turn-failed',
      agentId: 'agent-a',
      sessionId: 'session-a',
      runId: 'run-a',
      error: { code: 'unknown', message: 'A 失败', recoverable: true },
      occurredAt: '2026-08-04T00:00:05.000Z',
    })

    expect(getSnapshot('session-a')?.entries[0]).toMatchObject({
      kind: 'agent-reply',
      attempt: { runId: 'run-a', status: 'failed' },
    })
    expect(getSnapshot('session-b')?.entries[1]).toMatchObject({
      kind: 'agent-reply',
      attempt: { runId: 'run-b', status: 'running' },
    })
  })

  it('删除会话时只释放该会话的投影状态', () => {
    const { emitter, getSnapshot } = createEmitter()
    const occurredAt = '2026-08-04T00:00:00.000Z'

    for (const sessionId of ['session-a', 'session-b']) {
      emitter.applyEvent({
        type: 'message-appended',
        agentId: sessionId,
        message: {
          messageId: `${sessionId}-user`,
          agentId: sessionId,
          sessionId,
          role: 'user',
          content: sessionId,
          createdAt: occurredAt,
        },
        occurredAt,
      })
    }

    emitter.deleteSession('session-a')

    expect(getSnapshot('session-a')).toBeUndefined()
    expect(getSnapshot('session-b')?.entries).toHaveLength(1)
  })
})
