import type {
  AgentEvent,
  AgentSessionSummary,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { describe, expect, it } from 'vitest'

import type { AgentEventProjectionState } from './agent-event-projection'
import { projectAgentEvent } from './agent-event-projection'

const NOW = '2026-07-29T10:00:00.000Z'

function createState(
  overrides: Partial<AgentEventProjectionState> = {},
): AgentEventProjectionState {
  return {
    agents: [],
    sessionsByAgentId: {},
    transcriptsBySessionId: {},
    sendingBySessionId: {},
    ...overrides,
  }
}

function createSession(
  agentId: string,
  sessionId: string,
): AgentSessionSummary {
  return {
    agentId,
    sessionId,
    title: sessionId,
    state: 'idle',
    updatedAt: NOW,
  }
}

function createTranscript(
  agentId: string,
  sessionId: string,
): TranscriptSnapshot {
  return { agentId, sessionId, entries: [], updatedAt: NOW }
}

describe('projectAgentEvent', () => {
  it('把 transcript-delta 追加到已打开或未打开的会话 transcript', () => {
    const state = createState({
      transcriptsBySessionId: {
        'session-1': createTranscript('yuanxiao', 'session-1'),
      },
    })
    const event: AgentEvent = {
      type: 'transcript-delta',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      delta: {
        type: 'entry-appended',
        entry: {
          kind: 'user-message',
          index: 0,
          messageId: 'message-1',
          content: '你好',
          createdAt: NOW,
        },
      },
      occurredAt: NOW,
    }

    const partial = projectAgentEvent(state, event)

    expect(partial.transcriptsBySessionId?.['session-1']?.entries).toEqual([
      expect.objectContaining({ kind: 'user-message', content: '你好' }),
    ])
    expect(partial.transcriptsBySessionId).not.toBe(
      state.transcriptsBySessionId,
    )
  })

  it('turn-cancelled / turn-failed / run-state-changed 非 running 清空发送状态', () => {
    const state = createState({ sendingBySessionId: { 'session-1': true } })
    const endingEvents: AgentEvent[] = [
      {
        type: 'turn-cancelled',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        runId: 'run-1',
        occurredAt: NOW,
      },
      {
        type: 'turn-failed',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        runId: 'run-1',
        error: {
          code: 'unknown',
          message: '运行失败',
          recoverable: true,
        },
        occurredAt: NOW,
      },
      {
        type: 'run-state-changed',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        state: 'completed',
        occurredAt: NOW,
      },
    ]

    for (const event of endingEvents) {
      expect(
        projectAgentEvent(state, event).sendingBySessionId?.['session-1'],
      ).toBe(false)
    }
    expect(
      projectAgentEvent(state, {
        type: 'run-state-changed',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        state: 'running',
        occurredAt: NOW,
      }),
    ).not.toHaveProperty('sendingBySessionId')
  })

  it('session-created 把新会话前置到对应 Agent 的列表', () => {
    const session = createSession('yuanxiao', 'session-2')
    const existing = createSession('yuanxiao', 'session-1')
    const state = createState({
      sessionsByAgentId: { yuanxiao: [existing] },
    })

    const partial = projectAgentEvent(state, {
      type: 'session-created',
      agentId: 'yuanxiao',
      session,
      occurredAt: NOW,
    })

    expect(partial.sessionsByAgentId?.yuanxiao).toEqual([session, existing])
  })

  it('不涉及投影切片的事件返回空变更', () => {
    const state = createState()

    expect(
      projectAgentEvent(state, {
        type: 'attempt-started',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        runId: 'run-1',
        occurredAt: NOW,
      }),
    ).toEqual({})
  })
})
