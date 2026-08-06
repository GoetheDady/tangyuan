import type {
  AgentEvent,
  AgentRunState,
  AgentSessionSummary,
} from '@yuanxiao/contracts'

/**
 * 将一个 Agent 事件归并到会话摘要集合。
 *
 * @param sessions - 当前会话摘要集合。
 * @param event - Main 推送的标准 Agent 事件。
 * @returns 归并后的会话摘要集合；事件不影响会话时返回原集合。
 */
export function mergeAgentEventIntoSessions(
  sessions: AgentSessionSummary[],
  event: AgentEvent,
): AgentSessionSummary[] {
  if (event.type === 'session-created') {
    return [
      event.session,
      ...sessions.filter(
        (session) => session.sessionId !== event.session.sessionId,
      ),
    ]
  }

  if (event.type === 'session-title-changed') {
    return sessions.map((session) =>
      session.sessionId === event.sessionId
        ? { ...session, title: event.title }
        : session,
    )
  }

  const sessionId = getAgentEventSessionId(event)
  const nextState = getAgentEventRunState(event)

  if (!sessionId || !nextState) {
    return sessions
  }

  return sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, state: nextState, updatedAt: event.occurredAt }
      : session,
  )
}

/**
 * 从 Agent 事件中读取所属会话标识。
 *
 * @param event - 标准 Agent 事件。
 * @returns 有会话归属时返回 sessionId，否则返回 null。
 */
export function getAgentEventSessionId(event: AgentEvent): string | null {
  if (event.type === 'session-created') {
    return event.session.sessionId
  }

  if (
    event.type === 'attempt-started' ||
    event.type === 'turn-cancelled' ||
    event.type === 'turn-failed' ||
    event.type === 'run-state-changed' ||
    event.type === 'approval-required' ||
    event.type === 'approval-resolved' ||
    event.type === 'clarification-required' ||
    event.type === 'clarification-resolved' ||
    event.type === 'transcript-delta' ||
    event.type === 'session-title-changed'
  ) {
    return event.sessionId
  }

  return null
}

function getAgentEventRunState(event: AgentEvent): AgentRunState | null {
  if (event.type === 'attempt-started') {
    return 'running'
  }

  if (event.type === 'turn-cancelled') {
    return 'cancelled'
  }

  if (event.type === 'turn-failed') {
    return 'failed'
  }

  if (event.type === 'run-state-changed') {
    return event.state
  }

  return null
}
