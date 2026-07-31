import type { AgentEvent, AgentSessionSummary } from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'

import {
  getAgentEventSessionId,
  mergeAgentEventIntoSessions,
} from './agent-event-session-state'

const FIRST_SESSION: AgentSessionSummary = {
  agentId: 'tangyuan',
  sessionId: 'session-1',
  title: '第一会话',
  state: 'idle',
  updatedAt: '2026-07-28T08:00:00.000Z',
}
const SECOND_SESSION: AgentSessionSummary = {
  agentId: 'agent-2',
  sessionId: 'session-2',
  title: '第二会话',
  state: 'queued',
  updatedAt: '2026-07-28T09:00:00.000Z',
}
const OCCURRED_AT = '2026-07-28T10:00:00.000Z'

function createRunEvent(
  type: 'attempt-started' | 'turn-cancelled' | 'turn-failed',
  sessionId = FIRST_SESSION.sessionId,
): AgentEvent {
  const base = {
    agentId: FIRST_SESSION.agentId,
    sessionId,
    runId: 'run-1',
    occurredAt: OCCURRED_AT,
  }

  if (type === 'turn-failed') {
    return {
      ...base,
      type,
      error: {
        code: 'unknown',
        message: '执行失败',
        recoverable: true,
      },
    }
  }

  if (type === 'turn-cancelled') {
    return { ...base, type }
  }

  return { ...base, type }
}

describe('mergeAgentEventIntoSessions', () => {
  it('将新建会话置顶，并按 sessionId 替换已有摘要', () => {
    const replacement = {
      ...SECOND_SESSION,
      title: '更新后的第二会话',
      state: 'idle' as const,
      updatedAt: OCCURRED_AT,
    }
    const event: AgentEvent = {
      type: 'session-created',
      agentId: replacement.agentId,
      session: replacement,
      occurredAt: OCCURRED_AT,
    }

    expect(
      mergeAgentEventIntoSessions([FIRST_SESSION, SECOND_SESSION], event),
    ).toEqual([replacement, FIRST_SESSION])
  })

  it.each([
    ['attempt-started', 'running'],
    ['turn-cancelled', 'cancelled'],
    ['turn-failed', 'failed'],
  ] as const)('将 %s 归并为 %s 状态', (type, expectedState) => {
    const event = createRunEvent(type)

    expect(
      mergeAgentEventIntoSessions([FIRST_SESSION, SECOND_SESSION], event),
    ).toEqual([
      { ...FIRST_SESSION, state: expectedState, updatedAt: OCCURRED_AT },
      SECOND_SESSION,
    ])
  })

  it('使用 run-state-changed 携带的状态和事件时间更新目标会话', () => {
    const event: AgentEvent = {
      type: 'run-state-changed',
      agentId: SECOND_SESSION.agentId,
      sessionId: SECOND_SESSION.sessionId,
      state: 'completed',
      occurredAt: OCCURRED_AT,
    }

    expect(
      mergeAgentEventIntoSessions([FIRST_SESSION, SECOND_SESSION], event),
    ).toEqual([
      FIRST_SESSION,
      { ...SECOND_SESSION, state: 'completed', updatedAt: OCCURRED_AT },
    ])
  })

  it('目标 session 不存在时保持摘要内容不变', () => {
    const sessions = [FIRST_SESSION, SECOND_SESSION]

    expect(
      mergeAgentEventIntoSessions(
        sessions,
        createRunEvent('attempt-started', 'unknown-session'),
      ),
    ).toEqual(sessions)
  })

  it('不相关事件保持原集合引用不变', () => {
    const sessions = [FIRST_SESSION, SECOND_SESSION]
    const event: AgentEvent = {
      type: 'runtime-error',
      agentId: FIRST_SESSION.agentId,
      error: {
        code: 'unknown',
        message: '运行时错误',
        recoverable: true,
      },
      occurredAt: OCCURRED_AT,
    }

    expect(mergeAgentEventIntoSessions(sessions, event)).toBe(sessions)
  })
})

describe('getAgentEventSessionId', () => {
  it('返回会话事件的 sessionId', () => {
    expect(getAgentEventSessionId(createRunEvent('attempt-started'))).toBe(
      FIRST_SESSION.sessionId,
    )
  })

  it('对不属于会话的事件返回 null', () => {
    expect(
      getAgentEventSessionId({
        type: 'profile-updated',
        agentId: FIRST_SESSION.agentId,
        target: 'soul',
        updatedAt: OCCURRED_AT,
        occurredAt: OCCURRED_AT,
      }),
    ).toBeNull()
  })
})
