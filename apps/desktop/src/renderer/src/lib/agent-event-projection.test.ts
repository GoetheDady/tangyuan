import type {
  AgentEvent,
  AgentSessionSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
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
    pendingApprovalsBySessionId: {},
    pendingClarificationsBySessionId: {},
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

function createApproval(
  agentId: string,
  sessionId: string,
): BashApprovalRequest {
  return {
    approvalId: `approval-${sessionId}`,
    agentId,
    sessionId,
    runId: `run-${sessionId}`,
    command: 'bun run test',
    cwd: '/workspace',
    riskDescription: '运行测试',
    riskLevel: 'normal',
    status: 'pending',
    createdAt: NOW,
  }
}

function createClarification(
  agentId: string,
  sessionId: string,
): QuestionClarificationRequest {
  return {
    clarificationId: `clarification-${sessionId}`,
    agentId,
    sessionId,
    runId: `run-${sessionId}`,
    question: '是否继续？',
    options: ['继续', '停止'],
    allowCustomAnswer: false,
    status: 'pending',
    createdAt: NOW,
  }
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

  it('approval-required 追加、approval-resolved 移除待审批请求', () => {
    const approval = createApproval('yuanxiao', 'session-1')
    const state = createState()

    const required = projectAgentEvent(state, {
      type: 'approval-required',
      agentId: approval.agentId,
      sessionId: approval.sessionId,
      approval,
      occurredAt: NOW,
    })
    expect(required.pendingApprovalsBySessionId?.['session-1']).toEqual([
      approval,
    ])

    const resolved = projectAgentEvent(
      {
        ...state,
        pendingApprovalsBySessionId: required.pendingApprovalsBySessionId!,
      },
      {
        type: 'approval-resolved',
        agentId: approval.agentId,
        sessionId: approval.sessionId,
        approvalId: approval.approvalId,
        status: 'approved',
        occurredAt: NOW,
      },
    )
    expect(resolved.pendingApprovalsBySessionId?.['session-1']).toEqual([])
  })

  it('clarification-required 追加、clarification-resolved 移除待澄清请求', () => {
    const clarification = createClarification('yuanxiao', 'session-1')
    const state = createState()

    const required = projectAgentEvent(state, {
      type: 'clarification-required',
      agentId: clarification.agentId,
      sessionId: clarification.sessionId,
      clarification,
      occurredAt: NOW,
    })
    expect(required.pendingClarificationsBySessionId?.['session-1']).toEqual([
      clarification,
    ])

    const resolved = projectAgentEvent(
      {
        ...state,
        pendingClarificationsBySessionId:
          required.pendingClarificationsBySessionId!,
      },
      {
        type: 'clarification-resolved',
        agentId: clarification.agentId,
        sessionId: clarification.sessionId,
        clarificationId: clarification.clarificationId,
        answer: '继续',
        status: 'answered',
        occurredAt: NOW,
      },
    )
    expect(resolved.pendingClarificationsBySessionId?.['session-1']).toEqual([])
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
